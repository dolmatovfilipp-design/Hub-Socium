package httpx

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestIPRateLimitIgnoresSpoofedForwardedFor(t *testing.T) {
	globalLimiter = newWindowLimiter(time.Minute)
	t.Cleanup(func() { globalLimiter = newWindowLimiter(time.Minute) })
	h := IPRateLimit(okHandler())
	limited := false
	for i := 0; i < 200; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "203.0.113.7:1234"
		req.Header.Set("X-Forwarded-For", "10.0.0."+strconv.Itoa(i))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("expected rate limit despite rotating X-Forwarded-For")
	}
}

func TestWindowLimiterSweepsStaleBuckets(t *testing.T) {
	l := newWindowLimiter(time.Minute)
	start := time.Now()
	for i := 0; i < 50; i++ {
		l.allow("198.51.100."+strconv.Itoa(i), start, 10)
	}
	l.allow("192.0.2.1", start.Add(2*time.Minute), 10)
	l.mu.Lock()
	n := len(l.hits)
	l.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected stale buckets swept, have %d", n)
	}
}

func TestWindowLimiterLimitAndRetryAfter(t *testing.T) {
	l := newWindowLimiter(10 * time.Minute)
	now := time.Now()
	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("192.0.2.9", now, 3); !ok {
			t.Fatalf("hit %d should be allowed", i+1)
		}
	}
	ok, retry := l.allow("192.0.2.9", now.Add(4*time.Minute), 3)
	if ok {
		t.Fatal("4th hit should be limited")
	}
	if retry < 5*time.Minute+59*time.Second || retry > 6*time.Minute {
		t.Fatalf("retryAfter = %v, want ~6m", retry)
	}
	if ok, _ := l.allow("192.0.2.9", now.Add(10*time.Minute+time.Second), 3); !ok {
		t.Fatal("new window should reset the counter")
	}
	if ok, _ := l.allow("192.0.2.10", now, 3); !ok {
		t.Fatal("other keys are independent")
	}
}

func TestPasswordResetLimitsAreIndependentPerEndpoint(t *testing.T) {
	req := limitByIP(newWindowLimiter(10*time.Minute), 2, "request limit")(okHandler())
	conf := limitByIP(newWindowLimiter(10*time.Minute), 2, "confirm limit")(okHandler())

	hit := func(h http.Handler) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = "203.0.113.50:4444"
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, r)
		return rr
	}
	for i := 0; i < 2; i++ {
		if rr := hit(req); rr.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i+1, rr.Code)
		}
	}
	rr := hit(req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("3rd request: %d", rr.Code)
	}
	if ra, err := strconv.Atoi(rr.Header().Get("Retry-After")); err != nil || ra < 1 || ra > 601 {
		t.Fatalf("Retry-After = %q", rr.Header().Get("Retry-After"))
	}
	if rr := hit(conf); rr.Code != http.StatusOK {
		t.Fatalf("confirm shares no budget with request: %d", rr.Code)
	}
}

func TestPasswordResetLimitMessageIsRussian(t *testing.T) {
	h := PasswordResetRequestLimit(okHandler())
	var last *httptest.ResponseRecorder
	for i := 0; i < 25; i++ {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = "203.0.113.77:1"
		last = httptest.NewRecorder()
		h.ServeHTTP(last, r)
	}
	if last.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d", last.Code)
	}
	if body := last.Body.String(); !strings.Contains(body, "Слишком много запросов кода") {
		t.Fatalf("body = %s", body)
	}
}
