package auth

import (
	"net/http"
	"strings"
)

// accessTokenFromRequest reads the caller's access JWT.
// Production proxies sometimes drop Authorization, so the same token is also
// accepted from X-Access-Token, the hub_access_token cookie (same-origin),
// and an access_token query value. Prefer the header; query tokens can land in logs.
func accessTokenFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(h) >= 7 && strings.EqualFold(h[:7], "bearer ") {
		if raw := strings.TrimSpace(h[7:]); raw != "" {
			return raw
		}
	}
	if raw := strings.TrimSpace(r.Header.Get("X-Access-Token")); raw != "" {
		return raw
	}
	if c, err := r.Cookie("hub_access_token"); err == nil {
		if raw := strings.TrimSpace(c.Value); raw != "" {
			return raw
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("access_token")); raw != "" {
		return raw
	}
	return ""
}
