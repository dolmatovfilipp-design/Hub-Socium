package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hub-socium/hub/backend/internal/quality"
)

func TestRateLimitPerUserNotIP(t *testing.T) {
	rateMu.Lock()
	rateHits = map[string]*hitBucket{}
	rateMu.Unlock()

	var users = map[string]string{"tok-a": "user-a", "tok-b": "user-b"}
	h := RateLimit(func(raw string) (string, error) {
		return users[raw], nil
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	// Anonymous traffic shares an IP bucket.
	for i := 0; i < quality.GlobalIPPerMin; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.RemoteAddr = "10.0.0.8:1234"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("anon %d: status %d", i, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
	req.RemoteAddr = "10.0.0.8:1234"
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("anon over limit: %d", rec.Code)
	}

	// A signed-in user on the same IP has a separate, higher bucket.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/v1/posts", nil)
	req.RemoteAddr = "10.0.0.8:1234"
	req.Header.Set("Authorization", "Bearer tok-a")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("user after anon limit: %d body %s", rec.Code, rec.Body.String())
	}

	// Two users behind one address do not share a bucket.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/v1/posts", nil)
	req.RemoteAddr = "10.0.0.8:1234"
	req.Header.Set("Authorization", "Bearer tok-b")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("second user: %d", rec.Code)
	}
}

func TestCheapPollsAreExempt(t *testing.T) {
	rateMu.Lock()
	rateHits = map[string]*hitBucket{}
	rateMu.Unlock()

	h := RateLimit(func(string) (string, error) { return "", nil })(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for i := 0; i < quality.GlobalIPPerMin+30; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/conversations/abc/messages?limit=50", nil)
		req.RemoteAddr = "10.1.1.1:9"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("exempt poll %d: %d", i, rec.Code)
		}
	}
}
