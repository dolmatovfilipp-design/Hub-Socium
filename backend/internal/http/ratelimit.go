package httpx

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/quality"
)

const ipWindow = time.Minute

type ipBucket struct {
	n    int
	from time.Time
}

var (
	ipMu        sync.Mutex
	ipHits      = map[string]*ipBucket{}
	ipLastSweep time.Time
)

// clientIP relies on chi RealIP (mounted earlier) having already resolved
// proxy headers into RemoteAddr; raw X-Forwarded-For is client-controlled.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// allowIP counts a hit for ip and reports whether it is within the per-minute limit.
func allowIP(ip string, now time.Time, limit int) bool {
	ipMu.Lock()
	defer ipMu.Unlock()
	if now.Sub(ipLastSweep) > ipWindow {
		for k, b := range ipHits {
			if now.Sub(b.from) > ipWindow {
				delete(ipHits, k)
			}
		}
		ipLastSweep = now
	}
	b, ok := ipHits[ip]
	if !ok || now.Sub(b.from) > ipWindow {
		ipHits[ip] = &ipBucket{n: 1, from: now}
		return true
	}
	b.n++
	return b.n <= limit
}

// IPRateLimit soft global limit per IP (S16).
func IPRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowIP(clientIP(r), time.Now(), quality.GlobalIPPerMin) {
			apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many requests, slow down")
			return
		}
		next.ServeHTTP(w, r)
	})
}
