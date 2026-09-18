package posts

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool     *pgxpool.Pool
	activity *activity.Service
}

func NewService(pool *pgxpool.Pool, act *activity.Service) *Service {
	return &Service{pool: pool, activity: act}
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Body     string  `json:"body"`
		ImageURL *string `json:"image_url"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body required")
		return
	}
	if utf8.RuneCountInString(req.Body) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body max 500 characters")
		return
	}
	imageURL := ""
	if req.ImageURL != nil {
		imageURL = strings.TrimSpace(*req.ImageURL)
	}
	if imageURL != "" {
		if strings.HasPrefix(imageURL, "data:") {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "image_url must be a short media path, not a data URL — use POST /v1/media/upload")
			return
		}
		if !strings.HasPrefix(imageURL, "/v1/media/") &&
			!strings.HasPrefix(imageURL, "http://") && !strings.HasPrefix(imageURL, "https://") {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "image_url must be /v1/media/{id} or http(s) URL")
			return
		}
		if len(imageURL) > 2048 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "image_url too long")
			return
		}
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO posts (id, author_id, body, image_url) VALUES ($1,$2,$3,$4)
		RETURNING created_at`, id, uid, req.Body, imageURL).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := map[string]any{
		"id":         id.String(),
		"author_id":  uid,
		"body":       req.Body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"likes":      0,
		"comments":   0,
	}
	if imageURL != "" {
		out["image_url"] = imageURL
	}
	apiutil.JSON(w, http.StatusCreated, out)
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := s.fetch(r, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, p)
}

func (s *Service) fetch(r *http.Request, id string) (map[string]any, error) {
	var pid, authorID uuid.UUID
	var body, imageURL string
	var created time.Time
	var likes, comments int64
	err := s.pool.QueryRow(r.Context(), `
		SELECT p.id, p.author_id, p.body, COALESCE(p.image_url,''), p.created_at,
		       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id),
		       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)
		FROM posts p
		WHERE p.id = $1 AND p.deleted_at IS NULL`, id).
		Scan(&pid, &authorID, &body, &imageURL, &created, &likes, &comments)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"id":         pid.String(),
		"author_id":  authorID.String(),
		"body":       body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"likes":      likes,
		"comments":   comments,
	}
	if imageURL != "" {
		out["image_url"] = imageURL
	}
	return out, nil
}

func (s *Service) Like(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	authorID, okPost := s.postAuthor(r, postID)
	if !okPost {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2)
		ON CONFLICT DO NOTHING`, postID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() > 0 && s.activity != nil {
		pid := postID
		_ = s.activity.Insert(r.Context(), authorID, uid, "like", &pid, map[string]any{})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) Unlike(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2`, postID, uid)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) AddComment(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	authorID, okPost := s.postAuthor(r, postID)
	if !okPost {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	var req struct {
		Body string `json:"body"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body required")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO comments (id, post_id, author_id, body) VALUES ($1,$2,$3,$4)
		RETURNING created_at`, id, postID, uid, req.Body).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if s.activity != nil {
		pid := postID
		snippet := req.Body
		if utf8.RuneCountInString(snippet) > 120 {
			snippet = string([]rune(snippet)[:120])
		}
		_ = s.activity.Insert(r.Context(), authorID, uid, "reply", &pid, map[string]any{
			"comment_id": id.String(),
			"text":       snippet,
		})
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id":         id.String(),
		"post_id":    postID,
		"author_id":  uid,
		"body":       req.Body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) ListComments(w http.ResponseWriter, r *http.Request) {
	postID := chi.URLParam(r, "id")
	if !s.postExists(r, postID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, author_id, body, created_at
		FROM comments
		WHERE post_id = $1 AND deleted_at IS NULL
		ORDER BY created_at ASC
		LIMIT 100`, postID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, author uuid.UUID
		var body string
		var created time.Time
		if err := rows.Scan(&id, &author, &body, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id.String(), "post_id": postID, "author_id": author.String(),
			"body": body, "created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) postExists(r *http.Request, id string) bool {
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM posts WHERE id=$1 AND deleted_at IS NULL)`, id).Scan(&exists)
	return exists
}

func (s *Service) postAuthor(r *http.Request, id string) (string, bool) {
	var author string
	err := s.pool.QueryRow(r.Context(), `
		SELECT author_id::text FROM posts WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&author)
	if err != nil {
		return "", false
	}
	return author, true
}
