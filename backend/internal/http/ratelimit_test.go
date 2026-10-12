package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func resetIPHits() {
	ipMu.Lock()
	ipHits = map[string]*ipBucket{}
	ipLastSweep = time.Time{}
	ipMu.Unlock()
}

func TestIPRateLimitIgnoresSpoofedForwardedFor(t *testing.T) {
	resetIPHits()
	t.Cleanup(resetIPHits)
	h := IPRateLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	limited := false
	for i := 0; i < 200; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "203.0.113.7:1234"
		req.Header.Set("X-Forwarded-For", "10.0.0."+string(rune('0'+i%10)))
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

func TestAllowIPSweepsStaleBuckets(t *testing.T) {
	resetIPHits()
	t.Cleanup(resetIPHits)
	start := time.Now()
	for i := 0; i < 50; i++ {
		allowIP("198.51.100."+string(rune('a'+i%26))+string(rune('a'+i/26)), start, 10)
	}
	allowIP("192.0.2.1", start.Add(2*ipWindow), 10)
	ipMu.Lock()
	n := len(ipHits)
	ipMu.Unlock()
	if n != 1 {
		t.Fatalf("expected stale buckets swept, have %d", n)
	}
}

func TestAllowIPLimit(t *testing.T) {
	resetIPHits()
	t.Cleanup(resetIPHits)
	now := time.Now()
	for i := 0; i < 3; i++ {
		if !allowIP("192.0.2.9", now, 3) {
			t.Fatalf("hit %d should be allowed", i+1)
		}
	}
	if allowIP("192.0.2.9", now, 3) {
		t.Fatal("4th hit should be limited")
	}
	if !allowIP("192.0.2.9", now.Add(ipWindow+time.Second), 3) {
		t.Fatal("new window should reset the counter")
	}
}
