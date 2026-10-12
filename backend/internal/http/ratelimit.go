package httpx

import (
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/quality"
)

type ipBucket struct {
	n    int
	from time.Time
}

// windowLimiter counts hits per key in fixed windows. In-memory, so counters
// reset on restart and are per-instance (documented in docs/RATE-LIMITS.md).
type windowLimiter struct {
	mu        sync.Mutex
	window    time.Duration
	hits      map[string]*ipBucket
	lastSweep time.Time
}

func newWindowLimiter(window time.Duration) *windowLimiter {
	return &windowLimiter{window: window, hits: map[string]*ipBucket{}}
}

// allow counts a hit for key. When the limit is exceeded it also returns how
// long until the window resets.
func (l *windowLimiter) allow(key string, now time.Time, limit int) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) > l.window {
		for k, b := range l.hits {
			if now.Sub(b.from) > l.window {
				delete(l.hits, k)
			}
		}
		l.lastSweep = now
	}
	b, found := l.hits[key]
	if !found || now.Sub(b.from) > l.window {
		l.hits[key] = &ipBucket{n: 1, from: now}
		return true, 0
	}
	b.n++
	if b.n <= limit {
		return true, 0
	}
	return false, b.from.Add(l.window).Sub(now)
}

// clientIP relies on chi RealIP (mounted earlier) having already resolved
// proxy headers into RemoteAddr; raw X-Forwarded-For is client-controlled.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func limitByIP(l *windowLimiter, limit int, message string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, retry := l.allow(clientIP(r), time.Now(), limit)
			if !ok {
				secs := int(retry/time.Second) + 1
				w.Header().Set("Retry-After", strconv.Itoa(secs))
				apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", message)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

var globalLimiter = newWindowLimiter(time.Minute)

// IPRateLimit soft global limit per IP (S16).
func IPRateLimit(next http.Handler) http.Handler {
	return limitByIP(globalLimiter, quality.GlobalIPPerMin, "too many requests, slow down")(next)
}

// Password reset sends email and guesses codes, so it gets its own, tighter
// per-IP budgets on top of the global one and the per-account limits.
var (
	PasswordResetRequestLimit = limitByIP(
		newWindowLimiter(10*time.Minute), quality.ResetRequestPerIP10Min,
		"Слишком много запросов кода. Попробуйте через несколько минут.")
	PasswordResetConfirmLimit = limitByIP(
		newWindowLimiter(10*time.Minute), quality.ResetConfirmPerIP10Min,
		"Слишком много попыток. Попробуйте через несколько минут.")
)
