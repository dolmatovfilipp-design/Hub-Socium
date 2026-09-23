package httpx

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/quality"
)

type ipBucket struct {
	n    int
	from time.Time
}

var (
	ipMu   sync.Mutex
	ipHits = map[string]*ipBucket{}
)

// IPRateLimit soft global limit per IP (S16).
func IPRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.Header.Get("X-Forwarded-For")
		if ip != "" {
			ip = strings.TrimSpace(strings.Split(ip, ",")[0])
		} else {
			host, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			} else {
				ip = host
			}
		}
		now := time.Now()
		ipMu.Lock()
		b, ok := ipHits[ip]
		if !ok || now.Sub(b.from) > time.Minute {
			ipHits[ip] = &ipBucket{n: 1, from: now}
			ipMu.Unlock()
			next.ServeHTTP(w, r)
			return
		}
		b.n++
		n := b.n
		ipMu.Unlock()
		if n > quality.GlobalIPPerMin {
			apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many requests, slow down")
			return
		}
		next.ServeHTTP(w, r)
	})
}
