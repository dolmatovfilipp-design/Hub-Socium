package auth

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/hub-socium/hub/backend/internal/db"
	"github.com/hub-socium/hub/backend/internal/mailer"
	"github.com/hub-socium/hub/backend/internal/quality"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests need a migrated Postgres:
//
//	HUB_TEST_DATABASE_URL=postgres://hub:hub@127.0.0.1:54329/hub?sslmode=disable go test ./internal/auth/
//
// (54329 is the embedded Postgres started by `make run-embedded`.) Each test
// creates its own throwaway users and deletes them afterwards.

type recordingMailer struct {
	mu   sync.Mutex
	msgs []mailer.Message
	err  error
}

func (m *recordingMailer) Enqueue(msg mailer.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.msgs = append(m.msgs, msg)
	return nil
}

func (m *recordingMailer) drain() []mailer.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.msgs
	m.msgs = nil
	return out
}

type harness struct {
	t    *testing.T
	pool *pgxpool.Pool
	svc  *Service
	mail *recordingMailer
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	url := os.Getenv("HUB_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set HUB_TEST_DATABASE_URL to run database tests")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool, "../../migrations"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	svc := NewService(pool, "integration-test-secret-integration-32", 15, 30, false)
	mail := &recordingMailer{}
	svc.SetMailer(mail)
	svc.SetAppURL("https://hub.example.com")
	return &harness{t: t, pool: pool, svc: svc, mail: mail}
}

type account struct {
	id, username, email, password, refresh string
}

func (h *harness) register(withEmail bool) account {
	h.t.Helper()
	n := rand.Intn(1 << 30)
	a := account{username: fmt.Sprintf("rt%d", n), password: "old-password-1"}
	body := map[string]any{"username": a.username, "password": a.password}
	if withEmail {
		a.email = fmt.Sprintf("reset-test-%d@example.test", n)
		body["email"] = a.email
	} else {
		body["phone"] = fmt.Sprintf("+7%010d", n)
	}
	code, resp := post(h.svc.Register, body)
	if code != http.StatusCreated {
		h.t.Fatalf("register: %d %v", code, resp)
	}
	user := resp["user"].(map[string]any)
	a.id = user["id"].(string)
	a.refresh, _ = resp["refresh_token"].(string)
	h.t.Cleanup(func() {
		_, _ = h.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1::uuid`, a.id)
	})
	return a
}

func (h *harness) request(contact string) (int, map[string]any) {
	return post(h.svc.RequestPasswordReset, map[string]string{"contact": contact})
}

func (h *harness) confirm(contact, code, pass string) (int, map[string]any) {
	return post(h.svc.ConfirmPasswordReset, map[string]string{"contact": contact, "code": code, "new_password": pass})
}

func (h *harness) login(login, pass string) int {
	code, _ := post(h.svc.Login, map[string]string{"login": login, "password": pass})
	return code
}

var codeRe = regexp.MustCompile(`Ваш код: (\d{6})`)

// requestCode asks for a reset and returns the code from the single email sent.
func (h *harness) requestCode(a account) string {
	h.t.Helper()
	h.ageCodes(a)
	h.mail.drain()
	if code, body := h.request(a.email); code != http.StatusOK {
		h.t.Fatalf("request: %d %v", code, body)
	}
	msgs := h.mail.drain()
	if len(msgs) != 1 {
		h.t.Fatalf("want 1 email, got %d", len(msgs))
	}
	m := codeRe.FindStringSubmatch(msgs[0].Text)
	if m == nil {
		h.t.Fatalf("no code in email: %q", msgs[0].Text)
	}
	return m[1]
}

// ageCodes moves the account's reset codes into the past so the 60s cooldown passes.
func (h *harness) ageCodes(a account) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE password_reset_codes SET created_at = created_at - interval '2 minutes' WHERE user_id = $1::uuid`, a.id); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) wrongCode(right string) string {
	if right == "000000" {
		return "000001"
	}
	return "000000"
}

func TestPasswordResetEmailFlowDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)

	if code, body := h.request(a.email); code != http.StatusOK {
		t.Fatalf("request: %d %v", code, body)
	} else if _, leaked := body["dev_code"]; leaked {
		t.Fatal("code must not be in the response when email is configured")
	}
	msgs := h.mail.drain()
	if len(msgs) != 1 {
		t.Fatalf("want 1 email, got %d", len(msgs))
	}
	msg := msgs[0]
	if msg.To != a.email || msg.Kind != "password_reset" || msg.HTML == "" {
		t.Fatalf("msg = %+v", msg)
	}
	if !strings.Contains(msg.Text, "@"+a.username) {
		t.Fatalf("email should name the account: %q", msg.Text)
	}
	code := codeRe.FindStringSubmatch(msg.Text)[1]

	// The email carries a one-tap link with the same code and the account email in the fragment.
	linkRe := regexp.MustCompile(`https://hub\.example\.com/reset#\S+`)
	link := linkRe.FindString(msg.Text)
	if link == "" {
		t.Fatalf("no link in email: %q", msg.Text)
	}
	lu, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	frag, err := url.ParseQuery(lu.Fragment)
	if err != nil || frag.Get("code") != code || frag.Get("email") != a.email {
		t.Fatalf("link fragment = %v (err %v), want code=%s email=%s", frag, err, code, a.email)
	}

	// Wrong code is rejected and does not change the password.
	if status, _ := h.confirm(a.email, h.wrongCode(code), "new-password-1"); status != http.StatusUnauthorized {
		t.Fatalf("wrong code: status %d", status)
	}
	if h.login(a.username, a.password) != http.StatusOK {
		t.Fatal("old password must still work after a failed attempt")
	}

	// Right code works, by any of the account's identifiers.
	if status, body := h.confirm(strings.ToUpper(a.email), code, "new-password-1"); status != http.StatusOK {
		t.Fatalf("confirm: %d %v", status, body)
	}
	if h.login(a.username, a.password) != http.StatusUnauthorized {
		t.Fatal("old password must stop working")
	}
	if h.login(a.username, "new-password-1") != http.StatusOK {
		t.Fatal("new password must work")
	}

	// Sessions issued before the reset are revoked.
	if status, _ := post(h.svc.Refresh, map[string]string{"refresh_token": a.refresh}); status != http.StatusUnauthorized {
		t.Fatalf("old refresh token still valid: %d", status)
	}

	// The owner is told about the change.
	notice := h.mail.drain()
	if len(notice) != 1 || notice[0].Kind != "password_changed" || notice[0].To != a.email {
		t.Fatalf("notification = %+v", notice)
	}

	// A used code is dead.
	if status, _ := h.confirm(a.email, code, "another-password"); status != http.StatusUnauthorized {
		t.Fatalf("code reuse: status %d", status)
	}
	if h.login(a.username, "new-password-1") != http.StatusOK {
		t.Fatal("password must be unchanged after a replayed code")
	}
}

func TestPasswordResetDoesNotRevealAccountsDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)
	phoneOnly := h.register(false)

	_, known := h.request(a.email)
	h.mail.drain()
	_, unknown := h.request("nobody-here@example.test")
	_, noEmail := h.request(phoneOnly.username)
	if !reflect.DeepEqual(known, unknown) || !reflect.DeepEqual(known, noEmail) {
		t.Fatalf("responses differ:\nknown   %v\nunknown %v\nnoEmail %v", known, unknown, noEmail)
	}
	if n := len(h.mail.drain()); n != 0 {
		t.Fatalf("no email expected for unknown account or account without email, got %d", n)
	}
	var rows int
	if err := h.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM password_reset_codes WHERE user_id = $1::uuid`, phoneOnly.id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("no code should be stored for an account that cannot receive it, got %d", rows)
	}

	// Failed confirmations look identical whatever the reason.
	_, wrongCode := h.confirm(a.email, "123456", "new-password-1")
	_, noUser := h.confirm("nobody-here@example.test", "123456", "new-password-1")
	if !reflect.DeepEqual(wrongCode, noUser) {
		t.Fatalf("confirm responses differ:\n%v\n%v", wrongCode, noUser)
	}
}

func TestPasswordResetCooldownAndReplacementDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)

	first := h.requestCode(a)

	// Immediate second request: answered 200 but nothing is sent.
	if status, _ := h.request(a.email); status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if n := len(h.mail.drain()); n != 0 {
		t.Fatalf("cooldown violated: %d emails", n)
	}

	// After the cooldown a new code replaces the old one.
	second := h.requestCode(a)
	if first == second {
		t.Skip("random collision; rerun")
	}
	if status, _ := h.confirm(a.email, first, "new-password-1"); status != http.StatusUnauthorized {
		t.Fatalf("replaced code still accepted: %d", status)
	}
	if status, body := h.confirm(a.email, second, "new-password-1"); status != http.StatusOK {
		t.Fatalf("current code rejected: %d %v", status, body)
	}
}

func TestPasswordResetHourlyCapDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)

	for i := 0; i < quality.ResetPerUserPerHour; i++ {
		h.requestCode(a)
	}
	h.ageCodes(a)
	h.mail.drain()
	if status, _ := h.request(a.email); status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if n := len(h.mail.drain()); n != 0 {
		t.Fatalf("hourly cap violated: %d emails", n)
	}
}

func TestPasswordResetCodeBurnsAfterMaxAttemptsDB(t *testing.T) {
	h := newHarness(t)

	t.Run("max wrong guesses burn the code", func(t *testing.T) {
		a := h.register(true)
		code := h.requestCode(a)
		for i := 0; i < quality.ResetCodeMaxAttempts; i++ {
			if status, _ := h.confirm(a.email, h.wrongCode(code), "new-password-1"); status != http.StatusUnauthorized {
				t.Fatalf("guess %d: status %d", i+1, status)
			}
		}
		if status, _ := h.confirm(a.email, code, "new-password-1"); status != http.StatusUnauthorized {
			t.Fatalf("right code accepted after the code was burned: %d", status)
		}
		if h.login(a.username, a.password) != http.StatusOK {
			t.Fatal("password must be unchanged")
		}
	})

	t.Run("last allowed attempt can still succeed", func(t *testing.T) {
		a := h.register(true)
		code := h.requestCode(a)
		for i := 0; i < quality.ResetCodeMaxAttempts-1; i++ {
			h.confirm(a.email, h.wrongCode(code), "new-password-1")
		}
		if status, body := h.confirm(a.email, code, "new-password-1"); status != http.StatusOK {
			t.Fatalf("attempt %d with the right code: %d %v", quality.ResetCodeMaxAttempts, status, body)
		}
	})

	t.Run("parallel guesses cannot exceed the limit", func(t *testing.T) {
		a := h.register(true)
		code := h.requestCode(a)
		const parallel = 40
		var wg sync.WaitGroup
		statuses := make(chan int, parallel)
		for i := 0; i < parallel; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				s, _ := h.confirm(a.email, h.wrongCode(code), "new-password-1")
				statuses <- s
			}()
		}
		wg.Wait()
		close(statuses)
		for s := range statuses {
			if s != http.StatusUnauthorized {
				t.Fatalf("status %d", s)
			}
		}
		var attempts int
		if err := h.pool.QueryRow(context.Background(),
			`SELECT COALESCE(max(attempts), 0) FROM password_reset_codes WHERE user_id = $1::uuid`, a.id).Scan(&attempts); err != nil {
			t.Fatal(err)
		}
		if attempts != quality.ResetCodeMaxAttempts {
			t.Fatalf("attempts counter = %d after %d parallel guesses, want exactly %d", attempts, parallel, quality.ResetCodeMaxAttempts)
		}
		if status, _ := h.confirm(a.email, code, "new-password-1"); status != http.StatusUnauthorized {
			t.Fatalf("right code accepted after the parallel burst: %d", status)
		}
	})
}

func TestPasswordResetCodeIsSingleUseUnderRaceDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)
	code := h.requestCode(a)

	const parallel = 5
	var wg sync.WaitGroup
	statuses := make(chan int, parallel)
	for i := 0; i < parallel; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s, _ := h.confirm(a.email, code, fmt.Sprintf("racing-password-%d", i))
			statuses <- s
		}(i)
	}
	wg.Wait()
	close(statuses)
	ok := 0
	for s := range statuses {
		if s == http.StatusOK {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("%d requests succeeded with one code, want exactly 1", ok)
	}
}

func TestPasswordResetExpiredCodeDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)
	code := h.requestCode(a)
	if _, err := h.pool.Exec(context.Background(),
		`UPDATE password_reset_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1::uuid`, a.id); err != nil {
		t.Fatal(err)
	}
	if status, _ := h.confirm(a.email, code, "new-password-1"); status != http.StatusUnauthorized {
		t.Fatalf("expired code accepted: %d", status)
	}
}

func TestPasswordResetEnqueueFailureFreesCooldownDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)

	h.mail.err = mailer.ErrQueueFull
	if status, _ := h.request(a.email); status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	h.mail.err = nil

	// The undeliverable code was discarded, so an immediate retry is not throttled.
	if status, _ := h.request(a.email); status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	if n := len(h.mail.drain()); n != 1 {
		t.Fatalf("retry after queue failure sent %d emails, want 1", n)
	}
}

func TestPasswordResetDevModeWithoutMailerDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)

	h.svc.SetMailer(nil)
	h.svc.SetDevMode(true)
	status, body := h.request(a.username)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	code, _ := body["dev_code"].(string)
	if !isSixDigits(code) {
		t.Fatalf("dev mode without mailer should return the code, body = %v", body)
	}
	if status, _ := h.confirm(a.username, code, "new-password-1"); status != http.StatusOK {
		t.Fatalf("dev code rejected: %d", status)
	}

	// With a mailer configured, dev mode no longer leaks the code.
	h.svc.SetMailer(h.mail)
	h.ageCodes(a)
	_, body = h.request(a.username)
	if _, leaked := body["dev_code"]; leaked {
		t.Fatal("dev_code returned although email delivery is configured")
	}
}

func TestPasswordResetUnavailableOutsideDevWithoutMailerDB(t *testing.T) {
	h := newHarness(t)
	a := h.register(true)
	h.svc.SetMailer(nil)

	status, body := h.request(a.email)
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %v", status, body)
	}
	var rows int
	if err := h.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM password_reset_codes WHERE user_id = $1::uuid`, a.id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatal("no code must be stored when it cannot be delivered")
	}
}
