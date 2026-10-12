package posts

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/contentgate"
	"github.com/jackc/pgx/v5"
)

// profilePostsAccess reports whether the viewer may list another user's posts.
// locked is true for a private profile the viewer does not follow.
func (s *Service) profilePostsAccess(r *http.Request, viewer, target string) (visible, locked bool, err error) {
	if viewer == target {
		return true, false, nil
	}
	var isPrivate bool
	err = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(is_private, false)
		FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL`, target).Scan(&isPrivate)
	if err != nil {
		return false, false, err
	}
	var blocked bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM blocks
			WHERE (blocker_id = $1::uuid AND blocked_id = $2::uuid)
			   OR (blocker_id = $2::uuid AND blocked_id = $1::uuid)
		)`, viewer, target).Scan(&blocked)
	if blocked {
		return false, false, nil
	}
	if !isPrivate {
		return true, false, nil
	}
	var following bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1::uuid AND followee_id = $2::uuid)`,
		viewer, target).Scan(&following)
	if following {
		return true, false, nil
	}
	return false, true, nil
}

func (s *Service) resolveProfileUser(r *http.Request) (string, error) {
	raw := chi.URLParam(r, "id")
	if _, err := uuid.Parse(raw); err == nil {
		var id string
		err := s.pool.QueryRow(r.Context(), `
			SELECT id::text FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, raw).Scan(&id)
		return id, err
	}
	var id string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id::text FROM users WHERE username = $1 AND deleted_at IS NULL`, raw).Scan(&id)
	return id, err
}

// ListUserPosts GET /v1/users/{id}/posts — published posts by that user.
func (s *Service) ListUserPosts(w http.ResponseWriter, r *http.Request) {
	viewer, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	target, err := s.resolveProfileUser(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	visible, locked, err := s.profilePostsAccess(r, viewer, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if locked {
		apiutil.JSON(w, http.StatusOK, map[string]any{"items": []any{}, "posts_locked": true})
		return
	}
	if !visible {
		apiutil.JSON(w, http.StatusOK, map[string]any{"items": []any{}, "posts_locked": false})
		return
	}
	showAdult, parental := contentgate.Load(r.Context(), s.pool, viewer)
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text
		FROM posts p
		WHERE p.author_id = $1::uuid
		  AND p.deleted_at IS NULL
		  AND COALESCE(p.status, 'published') = 'published'
		`+contentgate.FilterSQL("p", "$2::uuid", 3, 4)+`
		ORDER BY p.created_at DESC
		LIMIT 40`, target, viewer, showAdult, parental)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		p, err := s.fetch(r, pid)
		if err != nil {
			continue
		}
		items = append(items, p)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "posts_locked": false})
}

// ListUserComments GET /v1/users/{id}/comments — replies authored by that user.
func (s *Service) ListUserComments(w http.ResponseWriter, r *http.Request) {
	viewer, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	target, err := s.resolveProfileUser(r)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	visible, locked, err := s.profilePostsAccess(r, viewer, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !visible || locked {
		apiutil.JSON(w, http.StatusOK, map[string]any{"items": []any{}, "posts_locked": locked})
		return
	}
	showAdult, parental := contentgate.Load(r.Context(), s.pool, viewer)
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id::text, c.post_id::text, c.author_id::text, c.body, c.created_at
		FROM comments c
		JOIN posts p ON p.id = c.post_id AND p.deleted_at IS NULL
		WHERE c.author_id = $1::uuid
		  AND c.deleted_at IS NULL
		  AND COALESCE(p.status, 'published') = 'published'
		`+contentgate.FilterSQL("p", "$2::uuid", 3, 4)+`
		ORDER BY c.created_at DESC
		LIMIT 40`, target, viewer, showAdult, parental)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, postID, author, body string
		var created time.Time
		if err := rows.Scan(&id, &postID, &author, &body, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "post_id": postID, "author_id": author,
			"body": body, "created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "posts_locked": false})
}
