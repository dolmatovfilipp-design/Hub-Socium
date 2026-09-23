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
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/quality"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool     *pgxpool.Pool
	activity *activity.Service
	push     *push.Service
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

	if n, err := quality.CountPostsSince(r.Context(), s.pool, uid, time.Now().Add(-time.Hour)); err == nil && n >= quality.PostPerHour {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many posts this hour")
		return
	}

	var req struct {
		Body        string   `json:"body"`
		ImageURL    *string  `json:"image_url"`
		ImageURLs   []string `json:"image_urls"`
		Tags        []string `json:"tags"`
		Status      string   `json:"status"` // published|draft|scheduled
		ScheduledAt *string  `json:"scheduled_at"`
		RepostOf    *string  `json:"repost_of"`
		Poll        *struct {
			Question string   `json:"question"`
			Options  []string `json:"options"`
			Multi    bool     `json:"multi"`
		} `json:"poll"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	hasMedia := (req.ImageURL != nil && strings.TrimSpace(*req.ImageURL) != "") || len(req.ImageURLs) > 0
	hasPoll := req.Poll != nil && strings.TrimSpace(req.Poll.Question) != ""
	if req.Body == "" && !hasMedia && !hasPoll {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body, images, or poll required")
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
	tags := make([]string, 0, len(req.Tags))
	seen := map[string]bool{}
	for _, raw := range req.Tags {
		t := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(raw, "#")))
		if t == "" || seen[t] {
			continue
		}
		if len(t) > 32 {
			continue
		}
		seen[t] = true
		tags = append(tags, t)
		if len(tags) >= 5 {
			break
		}
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status == "" {
		status = "published"
	}
	if status != "published" && status != "draft" && status != "scheduled" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "status must be published, draft, or scheduled")
		return
	}
	var scheduledAt *time.Time
	if status == "scheduled" {
		if req.ScheduledAt == nil || strings.TrimSpace(*req.ScheduledAt) == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "scheduled_at required")
			return
		}
		tparse, err := time.Parse(time.RFC3339, strings.TrimSpace(*req.ScheduledAt))
		if err != nil {
			tparse, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(*req.ScheduledAt))
		}
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "scheduled_at must be RFC3339")
			return
		}
		if !tparse.After(time.Now().UTC()) {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "scheduled_at must be in the future")
			return
		}
		scheduledAt = &tparse
	}
	var repostOf any
	if req.RepostOf != nil && strings.TrimSpace(*req.RepostOf) != "" {
		ro := strings.TrimSpace(*req.RepostOf)
		if _, found := s.postAuthor(r, ro); !found {
			apiutil.Error(w, http.StatusNotFound, "not_found", "original post not found")
			return
		}
		repostOf = ro
	}

	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO posts (id, author_id, body, image_url, tags, status, scheduled_at, repost_of)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid)
		RETURNING created_at`, id, uid, req.Body, imageURL, tags, status, scheduledAt, repostOf).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if status == "published" {
		s.afterMentions(r, uid, req.Body, id.String())
	}
	out := map[string]any{
		"id":         id.String(),
		"author_id":  uid,
		"body":       req.Body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"likes":      0,
		"comments":   0,
		"tags":       tags,
		"status":     status,
	}
	if imageURL != "" {
		out["image_url"] = imageURL
	}
	urls := req.ImageURLs
	if imageURL != "" {
		urls = append([]string{imageURL}, urls...)
	}
	if saved := s.savePostImages(r, id.String(), urls); len(saved) > 0 {
		out["image_urls"] = saved
		out["image_url"] = saved[0]
	}
	if req.Poll != nil {
		if pl := s.createPollForPost(r, id.String(), pollIn{
			Question: req.Poll.Question, Options: req.Poll.Options, Multi: req.Poll.Multi,
		}); pl != nil {
			out["poll"] = pl
		}
	}
	if scheduledAt != nil {
		out["scheduled_at"] = scheduledAt.UTC().Format(time.RFC3339Nano)
	}
	if ro, ok := repostOf.(string); ok && ro != "" {
		out["repost_of"] = ro
		if nested := s.nestOriginal(r, ro); nested != nil {
			out["original"] = nested
		}
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
	// S17/P6: unique views per authenticated viewer (anonymous still counted each open)
	viewer, _ := apiutil.UserIDFromContext(r.Context())
	counted := false
	if viewer != "" {
		tag, err := s.pool.Exec(r.Context(), `
			INSERT INTO post_views (post_id, viewer_id) VALUES ($1::uuid,$2::uuid)
			ON CONFLICT (post_id, viewer_id) WHERE viewer_id IS NOT NULL DO NOTHING`, id, viewer)
		if err == nil && tag.RowsAffected() > 0 {
			counted = true
		}
	} else {
		_, err := s.pool.Exec(r.Context(), `INSERT INTO post_views (post_id) VALUES ($1::uuid)`, id)
		counted = err == nil
	}
	if counted {
		_, _ = s.pool.Exec(r.Context(), `UPDATE posts SET view_count = view_count + 1 WHERE id=$1::uuid`, id)
	}
	var vc int
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(view_count,0) FROM posts WHERE id=$1::uuid`, id).Scan(&vc)
	p["views"] = vc
	p["views_unique"] = true
	apiutil.JSON(w, http.StatusOK, p)
}


func (s *Service) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	author, found := s.postAuthor(r, id)
	if !found {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	if author != uid {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only author can delete")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE posts SET deleted_at = now()
		WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) fetch(r *http.Request, id string) (map[string]any, error) {
	var pid, authorID uuid.UUID
	var body, imageURL, status string
	var created time.Time
	var likes, comments, reposts int64
	var tags []string
	var repostOf *uuid.UUID
	var quoteText string
	err := s.pool.QueryRow(r.Context(), `
		SELECT p.id, p.author_id, p.body, COALESCE(p.image_url,''), p.created_at,
		       (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id),
		       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL),
		       (SELECT COUNT(*) FROM post_reposts pr WHERE pr.post_id = p.id),
		       COALESCE(p.status,'published'), COALESCE(p.tags,'{}'), p.repost_of
		FROM posts p
		WHERE p.id = $1 AND p.deleted_at IS NULL`, id).
		Scan(&pid, &authorID, &body, &imageURL, &created, &likes, &comments, &reposts, &status, &tags, &repostOf)
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
		"reposts":    reposts,
		"status":     status,
		"tags":       tags,
	}
	if imageURL != "" {
		out["image_url"] = imageURL
	}
	if uid, ok := apiutil.UserIDFromContext(r.Context()); ok {
		var liked, reposted bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2::uuid)`, id, uid).Scan(&liked)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM post_reposts WHERE post_id=$1 AND user_id=$2::uuid)`, id, uid).Scan(&reposted)
		out["liked_by_me"] = liked
		out["reposted_by_me"] = reposted
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(quote_text,'') FROM post_reposts WHERE post_id=$1 AND user_id=$2::uuid`, id, uid).Scan(&quoteText)
		if quoteText != "" {
			out["my_quote_text"] = quoteText
		}
	}
	if repostOf != nil {
		out["repost_of"] = repostOf.String()
		// avoid deep recursion: fetch original without nesting again
		var opid, oauthor uuid.UUID
		var obody, oimage string
		var ocreated time.Time
		var olikes, ocomments int64
		err2 := s.pool.QueryRow(r.Context(), `
			SELECT id, author_id, body, COALESCE(image_url,''), created_at,
			       (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id),
			       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id AND deleted_at IS NULL)
			FROM posts WHERE id = $1 AND deleted_at IS NULL`, *repostOf).
			Scan(&opid, &oauthor, &obody, &oimage, &ocreated, &olikes, &ocomments)
		if err2 == nil {
			orig := map[string]any{
				"id": opid.String(), "author_id": oauthor.String(), "body": obody,
				"created_at": ocreated.UTC().Format(time.RFC3339Nano),
				"likes": olikes, "comments": ocomments,
			}
			if oimage != "" {
				orig["image_url"] = oimage
			}
			out["original"] = orig
		}
	}
	s.attachPollAndImages(r, out)
	return out, nil
}

// Repost POST /v1/posts/{id}/repost — optional quote_text creates a quote post
func (s *Service) Repost(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	author, found := s.postAuthor(r, id)
	if !found {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	var req struct {
		QuoteText string `json:"quote_text"`
		Body      string `json:"body"` // alias
	}
	_ = apiutil.DecodeJSON(r, &req)
	quote := strings.TrimSpace(req.QuoteText)
	if quote == "" {
		quote = strings.TrimSpace(req.Body)
	}
	if utf8.RuneCountInString(quote) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "quote_text max 500")
		return
	}

	tag, err := s.pool.Exec(r.Context(), `
		INSERT INTO post_reposts (post_id, user_id, quote_text)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (post_id, user_id) DO UPDATE SET quote_text = EXCLUDED.quote_text`, id, uid, quote)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var quotePostID string
	if quote != "" {
		qid := uuid.New()
		err = s.pool.QueryRow(r.Context(), `
			INSERT INTO posts (id, author_id, body, status, repost_of)
			VALUES ($1, $2::uuid, $3, 'published', $4::uuid)
			RETURNING id::text`, qid, uid, quote, id).Scan(&quotePostID)
		if err == nil {
			s.afterMentions(r, uid, quote, quotePostID)
		} else {
			quotePostID = ""
		}
	}
	if tag.RowsAffected() > 0 && author != uid {
		meta := "{}"
		if quote != "" {
			meta = `{"quote":true}`
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO activities (user_id, actor_id, type, post_id, meta)
			VALUES ($1::uuid, $2::uuid, 'repost', $3::uuid, $4::jsonb)`, author, uid, id, meta)
	}
	p, err := s.fetch(r, id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if quotePostID != "" {
		p["quote_post_id"] = quotePostID
	}
	if quote != "" {
		p["quote_text"] = quote
	}
	apiutil.JSON(w, http.StatusOK, p)
}

// Unrepost DELETE /v1/posts/{id}/repost
func (s *Service) Unrepost(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM post_reposts WHERE post_id = $1::uuid AND user_id = $2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
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

// ListUserReposts GET /v1/users/{id}/reposts
func (s *Service) ListUserReposts(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "id")
	var target string
	if _, err := uuid.Parse(raw); err == nil {
		target = raw
	} else {
		err := s.pool.QueryRow(r.Context(), `
			SELECT id::text FROM users WHERE username = $1 AND deleted_at IS NULL`, raw).Scan(&target)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
				return
			}
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text, COALESCE(pr.quote_text,'')
		FROM post_reposts pr
		JOIN posts p ON p.id = pr.post_id AND p.deleted_at IS NULL
		WHERE pr.user_id = $1::uuid
		ORDER BY pr.created_at DESC
		LIMIT 50`, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var pid, qt string
		if err := rows.Scan(&pid, &qt); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		p, err := s.fetch(r, pid)
		if err != nil {
			continue
		}
		p["reposted_by"] = target
		if qt != "" {
			p["quote_text"] = qt
			p["is_quote"] = true
		} else {
			p["is_quote"] = false
		}
		items = append(items, p)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
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

func (s *Service) Report(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	postID := chi.URLParam(r, "id")
	author, found := s.postAuthor(r, postID)
	if !found {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "reason required")
		return
	}
	if utf8.RuneCountInString(req.Reason) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "reason max 500 characters")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO reports (id, reporter_id, post_id, reported_user_id, reason)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING created_at`, id, uid, postID, author, req.Reason).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id":               id.String(),
		"post_id":          postID,
		"reported_user_id": author,
		"reason":           req.Reason,
		"created_at":       created.UTC().Format(time.RFC3339Nano),
	})
}


func (s *Service) Bookmark(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	if _, found := s.postAuthor(r, id); !found {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	var req struct {
		FolderID *string `json:"folder_id"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	var folder any
	if req.FolderID != nil && strings.TrimSpace(*req.FolderID) != "" {
		fid := strings.TrimSpace(*req.FolderID)
		var owns bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM bookmark_folders WHERE id=$1::uuid AND user_id=$2::uuid)`, fid, uid).Scan(&owns)
		if owns {
			folder = fid
		}
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO post_bookmarks (post_id, user_id, folder_id) VALUES ($1::uuid,$2::uuid,$3)
		ON CONFLICT (post_id, user_id) DO UPDATE SET folder_id = COALESCE(EXCLUDED.folder_id, post_bookmarks.folder_id)`, id, uid, folder)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "bookmarked": true, "folder_id": folder})
}

func (s *Service) Unbookmark(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	_, err := s.pool.Exec(r.Context(), `
		DELETE FROM post_bookmarks WHERE post_id=$1::uuid AND user_id=$2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "bookmarked": false})
}

func (s *Service) ListBookmarks(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	folder := r.URL.Query().Get("folder_id")
	q := `
		SELECT p.id::text FROM post_bookmarks b
		JOIN posts p ON p.id = b.post_id AND p.deleted_at IS NULL
		WHERE b.user_id = $1::uuid`
	args := []any{uid}
	if folder == "null" || folder == "unfiled" {
		q += ` AND b.folder_id IS NULL`
	} else if folder != "" {
		q += ` AND b.folder_id = $2::uuid`
		args = append(args, folder)
	}
	q += ` ORDER BY b.created_at DESC LIMIT 100`
	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if p, err := s.fetch(r, id); err == nil {
			items = append(items, p)
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) ListMyLikes(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text FROM post_likes l
		JOIN posts p ON p.id = l.post_id AND p.deleted_at IS NULL
		WHERE l.user_id = $1::uuid
		ORDER BY l.created_at DESC LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if p, err := s.fetch(r, id); err == nil {
			items = append(items, p)
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}
