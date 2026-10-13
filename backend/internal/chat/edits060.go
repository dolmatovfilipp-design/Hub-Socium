package chat

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// messageEditWindow is the product cap for editing the sender's own non-e2e
// text (and the caption types allowed by editableMsgType). 48 hours.
const messageEditWindow = 48 * time.Hour

// withinEditWindow allows the edit when the message is at most 48 hours old.
// A created time slightly in the future (clock skew) still counts as inside the window.
func withinEditWindow(created, now time.Time) bool {
	return now.Sub(created) <= messageEditWindow
}

// ListMessageEdits GET /v1/conversations/{id}/messages/{msgId}/edits
func (s *Service) ListMessageEdits(w http.ResponseWriter, r *http.Request) {
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
	var body string
	var created time.Time
	var edited *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT m.body, m.created_at, m.edited_at
		FROM messages m
		WHERE m.id = $1::uuid AND m.conversation_id = $2::uuid AND m.deleted_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $3::uuid
		  )`, msgID, convID, uid).Scan(&body, &created, &edited)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, body, edited_at
		FROM message_edits
		WHERE message_id = $1::uuid
		ORDER BY edited_at ASC, id ASC`, msgID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, prev string
		var at time.Time
		if err := rows.Scan(&id, &prev, &at); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "body": prev, "edited_at": at.UTC().Format(time.RFC3339Nano),
		})
	}
	out := map[string]any{
		"items":      items,
		"body":       body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	}
	if edited != nil {
		out["edited_at"] = edited.UTC().Format(time.RFC3339Nano)
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// editMessageBody stores the previous body in message_edits, then updates the row.
// Secret chats and non-text payloads are rejected.
func (s *Service) editMessageBody(r *http.Request, w http.ResponseWriter, uid, convID, msgID, next string) {
	if next == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body required")
		return
	}
	if utf8.RuneCountInString(next) > 4000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "body max 4000 characters")
		return
	}
	var sender, msgType, oldBody string
	var deleted *time.Time
	var secret bool
	var sentAt time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT m.sender_id::text, m.deleted_at, COALESCE(m.msg_type,'text'), m.body, COALESCE(c.is_secret,false), m.created_at
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id = $1::uuid AND m.conversation_id = $2::uuid`, msgID, convID).
		Scan(&sender, &deleted, &msgType, &oldBody, &secret, &sentAt)
	if err != nil || deleted != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if !strings.EqualFold(sender, uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only sender can edit")
		return
	}
	if secret || strings.EqualFold(msgType, "e2e") {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "secret chats cannot be edited")
		return
	}
	if !withinEditWindow(sentAt, time.Now()) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "edit window is 48 hours")
		return
	}
	if !editableMsgType(msgType) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "this message cannot be edited")
		return
	}
	if oldBody == next {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "message unchanged")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO message_edits (message_id, body, edited_at)
		SELECT id, body, COALESCE(edited_at, created_at)
		FROM messages
		WHERE id = $1::uuid AND sender_id = $2::uuid AND deleted_at IS NULL`, msgID, uid); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var body, media string
	var created, edited time.Time
	err = tx.QueryRow(r.Context(), `
		UPDATE messages SET body = $3, edited_at = now()
		WHERE id = $1::uuid AND sender_id = $2::uuid AND deleted_at IS NULL
		RETURNING body, COALESCE(media_url,''), created_at, edited_at`, msgID, uid, next).
		Scan(&body, &media, &created, &edited)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := map[string]any{
		"id": msgID, "conversation_id": convID, "sender_id": uid, "body": body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"edited_at":  edited.UTC().Format(time.RFC3339Nano),
		"msg_type":   msgType,
	}
	if media != "" {
		out["media_url"] = media
	}
	s.BroadcastEvent(convID, map[string]any{
		"type": "message", "conversation_id": convID, "message": out,
	})
	apiutil.JSON(w, http.StatusOK, out)
}
