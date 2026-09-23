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

func (s *Service) resolveTargetID(r *http.Request) (uuid.UUID, error) {
	raw := chi.URLParam(r, "id")
	if raw == "" {
		raw = chi.URLParam(r, "username")
	}
	if id, err := uuid.Parse(raw); err == nil {
		var exists uuid.UUID
		err := s.pool.QueryRow(r.Context(), `
			SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&exists)
		if err != nil {
			return uuid.Nil, err
		}
		return exists, nil
	}
	var id uuid.UUID
	err := s.pool.QueryRow(r.Context(), `
		SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL`, raw).Scan(&id)
	return id, err
}

func (s *Service) Follow(w http.ResponseWriter, r *http.Request) {
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
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot follow yourself")
		return
	}

	var blocked bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
			   OR (blocker_id = $2 AND blocked_id = $1)
		)`, uid, target).Scan(&blocked)
	if blocked {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot follow blocked user")
		return
	}

	tag, err := s.pool.Exec(r.Context(), `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, uid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() > 0 {
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO activities (user_id, actor_id, type, meta)
			VALUES ($1, $2, 'follow', '{}'::jsonb)`, target, uid)
		if s.push != nil {
			var actorName string
			_ = s.pool.QueryRow(r.Context(), `
				SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id = $1::uuid`, uid).Scan(&actorName)
			s.push.NotifyUser(r.Context(), target.String(), push.Payload{
				Title: "Новый подписчик",
				Body:  actorName + " подписался(ась) на вас",
				URL:   "/app/profile/" + uid,
			})
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "following": true})
}

func (s *Service) Unfollow(w http.ResponseWriter, r *http.Request) {
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
	_, err = s.pool.Exec(r.Context(), `
		DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, uid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "following": false})
}

func (s *Service) Block(w http.ResponseWriter, r *http.Request) {
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
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot block yourself")
		return
	}

	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO blocks (blocker_id, blocked_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, uid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// Drop mutual follows on block
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM follows
		WHERE (follower_id = $1 AND followee_id = $2)
		   OR (follower_id = $2 AND followee_id = $1)`, uid, target)

	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "blocked": true})
}

func (s *Service) Unblock(w http.ResponseWriter, r *http.Request) {
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
	_, err = s.pool.Exec(r.Context(), `
		DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`, uid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "blocked": false})
}

func (s *Service) ListBlocks(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT blocked_id::text FROM blocks WHERE blocker_id = $1 ORDER BY created_at DESC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		ids = append(ids, id)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": ids})
}

func (s *Service) ListFollowing(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT followee_id::text FROM follows WHERE follower_id = $1 ORDER BY created_at DESC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		ids = append(ids, id)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": ids})
}

// AcceptConsent records 152-FZ personal data processing consent.
func (s *Service) AcceptConsent(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	now := time.Now().UTC()
	_, err := s.pool.Exec(r.Context(), `
		UPDATE users
		SET consent_152_at = COALESCE(consent_152_at, $2)
		WHERE id = $1 AND deleted_at IS NULL`, uid, now)
	// Best-effort sync older column if present
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE users SET consent_v1_at = COALESCE(consent_v1_at, $2)
		WHERE id = $1 AND deleted_at IS NULL`, uid, now)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"consent_152":    true,
		"consent_152_at": now.Format(time.RFC3339Nano),
	})
}


// ListFollowers GET /v1/users/{id}/followers — avatar+name cards.
func (s *Service) ListFollowers(w http.ResponseWriter, r *http.Request) {
	s.listFollowGraph(w, r, true)
}

// ListFollowingOf GET /v1/users/{id}/following — avatar+name cards for any user.
func (s *Service) ListFollowingOf(w http.ResponseWriter, r *http.Request) {
	s.listFollowGraph(w, r, false)
}

func (s *Service) listFollowGraph(w http.ResponseWriter, r *http.Request, followers bool) {
	target, err := s.resolveTargetID(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var q string
	if followers {
		q = `
			SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,'')
			FROM follows f
			JOIN users u ON u.id = f.follower_id AND u.deleted_at IS NULL
			WHERE f.followee_id = $1
			ORDER BY f.created_at DESC
			LIMIT 200`
	} else {
		q = `
			SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,'')
			FROM follows f
			JOIN users u ON u.id = f.followee_id AND u.deleted_at IS NULL
			WHERE f.follower_id = $1
			ORDER BY f.created_at DESC
			LIMIT 200`
	}
	rows, err := s.pool.Query(r.Context(), q, target)
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
			"id":           id,
			"username":     username,
			"display_name": display,
			"avatar_url":   avatar,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}
