package chat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/hub-socium/hub/backend/internal/mentions"
	"github.com/hub-socium/hub/backend/internal/presence"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/hub-socium/hub/backend/internal/quality"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool      *pgxpool.Pool
	push      *push.Service
	ws        *WSHub
	speech    SpeechConfig
	payShop   string
	paySecret string
	blobs     *media.Service
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, ws: NewWSHub()}
}

func (s *Service) SetPush(p *push.Service) { s.push = p }

// WS returns the realtime hub (may be nil only if Service constructed oddly).
func (s *Service) WS() *WSHub { return s.ws }

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

func (s *Service) listConversationsLegacy(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	folder := strings.TrimSpace(r.URL.Query().Get("folder"))
	includeArchived := r.URL.Query().Get("archived") == "1"
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.updated_at,
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''), COALESCE(peer.is_verified,false),
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
		var peerVerified bool
		var lastID *uuid.UUID
		var lastBody *string
		var lastSender *uuid.UUID
		var lastCreated *time.Time
		var unread int
		var pinnedAt, archivedAt *time.Time
		var folderVal string
		if err := rows.Scan(
			&cid, &updated,
			&peerID, &peerUsername, &peerDisplay, &peerAvatar, &peerVerified,
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
				"is_verified":  peerVerified,
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
	peerState, stateErr := s.recipientInboxState(r.Context(), uid, peerID)
	if stateErr != nil {
		if isMessageClosed(stateErr) {
			apiutil.Error(w, http.StatusForbidden, "forbidden", stateErr.Error())
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", stateErr.Error())
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
			INSERT INTO conversation_members (conversation_id, user_id, inbox_state) VALUES ($1,$2,'inbox'), ($1,$3,$4)`,
			nid, uid, peerID, peerState); err != nil {
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

func (s *Service) conversationItemLegacy(r *http.Request, uid, convID string) (map[string]any, error) {
	var updated time.Time
	var peerID uuid.UUID
	var peerUsername, peerDisplay, peerAvatar string
	var peerVerified bool
	var unread int
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.updated_at,
		       peer.id, peer.username, peer.display_name, COALESCE(peer.avatar_url,''), COALESCE(peer.is_verified,false),
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
		Scan(&updated, &peerID, &peerUsername, &peerDisplay, &peerAvatar, &peerVerified, &unread)
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
			"is_verified":  peerVerified,
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

	// Older messages via cursor (created_at, id) < cursor — chronological feed of history.
	// Listing the thread means this device has the messages, so advance delivery.
	s.noteDelivered(r.Context(), uid, convID)
	peerLastRead, peerLastDelivered := s.peerReceipts(r.Context(), convID, uid)

	threadFilter := strings.TrimSpace(r.URL.Query().Get("thread"))
	if threadFilter != "" {
		if _, err := uuid.Parse(threadFilter); err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "thread id")
			return
		}
	}
	q := `
		SELECT m.id, m.sender_id, m.body, COALESCE(m.media_url,''), m.created_at, m.edited_at,
		       COALESCE(m.msg_type,'text'), COALESCE(m.duration_ms,0), m.reply_to_id, m.forward_of,
		       m.expires_at, m.story_id, m.story_quote, m.meta, m.call_meta,
		       COALESCE(NULLIF(u.display_name,''), u.username, ''),
		       COALESCE(u.username,''),
		       COALESCE(m.view_once,false), m.thread_root_id,
		       COALESCE((SELECT COUNT(*)::int FROM messages tr WHERE tr.thread_root_id = m.id AND tr.deleted_at IS NULL), 0),
		       COALESCE(m.client_id,'')
		FROM messages m
		LEFT JOIN users u ON u.id = m.sender_id
		WHERE m.conversation_id = $1::uuid AND m.deleted_at IS NULL
		  AND (m.expires_at IS NULL OR m.expires_at > now())
		  AND NOT EXISTS (
		    SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $2::uuid
		  )
		  AND (
		    ($3::text = '' AND m.thread_root_id IS NULL)
		    OR ($3::text <> '' AND m.thread_root_id::text = $3::text)
		  )`
	args := []any{convID, uid, threadFilter}
	argN := 4
	if hasCursor {
		q += fmt.Sprintf(` AND (m.created_at, m.id) < ($%d::timestamptz, $%d::uuid)`, argN, argN+1)
		args = append(args, cursorCreated, cursorID)
		argN += 2
	}
	q += fmt.Sprintf(` ORDER BY m.created_at DESC, m.id DESC LIMIT $%d`, argN)
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
		var expiresAt *time.Time
		var storyID *uuid.UUID
		var storyQuote []byte
		var metaRaw []byte
		var callMeta []byte
		var senderName, senderUsername string
		var viewOnce bool
		var threadRoot *uuid.UUID
		var threadCount int
		var clientID string
		if err := rows.Scan(&id, &sender, &body, &mediaURL, &created, &editedAt, &msgType, &durationMs, &replyTo, &forwardOf, &expiresAt, &storyID, &storyQuote, &metaRaw, &callMeta, &senderName, &senderUsername, &viewOnce, &threadRoot, &threadCount, &clientID); err != nil {
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
		if clientID != "" {
			item["client_id"] = clientID
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
		if expiresAt != nil {
			item["expires_at"] = expiresAt.UTC().Format(time.RFC3339Nano)
		}
		if storyID != nil {
			item["story_id"] = storyID.String()
		}
		if len(storyQuote) > 0 {
			var sq any
			if json.Unmarshal(storyQuote, &sq) == nil {
				item["story_quote"] = sq
			}
		}
		if len(metaRaw) > 0 && string(metaRaw) != "null" {
			var mv any
			if json.Unmarshal(metaRaw, &mv) == nil && mv != nil {
				item["meta"] = mv
			}
		}
		if len(callMeta) > 0 {
			var cm any
			if json.Unmarshal(callMeta, &cm) == nil {
				item["call_meta"] = cm
			}
		}
		if senderName != "" {
			item["sender_name"] = senderName
		}
		if senderUsername != "" {
			item["sender_username"] = senderUsername
		}
		if viewOnce {
			if sender.String() == uid {
				item["view_once"] = "sent"
			} else {
				var opened bool
				_ = s.pool.QueryRow(r.Context(), `
					SELECT EXISTS(SELECT 1 FROM message_views WHERE message_id=$1 AND user_id=$2::uuid)`, id, uid).Scan(&opened)
				delete(item, "media_url")
				if opened {
					item["view_once"] = "opened"
					item["body"] = "Фото просмотрено"
				} else {
					item["view_once"] = "sealed"
					item["body"] = "Фото"
				}
			}
		}
		if threadRoot != nil {
			item["thread_root_id"] = threadRoot.String()
		}
		if threadCount > 0 {
			item["thread_count"] = threadCount
		}
		if sender.String() == uid {
			read := peerLastRead != nil && !created.After(*peerLastRead)
			delivered := read || (peerLastDelivered != nil && !created.After(*peerLastDelivered))
			item["read"] = read
			item["delivered"] = delivered
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
	s.attachTranscripts(r.Context(), items)
	s.overlayOrderStatus(r.Context(), convID, items)

	typingUID, typing := typingPeer(convID, uid)
	out := map[string]any{
		"items":       items,
		"next_cursor": next,
	}
	if typing {
		out["typing_user_id"] = typingUID
	}
	s.attachChatPolls(r, uid, convID, items)
	s.attachGroupSenders(r, convID, items)
	if peerLastRead != nil {
		out["peer_last_read_at"] = peerLastRead.UTC().Format(time.RFC3339Nano)
	}
	if peerLastDelivered != nil {
		out["peer_last_delivered_at"] = peerLastDelivered.UTC().Format(time.RFC3339Nano)
	}
	var peerSeen *time.Time
	var peerGender *string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT u.last_seen_at, u.gender
		FROM conversation_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.conversation_id=$1::uuid AND m.user_id<>$2::uuid
		  AND u.deleted_at IS NULL AND u.purged_at IS NULL
		  AND COALESCE(u.is_bot,false)=false
		ORDER BY m.joined_at ASC
		LIMIT 1`, convID, uid).Scan(&peerSeen, &peerGender)
	if peerSeen != nil {
		out["peer_last_seen_at"] = peerSeen.UTC().Format(time.RFC3339Nano)
		g := ""
		if peerGender != nil {
			g = *peerGender
		}
		out["peer_last_seen_label"] = presence.Label(*peerSeen, g, time.Now())
	}
	var pinnedID *string
	_ = s.pool.QueryRow(r.Context(), `SELECT pinned_message_id::text FROM conversations WHERE id=$1::uuid`, convID).Scan(&pinnedID)
	if pinnedID != nil && *pinnedID != "" {
		out["pinned_message_id"] = *pinnedID
		for _, it := range items {
			if it["id"] == *pinnedID {
				out["pinned_message"] = it
				break
			}
		}
		if out["pinned_message"] == nil {
			// pinned may be older than page — fetch stub
			var body string
			var sender string
			err := s.pool.QueryRow(r.Context(), `
				SELECT body, sender_id::text FROM messages m
				WHERE m.id=$1::uuid AND m.deleted_at IS NULL
				  AND NOT EXISTS (
				    SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $2::uuid
				  )`, *pinnedID, uid).
				Scan(&body, &sender)
			if err == nil {
				out["pinned_message"] = map[string]any{"id": *pinnedID, "body": body, "sender_id": sender}
			}
		}
	}
	apiutil.JSON(w, http.StatusOK, out)
}

func (s *Service) messageByClientID(ctx context.Context, convID, senderID, clientID string) (map[string]any, bool) {
	var id uuid.UUID
	var body, media, msgType string
	var duration int
	var created time.Time
	var reply *uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id, body, COALESCE(media_url,''), COALESCE(msg_type,'text'), COALESCE(duration_ms,0), created_at, reply_to_id
		FROM messages
		WHERE conversation_id=$1::uuid AND sender_id=$2::uuid AND client_id=$3 AND deleted_at IS NULL
		LIMIT 1`, convID, senderID, clientID).
		Scan(&id, &body, &media, &msgType, &duration, &created, &reply)
	if err != nil {
		return nil, false
	}
	out := map[string]any{
		"id":              id.String(),
		"conversation_id": convID,
		"sender_id":       senderID,
		"body":            body,
		"created_at":      created.UTC().Format(time.RFC3339Nano),
		"msg_type":        msgType,
		"duration_ms":     duration,
		"client_id":       clientID,
	}
	if media != "" {
		out["media_url"] = media
	}
	if reply != nil {
		out["reply_to_id"] = reply.String()
	}
	return out, true
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
		Body         string          `json:"body"`
		MediaURL     *string         `json:"media_url"`
		MsgType      string          `json:"msg_type"`
		DurationMs   int             `json:"duration_ms"`
		ReplyToID    *string         `json:"reply_to_id"`
		StoryID      *string         `json:"story_id"`
		Meta         json.RawMessage `json:"meta"`
		Poll         *pollInput      `json:"poll"`
		ViewOnce     bool            `json:"view_once"`
		ThreadRootID *string         `json:"thread_root_id"`
		ClientID     *string         `json:"client_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	clientID := ""
	if req.ClientID != nil {
		clientID = strings.TrimSpace(*req.ClientID)
	}
	if clientID != "" {
		if _, err := uuid.Parse(clientID); err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "client_id must be a uuid")
			return
		}
		if existing, ok := s.messageByClientID(r.Context(), convID, uid, clientID); ok {
			apiutil.JSON(w, http.StatusOK, existing)
			return
		}
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
	canSend, isGroup := s.mayAct(r, uid, convID, "send")
	if isGroup && !canSend {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Писать могут только администраторы")
		return
	}
	if !isGroup {
		var peerID string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT user_id::text FROM conversation_members
			WHERE conversation_id = $1::uuid AND user_id <> $2::uuid LIMIT 1`, convID, uid).Scan(&peerID)
		if peerID != "" && s.isBlockedEither(r, uid, peerID) {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "cannot message blocked user")
			return
		}
	}
	if msgType == "poll" {
		s.sendChatPoll(w, r, uid, convID, req.Poll)
		return
	}
	if !allowedClientMsgType(msgType) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "msg_type must be text, voice, image, video, video_note, file, sticker, gif, location, contact, or poll")
		return
	}
	if msgType == "video" {
		if mediaURL == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "video requires media_url")
			return
		}
		if req.Body == "" {
			req.Body = "🎬 Видео"
		}
	}
	if msgType == "file" {
		if mediaURL == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "file requires media_url")
			return
		}
		if req.Body == "" {
			req.Body = "📎 Файл"
		}
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
	var storyID *string
	var storyQuote []byte
	if req.StoryID != nil && strings.TrimSpace(*req.StoryID) != "" {
		sid := strings.TrimSpace(*req.StoryID)
		var bodyQ, mediaQ, authorQ string
		var createdQ time.Time
		errStory := s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(body,''), COALESCE(media_url,''), author_id::text, created_at
			FROM stories WHERE id=$1::uuid AND deleted_at IS NULL AND expires_at > now()`, sid).
			Scan(&bodyQ, &mediaQ, &authorQ, &createdQ)
		if errStory != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "story not found or expired")
			return
		}
		q := map[string]any{
			"story_id": sid, "body": bodyQ, "author_id": authorQ,
			"created_at": createdQ.UTC().Format(time.RFC3339Nano),
		}
		if mediaQ != "" {
			q["media_url"] = mediaQ
		}
		b, _ := json.Marshal(q)
		storyQuote = b
		storyID = &sid
		if req.Body == "" {
			req.Body = "Ответ на историю"
		}
	}
	metaMap, metaBytes, metaStatus, metaErr := parseMetaObject(req.Meta)
	if metaStatus != 0 {
		apiutil.Error(w, metaStatus, "validation_error", metaErr)
		return
	}
	if msgType == "sticker" || msgType == "gif" || msgType == "location" || msgType == "contact" {
		var st int
		var em string
		req.Body, mediaURL, st, em = applyRichMessage(msgType, req.Body, mediaURL, metaMap)
		if st != 0 {
			apiutil.Error(w, st, "validation_error", em)
			return
		}
	}
	var threadRoot *string
	if req.ThreadRootID != nil && strings.TrimSpace(*req.ThreadRootID) != "" {
		rid := strings.TrimSpace(*req.ThreadRootID)
		var isGroup, okRoot bool
		_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_group,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup)
		if !isGroup {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "ветки есть только в группах")
			return
		}
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL AND thread_root_id IS NULL)`,
			rid, convID).Scan(&okRoot)
		if !okRoot {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "thread root not in chat")
			return
		}
		threadRoot = &rid
	}
	if req.ViewOnce && (msgType != "image" || mediaURL == "") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "одноразовым может быть только фото")
		return
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
	var storyQuoteArg any
	if len(storyQuote) > 0 {
		storyQuoteArg = storyQuote
	}
	var metaArg any
	if len(metaBytes) > 0 {
		metaArg = metaBytes
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	err = tx.QueryRow(r.Context(), `
		INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type, duration_ms, reply_to_id, story_id, story_quote, meta, client_id)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,
		  CASE WHEN $8::text IS NULL THEN NULL ELSE $8::uuid END,
		  CASE WHEN $9::text IS NULL THEN NULL ELSE $9::uuid END,
		  $10, $11, NULLIF($12,''))
		RETURNING created_at`, id, convID, uid, req.Body, mediaURL, msgType, req.DurationMs, replyToID, storyID, storyQuoteArg, metaArg, clientID).Scan(&created)
	if err != nil {
		if clientID != "" && isUniqueViolation(err) {
			_ = tx.Rollback(r.Context())
			if existing, ok := s.messageByClientID(r.Context(), convID, uid, clientID); ok {
				apiutil.JSON(w, http.StatusOK, existing)
				return
			}
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if req.ViewOnce || threadRoot != nil {
		root := ""
		if threadRoot != nil {
			root = *threadRoot
		}
		_, err = tx.Exec(r.Context(), `
			UPDATE messages SET view_once=$2, thread_root_id=NULLIF($3,'')::uuid WHERE id=$1`, id, req.ViewOnce, root)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
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
	if !isGroup && msgType == "text" {
		s.noteHiddenWords(r.Context(), convID, uid, req.Body)
	}

	expiresAt := s.applyDisappearOnSend(r.Context(), convID, id.String())

	{
		mid := id.String()
		mentions.ResolveAndNotify(r.Context(), s.pool, nil, s.push, uid, req.Body, nil, &mid)
	}

	preview := req.Body
	if msgType == "voice" {
		preview = "🎤 Голосовое сообщение"
	}
	if msgType == "file" {
		if strings.HasPrefix(req.Body, "📎") {
			preview = req.Body
		} else {
			preview = "📎 " + req.Body
		}
	}
	if msgType == "image" {
		preview = "🖼 Фото"
	}
	if msgType == "video" || msgType == "video_note" {
		preview = "🎬 Видео"
	}
	if msgType == "sticker" {
		preview = "Стикер"
	}
	if msgType == "gif" {
		preview = "GIF"
	}
	if msgType == "location" {
		preview = "📍 Местоположение"
	}
	if msgType == "contact" {
		preview = "👤 Контакт"
	}
	if utf8.RuneCountInString(preview) > 80 {
		runes := []rune(preview)
		preview = string(runes[:80]) + "…"
	}
	s.notifyChatPeers(r.Context(), convID, uid, preview)

	out := map[string]any{
		"id":              id.String(),
		"conversation_id": convID,
		"sender_id":       uid,
		"body":            req.Body,
		"created_at":      created.UTC().Format(time.RFC3339Nano),
		"msg_type":        msgType,
		"duration_ms":     req.DurationMs,
	}
	if clientID != "" {
		out["client_id"] = clientID
	}
	if replyToID != nil {
		out["reply_to_id"] = *replyToID
	}
	if mediaURL != "" {
		out["media_url"] = mediaURL
	}
	if expiresAt != nil {
		out["expires_at"] = expiresAt.UTC().Format(time.RFC3339Nano)
	}
	if storyID != nil {
		out["story_id"] = *storyID
		if len(storyQuote) > 0 {
			var sq any
			if json.Unmarshal(storyQuote, &sq) == nil {
				out["story_quote"] = sq
			}
		}
	}
	if metaMap != nil {
		out["meta"] = metaMap
	}
	if req.ViewOnce {
		out["view_once"] = "sent"
	}
	if threadRoot != nil {
		out["thread_root_id"] = *threadRoot
	}
	s.BroadcastEvent(convID, map[string]any{
		"type": "message", "conversation_id": convID, "message": out,
	})
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
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var readAt time.Time
	err = tx.QueryRow(r.Context(), `
		UPDATE conversation_members
		SET last_read_at = now(), last_delivered_at = now()
		WHERE conversation_id = $1::uuid AND user_id = $2::uuid
		RETURNING last_read_at`, convID, uid).Scan(&readAt)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO conversation_read_log (conversation_id, user_id, read_at)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT DO NOTHING`, convID, uid, readAt); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `UPDATE users SET last_seen_at=$2 WHERE id=$1::uuid`, uid, readAt)
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.expireAfterRead(r.Context(), convID, uid)
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
	s.editMessageBody(r, w, uid, convID, msgID, strings.TrimSpace(req.Body))
}

func (s *Service) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if r.URL.Query().Get("for") == "me" || r.URL.Query().Get("scope") == "me" {
		s.HideMessage(w, r)
		return
	}
	convID := chi.URLParam(r, "id")
	msgID := chi.URLParam(r, "msgId")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var sender string
	var deleted *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT sender_id::text, deleted_at FROM messages
		WHERE id=$1::uuid AND conversation_id=$2::uuid`, msgID, convID).Scan(&sender, &deleted)
	if err != nil || deleted != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if sender != uid {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only the sender can delete for everyone")
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
