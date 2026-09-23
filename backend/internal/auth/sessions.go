package auth

import (
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func deviceNameFromUA(ua string) string {
	ua = strings.TrimSpace(ua)
	if ua == "" {
		return "Неизвестное устройство"
	}
	low := strings.ToLower(ua)
	switch {
	case strings.Contains(low, "iphone"):
		return "iPhone"
	case strings.Contains(low, "ipad"):
		return "iPad"
	case strings.Contains(low, "android"):
		return "Android"
	case strings.Contains(low, "macintosh") || strings.Contains(low, "mac os"):
		return "Mac"
	case strings.Contains(low, "windows"):
		return "Windows"
	case strings.Contains(low, "linux"):
		return "Linux"
	default:
		if len(ua) > 48 {
			return ua[:48] + "…"
		}
		return ua
	}
}

// ListSessions GET /v1/me/sessions
func (s *Service) ListSessions(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, COALESCE(device_name,''), COALESCE(user_agent,''), COALESCE(ip,''),
		       created_at, last_seen_at, expires_at
		FROM refresh_tokens
		WHERE user_id=$1::uuid AND revoked_at IS NULL AND expires_at > now()
		ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
		LIMIT 50`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, device, ua, ip string
		var created, lastSeen, expires interface{}
		if err := rows.Scan(&id, &device, &ua, &ip, &created, &lastSeen, &expires); err != nil {
			continue
		}
		if device == "" {
			device = deviceNameFromUA(ua)
		}
		items = append(items, map[string]any{
			"id": id, "device_name": device, "user_agent": ua, "ip": ip,
			"created_at": created, "last_seen_at": lastSeen, "expires_at": expires,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// RevokeSession DELETE /v1/me/sessions/{id}
func (s *Service) RevokeSession(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	sid := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE id=$1::uuid AND user_id=$2::uuid AND revoked_at IS NULL`, sid, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "session not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// LogoutEverywhere POST /v1/me/sessions/logout-all
func (s *Service) LogoutEverywhere(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE user_id=$1::uuid AND revoked_at IS NULL`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
