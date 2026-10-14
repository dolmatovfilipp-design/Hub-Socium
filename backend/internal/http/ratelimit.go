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

type hitBucket struct {
	n    int
	from time.Time
}

var (
	rateMu   sync.Mutex
	rateHits = map[string]*hitBucket{}
)

// TokenUser returns the authenticated user id for a raw access token.
// An error or empty id means the request is anonymous and is limited by IP.
type TokenUser func(raw string) (userID string, err error)

// RateLimit counts authenticated traffic per user and anonymous traffic per IP.
// Cheap read/poll routes are exempt so background refresh cannot lock a session out.
func RateLimit(userOf TokenUser) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if exemptFromRateLimit(r) {
				next.ServeHTTP(w, r)
				return
			}
			key := "ip:" + clientIP(r)
			limit := quality.GlobalIPPerMin
			if raw := bearerToken(r); raw != "" && userOf != nil {
				if uid, err := userOf(raw); err == nil && uid != "" {
					key = "u:" + uid
					limit = quality.UserPerMin
				}
			}
			if !allow(key, limit) {
				apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Слишком много запросов. Подождите немного.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func allow(key string, limit int) bool {
	now := time.Now()
	rateMu.Lock()
	defer rateMu.Unlock()
	if len(rateHits) > 20000 {
		for k, b := range rateHits {
			if now.Sub(b.from) > time.Minute {
				delete(rateHits, k)
			}
		}
	}
	b, ok := rateHits[key]
	if !ok || now.Sub(b.from) > time.Minute {
		rateHits[key] = &hitBucket{n: 1, from: now}
		return true
	}
	b.n++
	return b.n <= limit
}

func exemptFromRateLimit(r *http.Request) bool {
	if r.Method == http.MethodOptions {
		return true
	}
	path := r.URL.Path
	if path == "/healthz" || path == "/v1/ws" {
		return true
	}
	if r.Method == http.MethodPost && path == "/v1/me/heartbeat" {
		return true
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	switch path {
	case "/v1/features",
		"/v1/conversations",
		"/v1/activity",
		"/v1/stories",
		"/v1/follow-requests",
		"/v1/business/profile",
		"/v1/me/calls/incoming",
		"/v1/feed",
		"/v1/feed/interesting":
		return true
	}
	if strings.HasPrefix(path, "/v1/conversations/") {
		if strings.HasSuffix(path, "/messages") ||
			strings.HasSuffix(path, "/call") ||
			strings.HasSuffix(path, "/call/signals") ||
			strings.HasSuffix(path, "/transcript") {
			return true
		}
	}
	if strings.HasPrefix(path, "/v1/voice-rooms/") && strings.HasSuffix(path, "/signals") {
		return true
	}
	return false
}

func bearerToken(r *http.Request) string {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(h) >= 7 && strings.EqualFold(h[:7], "bearer ") {
		if raw := strings.TrimSpace(h[7:]); raw != "" {
			return raw
		}
	}
	if raw := strings.TrimSpace(r.Header.Get("X-Access-Token")); raw != "" {
		return raw
	}
	return ""
}

func clientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if ip != "" {
		return strings.TrimSpace(strings.Split(ip, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
