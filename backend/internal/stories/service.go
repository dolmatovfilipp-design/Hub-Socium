package stories

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// ListRing GET /v1/stories — active stories from followees + self
func (s *Service) ListRing(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT DISTINCT ON (u.id) u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,''),
		       st.id::text, st.created_at, COALESCE(st.audience,'all'),
		       EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = st.id AND sv.viewer_id = $1::uuid) AS seen
		FROM stories st
		JOIN users u ON u.id = st.author_id AND u.deleted_at IS NULL
		WHERE st.deleted_at IS NULL
		  AND st.expires_at > now()
		  AND (
		    st.author_id = $1::uuid
		    OR st.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1::uuid)
		  )
		  AND (
		    COALESCE(st.audience,'all') = 'all'
		    OR st.author_id = $1::uuid
		    OR EXISTS(SELECT 1 FROM close_friends cf WHERE cf.owner_id = st.author_id AND cf.friend_id = $1::uuid)
		  )
		  AND st.author_id NOT IN (SELECT muted_id FROM mutes WHERE muter_id = $1::uuid)
		  AND st.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1::uuid)
		  AND st.author_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $1::uuid)
		ORDER BY u.id, st.created_at DESC`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var authorID, username, display, avatar, storyID, audience string
		var created time.Time
		var seen bool
		if err := rows.Scan(&authorID, &username, &display, &avatar, &storyID, &created, &audience, &seen); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"author": map[string]any{
				"id": authorID, "username": username, "display_name": display, "avatar_url": avatar,
			},
			"latest_story_id": storyID,
			"created_at":      created.UTC().Format(time.RFC3339Nano),
			"seen":            seen,
			"is_me":           authorID == uid,
			"audience":        audience,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// ListByUser GET /v1/users/{id}/stories
func (s *Service) ListByUser(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	raw := chi.URLParam(r, "id")
	var authorID string
	if _, err := uuid.Parse(raw); err == nil {
		authorID = raw
	} else {
		err := s.pool.QueryRow(r.Context(), `
			SELECT id::text FROM users WHERE username=$1 AND deleted_at IS NULL`, raw).Scan(&authorID)
		if err != nil {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, body, COALESCE(media_url,''), created_at, expires_at, COALESCE(audience,'all')
		FROM stories
		WHERE author_id = $1::uuid AND deleted_at IS NULL AND expires_at > now()
		  AND (
		    COALESCE(audience,'all') = 'all'
		    OR author_id = $2::uuid
		    OR EXISTS(SELECT 1 FROM close_friends cf WHERE cf.owner_id = $1::uuid AND cf.friend_id = $2::uuid)
		  )
		ORDER BY created_at ASC`, authorID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, body, media, audience string
		var created, expires time.Time
		if err := rows.Scan(&id, &body, &media, &created, &expires, &audience); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id, "author_id": authorID, "body": body, "audience": audience,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"expires_at": expires.UTC().Format(time.RFC3339Nano),
		}
		if media != "" {
			item["media_url"] = media
		}
		items = append(items, item)
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO story_views (story_id, viewer_id) VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING`, id, uid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// Create POST /v1/stories
func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Body     string  `json:"body"`
		MediaURL *string `json:"media_url"`
		Audience string  `json:"audience"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	media := ""
	if req.MediaURL != nil {
		media = strings.TrimSpace(*req.MediaURL)
	}
	if req.Body == "" && media == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body or media_url required")
		return
	}
	if utf8.RuneCountInString(req.Body) > 300 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body max 300")
		return
	}
	audience := strings.TrimSpace(req.Audience)
	if audience == "" {
		audience = "all"
	}
	if audience != "all" && audience != "close_friends" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "audience must be all or close_friends")
		return
	}
	id := uuid.New()
	var created, expires time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO stories (id, author_id, body, media_url, audience)
		VALUES ($1, $2::uuid, $3, $4, $5)
		RETURNING created_at, expires_at`, id, uid, req.Body, media, audience).Scan(&created, &expires)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := map[string]any{
		"id": id.String(), "author_id": uid, "body": req.Body, "audience": audience,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"expires_at": expires.UTC().Format(time.RFC3339Nano),
	}
	if media != "" {
		out["media_url"] = media
	}
	apiutil.JSON(w, http.StatusCreated, out)
}

// Delete DELETE /v1/stories/{id}
func (s *Service) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE stories SET deleted_at = now()
		WHERE id = $1::uuid AND author_id = $2::uuid AND deleted_at IS NULL`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "story not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
