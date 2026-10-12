package users

import (
	"errors"
	"net/http"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

// ListMutuals GET /v1/users/{id}/mutuals
// People the viewer follows who also follow this profile (mutual follows when viewing yourself).
func (s *Service) ListMutuals(w http.ResponseWriter, r *http.Request) {
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
	if uid != target.String() {
		var isPrivate, following, blocked bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(is_private, false) FROM users WHERE id = $1`, target).Scan(&isPrivate)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1::uuid AND followee_id = $2)`,
			uid, target).Scan(&following)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM blocks
				WHERE (blocker_id = $1::uuid AND blocked_id = $2)
				   OR (blocker_id = $2 AND blocked_id = $1::uuid)
			)`, uid, target).Scan(&blocked)
		if blocked || (isPrivate && !following) {
			apiutil.JSON(w, http.StatusOK, map[string]any{"items": []any{}})
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id::text, u.username, u.display_name, COALESCE(u.avatar_url, '')
		FROM follows mine
		JOIN follows back ON back.follower_id = mine.followee_id AND back.followee_id = $2
		JOIN users u ON u.id = mine.followee_id AND u.deleted_at IS NULL
		WHERE mine.follower_id = $1::uuid
		  AND u.id <> $1::uuid
		  AND u.id <> $2
		  AND NOT EXISTS (
		    SELECT 1 FROM blocks b
		    WHERE (b.blocker_id = $1::uuid AND b.blocked_id = u.id)
		       OR (b.blocker_id = u.id AND b.blocked_id = $1::uuid)
		  )
		ORDER BY u.username
		LIMIT 50`, uid, target)
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
