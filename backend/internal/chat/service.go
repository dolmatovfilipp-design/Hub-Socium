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
	"github.com/hub-socium/hub/backend/internal/quality"
	"github.com/hub-socium/hub/backend/internal/mentions"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	push *push.Service
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) SetPush(p *push.Service) { s.push = p }

func (s *Service) isBlockedEither(r *http.Request, a, b string) bool {
	var blocked bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM blocks
			WHERE (blocker_id = $1::uuid AND blocked_id = $2::uuid)
			   OR (blocker_id = $2::uuid AND blocked_id = $1::uuid)
		)`, a, b).Scan(&blocked)
	return blocked
}

func (s *Service) ListConversations(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	folder := strings.TrimSpace(r.URL.Query().Get("folder"))
	includeArchived := r.URL.Query().Get("archived") == "1"
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
		       ), 0) AS unread,
		       me.pinned_at, me.archived_at, COALESCE(me.folder,'inbox')
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
		ORDER BY me.pinned_at DESC NULLS LAST, c.updated_at DESC
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
		var pinnedAt, archivedAt *time.Time
		var folderVal string
		if err := rows.Scan(
			&cid, &updated,
			&peerID, &peerUsername, &peerDisplay, &peerAvatar,
			&lastID, &lastBody, &lastSender, &lastCreated,
			&unread, &pinnedAt, &archivedAt, &folderVal,
		); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if folder != "" && folderVal != folder {
			continue
		}
		if !includeArchived && folder == "" && archivedAt != nil {
			continue
		}
		item := map[string]any{
			"id":         cid.String(),
			"updated_at": updated.UTC().Format(time.RFC3339Nano),
			"unread":     unread,
			"pinned":     pinnedAt != nil,
			"archived":   archivedAt != nil,
			"folder":     folderVal,
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
		IsSecret bool   `json:"is_secret"`
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

	// S16: new-account + hourly DM create caps
	if age, err := quality.AccountAge(r.Context(), s.pool, uid); err == nil {
		sinceHour := time.Now().Add(-time.Hour)
		if n, err := quality.CountDMCreatesSince(r.Context(), s.pool, uid, sinceHour); err == nil && n >= quality.DMCreatePerHour {
			apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "too many chats this hour")
			return
		}
		if quality.IsNewAccount(age) {
			sinceDay := time.Now().Add(-quality.NewAccountHours * time.Hour)
			if n, err := quality.CountDMCreatesSince(r.Context(), s.pool, uid, sinceDay); err == nil && n >= quality.NewAccountMaxDM {
				apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "new accounts: max 10 new DMs / 24h")
				return
			}
		}
	}

	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND deleted_at IS NULL)`, peerID).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if s.isBlockedEither(r, uid, peerID) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot message blocked user")
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
		if _, err := tx.Exec(r.Context(), `INSERT INTO conversations (id, is_secret) VALUES ($1,$2)`, nid, req.IsSecret); err != nil {
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
	var peerLastRead *time.Time
	_ = s.pool.QueryRow(r.Context(), `
		SELECT last_read_at FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id <> $2::uuid LIMIT 1`, convID, uid).Scan(&peerLastRead)

	q := `
		SELECT id, sender_id, body, COALESCE(media_url,''), created_at, edited_at,
		       COALESCE(msg_type,'text'), COALESCE(duration_ms,0), reply_to_id, forward_of
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
		var body, mediaURL, msgType string
		var created time.Time
		var editedAt *time.Time
		var durationMs int
		var replyTo, forwardOf *uuid.UUID
		if err := rows.Scan(&id, &sender, &body, &mediaURL, &created, &editedAt, &msgType, &durationMs, &replyTo, &forwardOf); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id":              id.String(),
			"conversation_id": convID,
			"sender_id":       sender.String(),
			"body":            body,
			"created_at":      created.UTC().Format(time.RFC3339Nano),
			"msg_type":        msgType,
			"duration_ms":     durationMs,
		}
		if mediaURL != "" {
			item["media_url"] = mediaURL
		}
		if editedAt != nil {
			item["edited_at"] = editedAt.UTC().Format(time.RFC3339Nano)
		}
		if replyTo != nil {
			item["reply_to_id"] = replyTo.String()
		}
		if forwardOf != nil {
			item["forward_of"] = forwardOf.String()
		}
		if sender.String() == uid && peerLastRead != nil && !created.After(*peerLastRead) {
			item["read"] = true
		}
		rRows, rErr := s.pool.Query(r.Context(), `
			SELECT emoji, COUNT(*)::int,
			       BOOL_OR(user_id = $2::uuid)
			FROM message_reactions WHERE message_id=$1::uuid GROUP BY emoji`, id, uid)
		if rErr == nil {
			reacs := make([]map[string]any, 0)
			for rRows.Next() {
				var em string
				var cnt int
				var mine bool
				if rRows.Scan(&em, &cnt, &mine) == nil {
					reacs = append(reacs, map[string]any{"emoji": em, "count": cnt, "mine": mine})
				}
			}
			rRows.Close()
			if len(reacs) > 0 {
				item["reactions"] = reacs
			}
		}
		raw = append(raw, item)
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

	typingUID, typing := typingPeer(convID, uid)
	out := map[string]any{
		"items":       items,
		"next_cursor": next,
	}
	if typing {
		out["typing_user_id"] = typingUID
	}
	if peerLastRead != nil {
		out["peer_last_read_at"] = peerLastRead.UTC().Format(time.RFC3339Nano)
	}
	apiutil.JSON(w, http.StatusOK, out)
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
	var peerID string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT user_id::text FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id <> $2::uuid LIMIT 1`, convID, uid).Scan(&peerID)
	if peerID != "" && s.isBlockedEither(r, uid, peerID) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot message blocked user")
		return
	}
	var req struct {
		Body       string  `json:"body"`
		MediaURL   *string `json:"media_url"`
		MsgType    string  `json:"msg_type"`
		DurationMs int     `json:"duration_ms"`
		ReplyToID  *string `json:"reply_to_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	mediaURL := ""
	if req.MediaURL != nil {
		mediaURL = strings.TrimSpace(*req.MediaURL)
	}
	msgType := strings.TrimSpace(req.MsgType)
	if msgType == "" {
		msgType = "text"
	}
	if msgType != "text" && msgType != "voice" && msgType != "image" && msgType != "video_note" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "msg_type must be text, voice, image, or video_note")
		return
	}
	if msgType == "voice" {
		if mediaURL == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "voice requires media_url")
			return
		}
		if req.DurationMs <= 0 || req.DurationMs > 120000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "duration_ms must be 1..120000")
			return
		}
		if req.Body == "" {
			req.Body = "🎤 Голосовое сообщение"
		}
	}
	if msgType == "video_note" {
		if mediaURL == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "video_note requires media_url")
			return
		}
		if req.DurationMs <= 0 || req.DurationMs > 60000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "duration_ms must be 1..60000")
			return
		}
		if req.Body == "" {
			req.Body = "⭕️ Видеосообщение"
		}
	}
	var replyToID *string
	if req.ReplyToID != nil && strings.TrimSpace(*req.ReplyToID) != "" {
		rid := strings.TrimSpace(*req.ReplyToID)
		var okReply bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL)`,
			rid, convID).Scan(&okReply)
		if !okReply {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "reply_to_id not in conversation")
			return
		}
		replyToID = &rid
	}
	if req.Body == "" && mediaURL == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body or media_url required")
		return
	}
	if mediaURL != "" {
		if !strings.HasPrefix(mediaURL, "/v1/media/") && !strings.HasPrefix(mediaURL, "http://") && !strings.HasPrefix(mediaURL, "https://") {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "media_url must be /v1/media/{id} or http(s)")
			return
		}
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
		INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type, duration_ms, reply_to_id)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7, CASE WHEN $8::text IS NULL THEN NULL ELSE $8::uuid END)
		RETURNING created_at`, id, convID, uid, req.Body, mediaURL, msgType, req.DurationMs, replyToID).Scan(&created)
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

	{
		mid := id.String()
		mentions.ResolveAndNotify(r.Context(), s.pool, nil, s.push, uid, req.Body, nil, &mid)
	}

	// Push to peer (skip if no VAPID / muted)
	if s.push != nil {
		var peerID string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT user_id::text FROM conversation_members
			WHERE conversation_id = $1::uuid AND user_id <> $2::uuid
			LIMIT 1`, convID, uid).Scan(&peerID)
		var senderName string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id = $1::uuid`, uid).Scan(&senderName)
		preview := req.Body
		if msgType == "voice" {
			preview = "🎤 Голосовое сообщение"
		}
		if utf8.RuneCountInString(preview) > 80 {
			runes := []rune(preview)
			preview = string(runes[:80]) + "…"
		}
		var muted, convMuted bool
		if peerID != "" {
			_ = s.pool.QueryRow(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM mutes WHERE muter_id=$1::uuid AND muted_id=$2::uuid)`, peerID, uid).Scan(&muted)
			_ = s.pool.QueryRow(r.Context(), `
				SELECT EXISTS(SELECT 1 FROM conversation_mutes WHERE user_id=$1::uuid AND conversation_id=$2::uuid)`, peerID, convID).Scan(&convMuted)
		}
		if peerID != "" && !muted && !convMuted {
			s.push.NotifyUser(r.Context(), peerID, push.Payload{
				Title: senderName,
				Body:  preview,
				URL:   "/app/messages/" + convID,
				Type:  "message",
			})
		}
	}

	out := map[string]any{
		"id":              id.String(),
		"conversation_id": convID,
		"sender_id":       uid,
		"body":            req.Body,
		"created_at":      created.UTC().Format(time.RFC3339Nano),
		"msg_type":        msgType,
		"duration_ms":     req.DurationMs,
	}
	if replyToID != nil {
		out["reply_to_id"] = *replyToID
	}
	if mediaURL != "" {
		out["media_url"] = mediaURL
	}
	apiutil.JSON(w, http.StatusCreated, out)
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


func (s *Service) EditMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
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
	var sender string
	var deleted *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT sender_id::text, deleted_at FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid`,
		msgID, convID).Scan(&sender, &deleted)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if deleted != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if sender != uid {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only sender can edit")
		return
	}
	var created time.Time
	var edited time.Time
	var body, media string
	err = s.pool.QueryRow(r.Context(), `
		UPDATE messages SET body=$3, edited_at=now()
		WHERE id=$1::uuid AND sender_id=$2::uuid
		RETURNING body, COALESCE(media_url,''), created_at, edited_at`, msgID, uid, req.Body).
		Scan(&body, &media, &created, &edited)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := map[string]any{
		"id": msgID, "conversation_id": convID, "sender_id": uid, "body": body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"edited_at": edited.UTC().Format(time.RFC3339Nano),
	}
	if media != "" {
		out["media_url"] = media
	}
	apiutil.JSON(w, http.StatusOK, out)
}

func (s *Service) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE messages SET deleted_at = now()
		WHERE id=$1::uuid AND conversation_id=$2::uuid AND sender_id=$3::uuid AND deleted_at IS NULL`,
		msgID, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
