package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/mailer"
)

func TestExposeResetCodeInResponse(t *testing.T) {
	t.Setenv("HUB_HIDE_RESET_CODE", "")
	cases := []struct {
		dev, email, want bool
		name             string
	}{
		{false, false, false, "production without mailer: never"},
		{false, true, false, "production with mailer: never"},
		{true, true, false, "dev with mailer: real email, no code in response"},
		{true, false, true, "dev without mailer: code in response"},
	}
	for _, c := range cases {
		if got := exposeResetCodeInResponse(c.dev, c.email); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
	t.Setenv("HUB_HIDE_RESET_CODE", "1")
	if exposeResetCodeInResponse(true, false) {
		t.Error("HUB_HIDE_RESET_CODE=1 must hide the code in dev")
	}
}

func TestResetCodeHashBindsUserAndKey(t *testing.T) {
	a := NewService(nil, "secret-one-secret-one-secret-one-32", 15, 30, false)
	b := NewService(nil, "secret-two-secret-two-secret-two-32", 15, 30, false)
	u1, u2 := uuid.New(), uuid.New()

	h := a.resetCodeHash(u1, "123456")
	if h != a.resetCodeHash(u1, "123456") {
		t.Fatal("hash must be deterministic")
	}
	if h == a.resetCodeHash(u2, "123456") {
		t.Fatal("hash must depend on the user")
	}
	if h == a.resetCodeHash(u1, "123457") {
		t.Fatal("hash must depend on the code")
	}
	if h == b.resetCodeHash(u1, "123456") {
		t.Fatal("hash must depend on the server secret")
	}
	if len(h) != 64 {
		t.Fatalf("unexpected hash length %d", len(h))
	}
}

func TestRandomResetCode(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 500; i++ {
		c, err := randomResetCode()
		if err != nil {
			t.Fatal(err)
		}
		if !isSixDigits(c) {
			t.Fatalf("bad code %q", c)
		}
		seen[c] = true
	}
	if len(seen) < 450 {
		t.Fatalf("codes look non-random: %d distinct of 500", len(seen))
	}
}

func TestIsSixDigits(t *testing.T) {
	for in, want := range map[string]bool{
		"123456": true, "000000": true, "12345": false, "1234567": false,
		"12345a": false, "": false, "１２３４５６": false, " 12345": false,
	} {
		if got := isSixDigits(in); got != want {
			t.Errorf("isSixDigits(%q) = %v", in, got)
		}
	}
}

func TestRuPlural(t *testing.T) {
	for n, want := range map[int]string{
		1: "минуту", 2: "минуты", 4: "минуты", 5: "минут", 11: "минут", 12: "минут",
		14: "минут", 15: "минут", 21: "минуту", 22: "минуты", 25: "минут", 111: "минут", 0: "минут",
	} {
		if got := ruPlural(n, "минуту", "минуты", "минут"); got != want {
			t.Errorf("ruPlural(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestResetEmailContent(t *testing.T) {
	msg := resetEmail("anna@example.com", "анна", "482915", "")
	if msg.To != "anna@example.com" || msg.Kind != "password_reset" {
		t.Fatalf("msg = %+v", msg)
	}
	if !strings.Contains(msg.Text, "Ваш код: 482915") || !strings.Contains(msg.Text, "@анна") {
		t.Fatalf("text = %q", msg.Text)
	}
	if !strings.Contains(msg.Text, "15 минут") || !strings.Contains(msg.HTML, "15 минут") {
		t.Fatal("expiry must be spelled out")
	}
	if !strings.Contains(msg.HTML, ">482915<") {
		t.Fatalf("html lacks the code: %q", msg.HTML)
	}
	if strings.Contains(msg.Subject, "482915") {
		t.Fatal("the code must not appear in the subject (lock-screen previews)")
	}
}

func TestResetEmailWithoutLinkHasNoLinkBlock(t *testing.T) {
	msg := resetEmail("anna@example.com", "анна", "482915", "")
	if strings.Contains(msg.Text, "ссылку") || strings.Contains(msg.HTML, "Сбросить пароль") {
		t.Fatal("no link configured: the email must not mention one")
	}
}

func TestResetLink(t *testing.T) {
	svc := NewService(nil, "test-secret-test-secret-test-secret-32", 15, 30, false)
	if got := svc.resetLink("anna@example.com", "482915"); got != "" {
		t.Fatalf("no APP_URL: link must be empty, got %q", got)
	}
	svc.SetAppURL("https://hub.example.com/")
	got := svc.resetLink("anna+tag@example.com", "048291")
	want := "https://hub.example.com/reset#code=048291&email=anna%2Btag%40example.com"
	if got != want {
		t.Fatalf("link = %q, want %q", got, want)
	}
	// Everything sits in the fragment: nothing a server (or its access log) could see.
	u, err := url.Parse(got)
	if err != nil || u.RawQuery != "" || !strings.Contains(u.Fragment, "code=048291") {
		t.Fatalf("parsed = %+v err=%v", u, err)
	}
}

func TestResetEmailWithLink(t *testing.T) {
	link := "https://hub.example.com/reset#code=482915&email=anna%40example.com"
	msg := resetEmail("anna@example.com", "анна", "482915", link)
	if !strings.Contains(msg.Text, link) {
		t.Fatalf("text lacks the link: %q", msg.Text)
	}
	if !strings.Contains(msg.Text, "Ваш код: 482915") || !strings.Contains(msg.HTML, ">482915<") {
		t.Fatal("the code must stay in the email next to the link (manual entry still works)")
	}
	if !strings.Contains(msg.HTML, `href="https://hub.example.com/reset#code=482915&amp;email=anna%40example.com"`) {
		t.Fatalf("html lacks the button link: %q", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "Сбросить пароль") {
		t.Fatal("html lacks the button label")
	}
}

func TestResetEmailLinkCannotInjectMarkup(t *testing.T) {
	msg := resetEmail("a@example.com", "x", "111111", `https://hub.example.com/reset#a="><script>alert(1)</script>`)
	if strings.Contains(msg.HTML, "<script>") {
		t.Fatalf("link not escaped in HTML: %q", msg.HTML)
	}
	bad := resetEmail("a@example.com", "x", "111111", "javascript:alert(1)")
	if strings.Contains(bad.HTML, `href="javascript:`) {
		t.Fatalf("unsafe scheme survived in href: %q", bad.HTML)
	}
}

func TestResetEmailEscapesUsernameInHTML(t *testing.T) {
	msg := resetEmail("a@example.com", `<script>alert(1)</script>`, "111111", "")
	if strings.Contains(msg.HTML, "<script>") {
		t.Fatalf("username not escaped in HTML: %q", msg.HTML)
	}
	if !strings.Contains(msg.HTML, "&lt;script&gt;") {
		t.Fatalf("expected escaped username, got %q", msg.HTML)
	}
}

func TestPasswordChangedEmailContent(t *testing.T) {
	at := time.Date(2026, time.October, 12, 4, 7, 0, 0, time.UTC)
	msg := passwordChangedEmail("anna@example.com", "анна", at)
	if msg.Kind != "password_changed" || !strings.Contains(msg.Subject, "изменён") {
		t.Fatalf("msg = %+v", msg)
	}
	for _, body := range []string{msg.Text, msg.HTML} {
		if !strings.Contains(body, "12 октября 2026, 04:07 UTC") {
			t.Fatalf("missing timestamp in %q", body)
		}
	}
}

func post(h http.HandlerFunc, body any) (int, map[string]any) {
	var raw []byte
	switch v := body.(type) {
	case string:
		raw = []byte(v)
	default:
		raw, _ = json.Marshal(v)
	}
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(string(raw)))
	rec := httptest.NewRecorder()
	h(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// These cases are decided before any database access, so a nil pool is fine:
// reaching the DB would panic and fail the test.
func TestPasswordResetEndpointsRejectBadInputWithoutTouchingDB(t *testing.T) {
	svc := NewService(nil, "test-secret-test-secret-test-secret-32", 15, 30, false)

	t.Run("request: 503 when no mailer outside dev", func(t *testing.T) {
		code, body := post(svc.RequestPasswordReset, map[string]string{"contact": "anna@example.com"})
		if code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d", code)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "email_unavailable" {
			t.Fatalf("body = %v", body)
		}
		if _, leaked := body["dev_code"]; leaked {
			t.Fatal("dev_code leaked")
		}
	})

	t.Run("request: validation", func(t *testing.T) {
		svc.SetMailer(&noopMailer{})
		defer svc.SetMailer(nil)
		for _, body := range []any{
			map[string]string{"contact": "ab"},
			map[string]string{"contact": strings.Repeat("a", 255)},
			map[string]string{"contact": "   "},
		} {
			if code, _ := post(svc.RequestPasswordReset, body); code != http.StatusUnprocessableEntity {
				t.Errorf("body %v: status = %d", body, code)
			}
		}
		if code, _ := post(svc.RequestPasswordReset, "{not json"); code != http.StatusBadRequest {
			t.Errorf("bad json: status = %d", code)
		}
		if code, _ := post(svc.RequestPasswordReset, `{"contact":"anna@example.com","extra":1}`); code != http.StatusBadRequest {
			t.Errorf("unknown field: status = %d", code)
		}
	})

	t.Run("confirm: validation", func(t *testing.T) {
		long := strings.Repeat("я", 40) // 80 bytes
		for name, body := range map[string]map[string]string{
			"short contact": {"contact": "ab", "code": "123456", "new_password": "newpass"},
			"short code":    {"contact": "anna", "code": "12345", "new_password": "newpass"},
			"letters code":  {"contact": "anna", "code": "12345a", "new_password": "newpass"},
			"short pass":    {"contact": "anna", "code": "123456", "new_password": "abc"},
			"long pass":     {"contact": "anna", "code": "123456", "new_password": long},
		} {
			if code, _ := post(svc.ConfirmPasswordReset, body); code != http.StatusUnprocessableEntity {
				t.Errorf("%s: status = %d", name, code)
			}
		}
	})
}

type noopMailer struct{}

func (*noopMailer) Enqueue(mailer.Message) error { return nil }
