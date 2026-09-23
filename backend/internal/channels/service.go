package channels

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,47}$`)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	mine := r.URL.Query().Get("mine") == "1"
	q := `
		SELECT ch.id::text, ch.slug, ch.title, ch.description, ch.rules, ch.owner_id::text, ch.created_at,
		       (SELECT COUNT(*)::int FROM channel_members cm WHERE cm.channel_id = ch.id) AS members,
		       EXISTS(SELECT 1 FROM channel_members cm2 WHERE cm2.channel_id = ch.id AND cm2.user_id = $1::uuid) AS joined
		FROM channels ch
		WHERE ch.deleted_at IS NULL`
	if mine {
		q += ` AND EXISTS(SELECT 1 FROM channel_members cm3 WHERE cm3.channel_id = ch.id AND cm3.user_id = $1::uuid)`
	}
	q += ` ORDER BY ch.created_at DESC LIMIT 50`
	rows, err := s.pool.Query(r.Context(), q, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, slug, title, desc, rules, owner string
		var created time.Time
		var members int
		var joined bool
		if err := rows.Scan(&id, &slug, &title, &desc, &rules, &owner, &created, &members, &joined); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "slug": slug, "title": title, "description": desc, "rules": rules,
			"owner_id": owner, "members": members, "joined": joined,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title       string `json:"title"`
		Slug        string `json:"slug"`
		Description string `json:"description"`
		Rules       string `json:"rules"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Description = strings.TrimSpace(req.Description)
	req.Rules = strings.TrimSpace(req.Rules)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 80 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1..80")
		return
	}
	if !slugRe.MatchString(req.Slug) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "slug: latin/digits/_- 2..48")
		return
	}
	if utf8.RuneCountInString(req.Description) > 1000 || utf8.RuneCountInString(req.Rules) > 2000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "description/rules too long")
		return
	}
	// Rate: max 5 channels created per day
	var createdToday int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM channels
		WHERE owner_id=$1::uuid AND created_at > now() - interval '24 hours' AND deleted_at IS NULL`, uid).Scan(&createdToday)
	if createdToday >= 5 {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "max 5 channels per day")
		return
	}
	id := uuid.New()
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var created time.Time
	err = tx.QueryRow(r.Context(), `
		INSERT INTO channels (id, owner_id, slug, title, description, rules)
		VALUES ($1, $2::uuid, $3, $4, $5, $6)
		RETURNING created_at`, id, uid, req.Slug, req.Title, req.Description, req.Rules).Scan(&created)
	if err != nil {
		if strings.Contains(err.Error(), "channels_slug_key") || strings.Contains(err.Error(), "duplicate") {
			apiutil.Error(w, http.StatusConflict, "conflict", "slug already taken")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2::uuid, 'owner')`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "slug": req.Slug, "title": req.Title,
		"description": req.Description, "rules": req.Rules, "owner_id": uid,
		"members": 1, "joined": true,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	key := chi.URLParam(r, "id")
	var id, slug, title, desc, rules, owner string
	var created time.Time
	var members int
	var joined bool
	q := `
		SELECT ch.id::text, ch.slug, ch.title, ch.description, ch.rules, ch.owner_id::text, ch.created_at,
		       (SELECT COUNT(*)::int FROM channel_members cm WHERE cm.channel_id = ch.id),
		       EXISTS(SELECT 1 FROM channel_members cm2 WHERE cm2.channel_id = ch.id AND cm2.user_id = $1::uuid)
		FROM channels ch WHERE ch.deleted_at IS NULL AND `
	var err error
	if _, e := uuid.Parse(key); e == nil {
		err = s.pool.QueryRow(r.Context(), q+`ch.id=$2::uuid`, uid, key).
			Scan(&id, &slug, &title, &desc, &rules, &owner, &created, &members, &joined)
	} else {
		err = s.pool.QueryRow(r.Context(), q+`ch.slug=$2`, uid, key).
			Scan(&id, &slug, &title, &desc, &rules, &owner, &created, &members, &joined)
	}
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	var myRole string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT role FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, id, uid).Scan(&myRole)
	out := map[string]any{
		"id": id, "slug": slug, "title": title, "description": desc, "rules": rules,
		"owner_id": owner, "members": members, "joined": joined,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	}
	if myRole != "" {
		out["my_role"] = myRole
	}
	apiutil.JSON(w, http.StatusOK, out)
}

func (s *Service) Join(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var joins int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM channel_join_log
		WHERE user_id=$1::uuid AND joined_at > now() - interval '1 hour'`, uid).Scan(&joins)
	if joins >= 20 {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many joins, try later")
		return
	}
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1::uuid AND deleted_at IS NULL)`, cid).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT DO NOTHING`, cid, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO channel_join_log (user_id, channel_id) VALUES ($1::uuid, $2::uuid)`, uid, cid)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "joined": true})
}

func (s *Service) Leave(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var role string
	err := s.pool.QueryRow(r.Context(), `
		SELECT role FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, uid).Scan(&role)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "not a member")
		return
	}
	if role == "owner" {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "owner cannot leave; delete channel instead")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, uid)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "joined": false})
}

func (s *Service) ListPosts(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT p.id::text, p.author_id::text, p.body, p.created_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM channel_posts p
		JOIN users u ON u.id = p.author_id
		WHERE p.channel_id=$1::uuid AND p.deleted_at IS NULL
		ORDER BY p.created_at DESC
		LIMIT $2`, cid, limit)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	_ = uid
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, author, body, username, display, avatar string
		var created time.Time
		if err := rows.Scan(&id, &author, &body, &created, &username, &display, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "author_id": author, "body": body,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"author": map[string]any{"id": author, "username": username, "display_name": display, "avatar_url": avatar},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) CreatePost(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var isMember bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid)`, cid, uid).Scan(&isMember)
	if !isMember {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "join channel to post")
		return
	}
	// Rate: max 30 posts / hour per user in a channel
	var recent int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM channel_posts
		WHERE channel_id=$1::uuid AND author_id=$2::uuid AND created_at > now() - interval '1 hour' AND deleted_at IS NULL`,
		cid, uid).Scan(&recent)
	if recent >= 30 {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many posts, slow down")
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
	if req.Body == "" || utf8.RuneCountInString(req.Body) > 4000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body 1..4000")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO channel_posts (id, channel_id, author_id, body)
		VALUES ($1, $2::uuid, $3::uuid, $4)
		RETURNING created_at`, id, cid, uid, req.Body).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "channel_id": cid, "author_id": uid, "body": req.Body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) isOwnerOrAdmin(ctx context.Context, channelID, userID string) (bool, string) {
	var role string
	err := s.pool.QueryRow(ctx, `
		SELECT role FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, channelID, userID).Scan(&role)
	if err != nil {
		return false, ""
	}
	return role == "owner" || role == "admin", role
}

// DeletePost DELETE /v1/channels/{id}/posts/{postId} — author or owner/admin
func (s *Service) DeletePost(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	pid := chi.URLParam(r, "postId")
	var authorID string
	err := s.pool.QueryRow(r.Context(), `
		SELECT author_id::text FROM channel_posts
		WHERE id=$1::uuid AND channel_id=$2::uuid AND deleted_at IS NULL`, pid, cid).Scan(&authorID)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	modOK, _ := s.isOwnerOrAdmin(r.Context(), cid, uid)
	if authorID != uid && !modOK {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only author or owner/admin")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE channel_posts SET deleted_at = now()
		WHERE id=$1::uuid AND channel_id=$2::uuid AND deleted_at IS NULL`, pid, cid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListMembers GET /v1/channels/{id}/members
func (s *Service) ListMembers(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	_ = uid
	rows, err := s.pool.Query(r.Context(), `
		SELECT cm.user_id::text, cm.role, cm.joined_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM channel_members cm
		JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
		WHERE cm.channel_id=$1::uuid
		ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at ASC
		LIMIT 200`, cid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var userID, role, username, display, avatar string
		var joined time.Time
		if err := rows.Scan(&userID, &role, &joined, &username, &display, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"user_id": userID, "role": role,
			"joined_at": joined.UTC().Format(time.RFC3339Nano),
			"username": username, "display_name": display, "avatar_url": avatar,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// KickMember DELETE /v1/channels/{id}/members/{userId} — owner/admin; cannot kick owner
func (s *Service) KickMember(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	target := chi.URLParam(r, "userId")
	if target == uid {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "cannot kick yourself; use leave")
		return
	}
	modOK, myRole := s.isOwnerOrAdmin(r.Context(), cid, uid)
	if !modOK {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "owner/admin only")
		return
	}
	var targetRole string
	err := s.pool.QueryRow(r.Context(), `
		SELECT role FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, target).Scan(&targetRole)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "member not found")
		return
	}
	if targetRole == "owner" {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot kick owner")
		return
	}
	if myRole == "admin" && targetRole == "admin" {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "admin cannot kick admin")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		DELETE FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, target)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "kicked": target})
}

