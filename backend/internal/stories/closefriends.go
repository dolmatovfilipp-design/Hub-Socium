package stories

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// ListCloseFriends GET /v1/me/close-friends
func (s *Service) ListCloseFriends(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''), cf.created_at
		FROM close_friends cf
		JOIN users u ON u.id = cf.friend_id AND u.deleted_at IS NULL
		WHERE cf.owner_id = $1::uuid
		ORDER BY cf.created_at DESC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, username, display, avatar string
		var created time.Time
		if err := rows.Scan(&id, &username, &display, &avatar, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "username": username, "display_name": display, "avatar_url": avatar,
			"added_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// AddCloseFriend POST /v1/me/close-friends
func (s *Service) AddCloseFriend(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil || strings.TrimSpace(req.UserID) == "" {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "user_id required")
		return
	}
	fid := strings.TrimSpace(req.UserID)
	if fid == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot add yourself")
		return
	}
	if _, err := uuid.Parse(fid); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid user_id")
		return
	}
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND deleted_at IS NULL)`, fid).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO close_friends (owner_id, friend_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, uid, fid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "user_id": fid})
}

// RemoveCloseFriend DELETE /v1/me/close-friends/{id}
func (s *Service) RemoveCloseFriend(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	fid := chi.URLParam(r, "id")
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM close_friends WHERE owner_id=$1::uuid AND friend_id=$2::uuid`, uid, fid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
