package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, "postgres://hub:hub@127.0.0.1:54329/hub?sslmode=disable")
	if err != nil {
		t.Skip(err.Error())
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Skip(err.Error())
	}
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "..", "..", "migrations")
	if err := db.Migrate(ctx, pool, dir); err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestFingerprintGroupsSameBug(t *testing.T) {
	a := Fingerprint("client", "boom", "at Chat.tsx:10", "/app/messages/11111111-1111-1111-1111-111111111111")
	b := Fingerprint("client", "boom", "at Chat.tsx:10", "/app/messages/22222222-2222-2222-2222-222222222222?x=1")
	if a != b {
		t.Fatalf("expected one group, got %s and %s", a, b)
	}
	c := Fingerprint("client", "other", "at Chat.tsx:10", "/app/messages/11111111-1111-1111-1111-111111111111")
	if a == c {
		t.Fatal("different messages must not share a fingerprint")
	}
	if strings.Contains(NormalizeRoute("/reset?email=a@b.c"), "email") {
		t.Fatal("query must be dropped")
	}
}

func TestErrorsDedupeAndAdminGate(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	var owner, other string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, email, is_admin)
		VALUES ($1, 'x', 'Владелец', $2, true) RETURNING id::text`,
		"own_"+suffix, "own_"+suffix+"@example.com").Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, email, is_admin)
		VALUES ($1, 'x', 'Гость', $2, false) RETURNING id::text`,
		"gst_"+suffix, "gst_"+suffix+"@example.com").Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM telemetry_events WHERE user_id = $1::uuid OR user_id = $2::uuid`, owner, other)
		_, _ = pool.Exec(context.Background(), `DELETE FROM telemetry_errors WHERE message LIKE $1`, "%"+suffix+"%")
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, owner, other)
	})

	svc := NewService(pool)
	msg := "сбой " + suffix
	body := `{"message":"` + msg + `","stack":"at App.tsx:4","route":"/app","user_agent":"test","app_version":"0.0.0"}`
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/telemetry/errors", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(apiutil.WithUser(req.Context(), owner, "own"))
		svc.ReportError(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("report %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	var count int
	var storedUser string
	if err := pool.QueryRow(ctx, `
		SELECT count, COALESCE(user_id::text, '') FROM telemetry_errors WHERE message = $1`, msg).Scan(&count, &storedUser); err != nil {
		t.Fatal(err)
	}
	if count != 2 || storedUser != owner {
		t.Fatalf("count=%d user=%s", count, storedUser)
	}

	extra := httptest.NewRecorder()
	bad := httptest.NewRequest(http.MethodPost, "/v1/telemetry/errors", strings.NewReader(`{"message":"x","user_id":"`+owner+`"}`))
	svc.ReportError(extra, bad)
	if extra.Code != http.StatusBadRequest {
		t.Fatalf("client user id must be rejected: %d", extra.Code)
	}

	pii := httptest.NewRecorder()
	piiReq := httptest.NewRequest(http.MethodPost, "/v1/telemetry/events", strings.NewReader(`{"name":"session_start","session_id":"sess1234","email":"a@b.c"}`))
	svc.ReportEvent(pii, piiReq)
	if pii.Code != http.StatusBadRequest {
		t.Fatalf("pii field must be rejected: %d %s", pii.Code, pii.Body.String())
	}

	ev := httptest.NewRecorder()
	evReq := httptest.NewRequest(http.MethodPost, "/v1/telemetry/events", strings.NewReader(`{"name":"screen_view","session_id":"sess1234","route":"/app/messages/`+owner+`"}`))
	evReq = evReq.WithContext(apiutil.WithUser(evReq.Context(), owner, "own"))
	svc.ReportEvent(ev, evReq)
	if ev.Code != http.StatusAccepted {
		t.Fatalf("event: %d %s", ev.Code, ev.Body.String())
	}

	denied := httptest.NewRecorder()
	denyReq := httptest.NewRequest(http.MethodGet, "/v1/telemetry/admin", nil)
	denyReq = denyReq.WithContext(apiutil.WithUser(denyReq.Context(), other, "gst"))
	svc.Admin(denied, denyReq)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("non-admin: %d", denied.Code)
	}

	ok := httptest.NewRecorder()
	okReq := httptest.NewRequest(http.MethodGet, "/v1/telemetry/admin", nil)
	okReq = okReq.WithContext(apiutil.WithUser(okReq.Context(), owner, "own"))
	svc.Admin(ok, okReq)
	if ok.Code != http.StatusOK {
		t.Fatalf("admin: %d %s", ok.Code, ok.Body.String())
	}
	raw := ok.Body.String()
	if !strings.Contains(raw, msg) || !strings.Contains(raw, "Открыли регистрацию") || !strings.Contains(raw, "/app/messages/:id") {
		t.Fatalf("summary missing pieces: %s", raw)
	}

	Bind(svc)
	panicReq := httptest.NewRequest(http.MethodGet, "/v1/posts/"+owner, nil)
	CaptureServer(panicReq, 500, "db down "+suffix)
	var panics int
	if err := pool.QueryRow(ctx, `SELECT count FROM telemetry_errors WHERE message = $1`, "db down "+suffix).Scan(&panics); err != nil {
		t.Fatal(err)
	}
	if panics != 1 {
		t.Fatalf("panic row count %d", panics)
	}
}

func TestErrorRateLimit(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM telemetry_errors WHERE message = 'лимит'`)
	})
	svc := NewService(pool)
	for i := 0; i < errorPerMin+1; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/telemetry/errors", strings.NewReader(`{"message":"лимит","stack":"at x.ts:1","route":"/app"}`))
		req.RemoteAddr = "203.0.113.9:4000"
		svc.ReportError(rec, req)
		if i < errorPerMin && rec.Code != http.StatusAccepted {
			t.Fatalf("hit %d: %d %s", i, rec.Code, rec.Body.String())
		}
		if i == errorPerMin && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("over limit: %d", rec.Code)
		}
	}
}
