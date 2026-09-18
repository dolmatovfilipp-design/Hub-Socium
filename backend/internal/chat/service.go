package chat

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) ListConversations(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.updated_at,
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''),
		       lm.id, lm.body, lm.sender_id, lm.created_at,
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id
		           AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		       ), 0) AS unread
		FROM conversation_members me
		JOIN conversations c ON c.id = me.conversation_id
		JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id <> $1::uuid
		JOIN users peer ON peer.id = other.user_id AND peer.deleted_at IS NULL
		LEFT JOIN LATERAL (
		  SELECT m.id, m.body, m.sender_id, m.created_at
		  FROM messages m
		  WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
		  ORDER BY m.created_at DESC, m.id DESC
		  LIMIT 1
		) lm ON true
		WHERE me.user_id = $1::uuid
		ORDER BY c.updated_at DESC
		LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var cid uuid.UUID
		var updated time.Time
		var peerID uuid.UUID
		var peerUsername, peerDisplay, peerAvatar string
		var lastID *uuid.UUID
		var lastBody *string
		var lastSender *uuid.UUID
		var lastCreated *time.Time
		var unread int
		if err := rows.Scan(
			&cid, &updated,
			&peerID, &peerUsername, &peerDisplay, &peerAvatar,
			&lastID, &lastBody, &lastSender, &lastCreated,
			&unread,
		); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id":         cid.String(),
			"updated_at": updated.UTC().Format(time.RFC3339Nano),
			"unread":     unread,
			"peer": map[string]any{
				"id":           peerID.String(),
				"username":     peerUsername,
				"display_name": peerDisplay,
				"avatar_url":   peerAvatar,
			},
		}
		if lastID != nil && lastBody != nil && lastSender != nil && lastCreated != nil {
			item["last_message"] = map[string]any{
				"id":         lastID.String(),
				"body":       *lastBody,
				"sender_id":  lastSender.String(),
				"created_at": lastCreated.UTC().Format(time.RFC3339Nano),
			}
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) CreateConversation(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		UserID   string `json:"user_id"`
		Username string `json:"username"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}

	var peerID string
	var err error
	switch {
	case req.UserID != "":
		peerID = req.UserID
	case req.Username != "":
		err = s.pool.QueryRow(r.Context(), `
			SELECT id::text FROM users WHERE username = $1 AND deleted_at IS NULL`, req.Username).Scan(&peerID)
		if err != nil {
			if err == pgx.ErrNoRows {
				apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
				return
			}
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	default:
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "user_id or username required")
		return
	}
	if peerID == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot message yourself")
		return
	}
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND deleted_at IS NULL)`, peerID).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}

	// get-or-create 1:1
	var convID string
	err = s.pool.QueryRow(r.Context(), `
		SELECT c.id::text
		FROM conversations c
		JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1::uuid
		JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2::uuid
		WHERE (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
		LIMIT 1`, uid, peerID).Scan(&convID)
	created := false
	if err == pgx.ErrNoRows {
		tx, err := s.pool.Begin(r.Context())
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		defer tx.Rollback(r.Context())
		nid := uuid.New()
		if _, err := tx.Exec(r.Context(), `INSERT INTO conversations (id) VALUES ($1)`, nid); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2), ($1,$3)`,
			nid, uid, peerID); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		convID = nid.String()
		created = true
	} else if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	item, err := s.conversationItem(r, uid, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	apiutil.JSON(w, status, item)
}

func (s *Service) conversationItem(r *http.Request, uid, convID string) (map[string]any, error) {
	var updated time.Time
	var peerID uuid.UUID
	var peerUsername, peerDisplay, peerAvatar string
	var unread int
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.updated_at,
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''),
		       COALESCE((
		         SELECT COUNT(*)::int FROM messages m
		         WHERE m.conversation_id = c.id
		           AND m.deleted_at IS NULL
		           AND m.sender_id <> $1::uuid
		           AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
		       ), 0)
		FROM conversations c
		JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1::uuid
		JOIN conversation_members other ON other.conversation_id = c.id AND other.user_id <> $1::uuid
		JOIN users peer ON peer.id = other.user_id
		WHERE c.id = $2::uuid`, uid, convID).
		Scan(&updated, &peerID, &peerUsername, &peerDisplay, &peerAvatar, &unread)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":         convID,
		"updated_at": updated.UTC().Format(time.RFC3339Nano),
		"unread":     unread,
		"peer": map[string]any{
			"id":           peerID.String(),
			"username":     peerUsername,
			"display_name": peerDisplay,
			"avatar_url":   peerAvatar,
		},
	}, nil
}

func (s *Service) ListMessages(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 100 {
		limit = 100
	}
	cursorCreated, cursorID, hasCursor := decodeCursor(r.URL.Query().Get("cursor"))

	// Older messages via cursor (created_at, id) < cursor — chronological feed of history
	q := `
		SELECT id, sender_id, body, created_at
		FROM messages
		WHERE conversation_id = $1::uuid AND deleted_at IS NULL`
	args := []any{convID}
	argN := 2
	if hasCursor {
		q += fmt.Sprintf(` AND (created_at, id) < ($%d::timestamptz, $%d::uuid)`, argN, argN+1)
		args = append(args, cursorCreated, cursorID)
		argN += 2
	}
	q += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d`, argN)
	args = append(args, limit+1)

	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()

	raw := make([]map[string]any, 0)
	for rows.Next() {
		var id, sender uuid.UUID
		var body string
		var created time.Time
		if err := rows.Scan(&id, &sender, &body, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		raw = append(raw, map[string]any{
			"id":              id.String(),
			"conversation_id": convID,
			"sender_id":       sender.String(),
			"body":            body,
			"created_at":      created.UTC().Format(time.RFC3339Nano),
		})
	}

	var next any
	if len(raw) > limit {
		last := raw[limit-1]
		raw = raw[:limit]
		next = encodeCursor(last["created_at"].(string), last["id"].(string))
	}

	// Return chronological ascending for UI
	items := make([]map[string]any, len(raw))
	for i := range raw {
		items[len(raw)-1-i] = raw[i]
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": next,
	})
}

func (s *Service) SendMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
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
	if utf8.RuneCountInString(req.Body) > 4000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body max 4000 characters")
		return
	}

	id := uuid.New()
	var created time.Time
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	err = tx.QueryRow(r.Context(), `
		INSERT INTO messages (id, conversation_id, sender_id, body)
		VALUES ($1,$2::uuid,$3::uuid,$4)
		RETURNING created_at`, id, convID, uid, req.Body).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE conversations SET updated_at = $1 WHERE id = $2::uuid`, created, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// Sender has read up to this message
	_, _ = tx.Exec(r.Context(), `
		UPDATE conversation_members SET last_read_at = $1
		WHERE conversation_id = $2::uuid AND user_id = $3::uuid`, created, convID, uid)
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id":              id.String(),
		"conversation_id": convID,
		"sender_id":       uid,
		"body":            req.Body,
		"created_at":      created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) MarkRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members SET last_read_at = now()
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) isMember(r *http.Request, uid, convID string) bool {
	var ok bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
		  SELECT 1 FROM conversation_members
		  WHERE conversation_id = $1::uuid AND user_id = $2::uuid
		)`, convID, uid).Scan(&ok)
	return ok
}

func encodeCursor(createdAt, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt + "|" + id))
}

func decodeCursor(c string) (time.Time, string, bool) {
	if c == "" {
		return time.Time{}, "", false
	}
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", false
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		t, err = time.Parse(time.RFC3339, parts[0])
		if err != nil {
			return time.Time{}, "", false
		}
	}
	return t, parts[1], true
}
