package clips

import (
	"net/http"
	"strconv"
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

// List GET /v1/clips
func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id::text, c.author_id::text, c.caption, c.media_url, c.duration_ms, c.created_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,''),
		       (SELECT COUNT(*)::int FROM clip_likes cl WHERE cl.clip_id = c.id) AS likes,
		       EXISTS(SELECT 1 FROM clip_likes cl2 WHERE cl2.clip_id = c.id AND cl2.user_id = $1::uuid) AS liked_by_me
		FROM clips c
		JOIN users u ON u.id = c.author_id AND u.deleted_at IS NULL
		WHERE c.deleted_at IS NULL
		  AND c.author_id NOT IN (SELECT muted_id FROM mutes WHERE muter_id = $1::uuid)
		  AND c.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1::uuid)
		  AND c.author_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $1::uuid)
		ORDER BY c.created_at DESC, c.id DESC
		LIMIT $2`, uid, limit)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, author, caption, media, username, display, avatar string
		var duration, likes int
		var liked bool
		var created time.Time
		if err := rows.Scan(&id, &author, &caption, &media, &duration, &created, &username, &display, &avatar, &likes, &liked); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "author_id": author, "caption": caption, "media_url": media,
			"duration_ms": duration, "created_at": created.UTC().Format(time.RFC3339Nano),
			"likes": likes, "liked_by_me": liked,
			"author": map[string]any{
				"id": author, "username": username, "display_name": display, "avatar_url": avatar,
			},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// Create POST /v1/clips
func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Caption    string `json:"caption"`
		MediaURL   string `json:"media_url"`
		DurationMs int    `json:"duration_ms"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Caption = strings.TrimSpace(req.Caption)
	req.MediaURL = strings.TrimSpace(req.MediaURL)
	if req.MediaURL == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "media_url required")
		return
	}
	if !strings.HasPrefix(req.MediaURL, "/v1/media/") && !strings.HasPrefix(req.MediaURL, "http") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "media_url must be /v1/media/{id} or http(s)")
		return
	}
	if utf8.RuneCountInString(req.Caption) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "caption max 500")
		return
	}
	if req.DurationMs < 0 || req.DurationMs > 180000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "duration_ms max 180000")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO clips (id, author_id, caption, media_url, duration_ms)
		VALUES ($1, $2::uuid, $3, $4, $5)
		RETURNING created_at`, id, uid, req.Caption, req.MediaURL, req.DurationMs).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "author_id": uid, "caption": req.Caption,
		"media_url": req.MediaURL, "duration_ms": req.DurationMs,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

// Delete DELETE /v1/clips/{id}
func (s *Service) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE clips SET deleted_at = now()
		WHERE id=$1::uuid AND author_id=$2::uuid AND deleted_at IS NULL`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "clip not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Like POST /v1/clips/{id}/like
func (s *Service) Like(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM clips WHERE id=$1::uuid AND deleted_at IS NULL)`, id).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "clip not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO clip_likes (clip_id, user_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var likes int
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM clip_likes WHERE clip_id=$1::uuid`, id).Scan(&likes)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "liked": true, "likes": likes})
}

// Unlike DELETE /v1/clips/{id}/like
func (s *Service) Unlike(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM clip_likes WHERE clip_id=$1::uuid AND user_id=$2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var likes int
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM clip_likes WHERE clip_id=$1::uuid`, id).Scan(&likes)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "liked": false, "likes": likes})
}
