package users

import (
	"net/http"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/presence"
)

// UpdatePresence PUT /v1/me/presence — { status: available|busy|meeting, text?: string }
func (s *Service) UpdatePresence(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Status string  `json:"status"`
		Text   *string `json:"text"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	st := strings.ToLower(strings.TrimSpace(req.Status))
	if st != "available" && st != "busy" && st != "meeting" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "status: available|busy|meeting")
		return
	}
	text := ""
	if req.Text != nil {
		text = strings.TrimSpace(*req.Text)
		if len([]rune(text)) > 80 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "text max 80")
			return
		}
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE users SET presence_status=$2, presence_text=$3 WHERE id=$1::uuid`, uid, st, text)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "presence_status": st, "presence_text": text})
}

// Heartbeat POST /v1/me/heartbeat — refresh users.last_seen_at.
func (s *Service) Heartbeat(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var seen time.Time
	var gender string
	err := s.pool.QueryRow(r.Context(), `
		UPDATE users SET last_seen_at=now()
		WHERE id=$1::uuid AND deleted_at IS NULL
		RETURNING last_seen_at, COALESCE(gender,'')`, uid).Scan(&seen, &gender)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"last_seen_at":    seen.UTC().Format(time.RFC3339Nano),
		"last_seen_label": presence.Label(seen, gender, time.Now()),
	})
}

func touchLastSeen(s *Service, r *http.Request, uid string) {
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE users SET last_seen_at=now() WHERE id=$1::uuid AND deleted_at IS NULL`, uid)
}
