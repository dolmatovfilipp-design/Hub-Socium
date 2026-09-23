package users

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/jackc/pgx/v5"
)

// FollowRequestApprove POST /v1/follow-requests/{id}/approve
func (s *Service) FollowRequestApprove(w http.ResponseWriter, r *http.Request) {
	s.resolveFollowRequest(w, r, true)
}

// FollowRequestDeny POST /v1/follow-requests/{id}/deny
func (s *Service) FollowRequestDeny(w http.ResponseWriter, r *http.Request) {
	s.resolveFollowRequest(w, r, false)
}

func (s *Service) resolveFollowRequest(w http.ResponseWriter, r *http.Request, accept bool) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	reqID := chi.URLParam(r, "id")
	var fromUser string
	var status string
	err := s.pool.QueryRow(r.Context(), `
		SELECT from_user_id::text, status FROM follow_requests
		WHERE id = $1::uuid AND to_user_id = $2::uuid`, reqID, uid).Scan(&fromUser, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "request not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if status != "pending" {
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "status": status})
		return
	}
	newStatus := "denied"
	if accept {
		newStatus = "accepted"
		_, err = s.pool.Exec(r.Context(), `
			INSERT INTO follows (follower_id, followee_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING`, fromUser, uid)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO activities (user_id, actor_id, type, meta)
			VALUES ($1::uuid, $2::uuid, 'follow', '{}'::jsonb)`, uid, fromUser)
		if s.push != nil {
			var actorName string
			_ = s.pool.QueryRow(r.Context(), `
				SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id = $1::uuid`, fromUser).Scan(&actorName)
			s.push.NotifyUser(r.Context(), uid, push.Payload{
				Title: "Новый подписчик",
				Body:  actorName + " подписался(ась) на вас",
				URL:   "/app/profile/" + fromUser,
			})
		}
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE follow_requests SET status = $2, updated_at = now()
		WHERE id = $1::uuid`, reqID, newStatus)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "status": newStatus})
}

// ListFollowRequests GET /v1/follow-requests — pending inbox for me
func (s *Service) ListFollowRequests(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT fr.id::text, fr.created_at,
		       u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM follow_requests fr
		JOIN users u ON u.id = fr.from_user_id AND u.deleted_at IS NULL
		WHERE fr.to_user_id = $1::uuid AND fr.status = 'pending'
		ORDER BY fr.created_at DESC
		LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, fromID, username, display, avatar string
		var created time.Time
		if err := rows.Scan(&id, &created, &fromID, &username, &display, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id":         id,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"from_user": map[string]any{
				"id": fromID, "username": username, "display_name": display, "avatar_url": avatar,
			},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// CancelFollowRequest DELETE /v1/users/{id}/follow-request
func (s *Service) CancelFollowRequest(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	target, err := s.resolveTargetID(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM follow_requests
		WHERE from_user_id = $1::uuid AND to_user_id = $2::uuid AND status = 'pending'`, uid, target)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "requested": false})
}

// Mute POST /v1/users/{id}/mute
func (s *Service) Mute(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	target, err := s.resolveTargetID(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if target.String() == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot mute yourself")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO mutes (muter_id, muted_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, uid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "muted": true})
}

// Unmute DELETE /v1/users/{id}/mute
func (s *Service) Unmute(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	target, err := s.resolveTargetID(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM mutes WHERE muter_id = $1::uuid AND muted_id = $2::uuid`, uid, target)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "muted": false})
}

// ListMutes GET /v1/users/me/mutes
func (s *Service) ListMutes(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM mutes m
		JOIN users u ON u.id = m.muted_id AND u.deleted_at IS NULL
		WHERE m.muter_id = $1::uuid
		ORDER BY m.created_at DESC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, username, display, avatar string
		if err := rows.Scan(&id, &username, &display, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "username": username, "display_name": display, "avatar_url": avatar,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// helper used by Follow — unused uuid import kept for consistency
var _ = uuid.Nil
