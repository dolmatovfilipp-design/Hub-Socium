package posts

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// SendAttentionGift POST /v1/posts/{id}/attention  body: { sticker?: "✨" }
// or POST /v1/users/{id}/attention for profile gift
func (s *Service) SendAttentionGift(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	var req struct {
		Sticker string `json:"sticker"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	sticker := strings.TrimSpace(req.Sticker)
	if sticker == "" {
		sticker = "✨"
	}
	if len([]rune(sticker)) > 8 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "sticker too long")
		return
	}
	var authorID string
	err := s.pool.QueryRow(r.Context(), `
		SELECT author_id::text FROM posts WHERE id=$1::uuid AND deleted_at IS NULL`, postID).Scan(&authorID)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	if authorID == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot gift yourself")
		return
	}
	var already bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM attention_gifts WHERE from_user_id=$1::uuid AND post_id=$2::uuid)`, uid, postID).Scan(&already)
	if !already {
		id := uuid.New()
		_, err = s.pool.Exec(r.Context(), `
			INSERT INTO attention_gifts (id, from_user_id, to_user_id, post_id, sticker)
			VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`, id, uid, authorID, postID, sticker)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE posts SET attention_count = (
		  SELECT COUNT(*)::int FROM attention_gifts WHERE post_id=$1::uuid
		) WHERE id=$1::uuid`, postID)
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE users SET attention_count = (
		  SELECT COUNT(*)::int FROM attention_gifts WHERE to_user_id=$1::uuid
		) WHERE id=$1::uuid`, authorID)
	var count int
	_ = s.pool.QueryRow(r.Context(), `SELECT attention_count FROM posts WHERE id=$1::uuid`, postID).Scan(&count)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "attention_count": count, "sticker": sticker})
}

// SendProfileAttentionGift POST /v1/users/{id}/attention
func (s *Service) SendProfileAttentionGift(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	toID := chi.URLParam(r, "id")
	if toID == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot gift yourself")
		return
	}
	var req struct {
		Sticker string `json:"sticker"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	sticker := strings.TrimSpace(req.Sticker)
	if sticker == "" {
		sticker = "✨"
	}
	var already bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM attention_gifts WHERE from_user_id=$1::uuid AND to_user_id=$2::uuid AND post_id IS NULL)`, uid, toID).Scan(&already)
	var inserted bool
	if !already {
		id := uuid.New()
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO attention_gifts (id, from_user_id, to_user_id, post_id, sticker)
			VALUES ($1,$2::uuid,$3::uuid,NULL,$4)`, id, uid, toID, sticker)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		inserted = true
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE users SET attention_count = (
		  SELECT COUNT(*)::int FROM attention_gifts WHERE to_user_id=$1::uuid
		) WHERE id=$1::uuid`, toID)
	var count int
	_ = s.pool.QueryRow(r.Context(), `SELECT attention_count FROM users WHERE id=$1::uuid`, toID).Scan(&count)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "attention_count": count, "new": inserted, "sticker": sticker})
}
