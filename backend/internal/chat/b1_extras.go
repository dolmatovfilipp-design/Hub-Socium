package chat

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

// PinMessage PUT /v1/conversations/{id}/pinned-message {message_id} — T4
func (s *Service) PinMessage(w http.ResponseWriter, r *http.Request) {
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
		MessageID *string `json:"message_id"` // null = unpin
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.MessageID == nil || strings.TrimSpace(*req.MessageID) == "" {
		_, _ = s.pool.Exec(r.Context(), `UPDATE conversations SET pinned_message_id=NULL WHERE id=$1::uuid`, convID)
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "pinned_message_id": nil})
		return
	}
	mid := strings.TrimSpace(*req.MessageID)
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL)`,
		mid, convID).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE conversations SET pinned_message_id=$2::uuid WHERE id=$1::uuid`, convID, mid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "pinned_message_id": mid})
}

// ListSharedMedia GET /v1/conversations/{id}/media — T5
func (s *Service) ListSharedMedia(w http.ResponseWriter, r *http.Request) {
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
	filter := r.URL.Query().Get("type") // image|voice|video_note|all
	q := `
		SELECT id::text, sender_id::text, body, COALESCE(media_url,''), COALESCE(msg_type,'text'),
		       COALESCE(duration_ms,0), created_at
		FROM messages
		WHERE conversation_id=$1::uuid AND deleted_at IS NULL
		  AND media_url IS NOT NULL AND media_url <> ''`
	args := []any{convID}
	switch filter {
	case "image":
		q += ` AND msg_type IN ('image','text')`
	case "voice":
		q += ` AND msg_type = 'voice'`
	case "video_note":
		q += ` AND msg_type = 'video_note'`
	}
	q += ` ORDER BY created_at DESC LIMIT 100`
	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, sender, body, media, msgType string
		var dur int
		var created time.Time
		if rows.Scan(&id, &sender, &body, &media, &msgType, &dur, &created) != nil {
			continue
		}
		kind := msgType
		if kind == "text" && media != "" {
			kind = "image"
		}
		items = append(items, map[string]any{
			"id": id, "sender_id": sender, "body": body, "media_url": media,
			"msg_type": kind, "duration_ms": dur,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// GetOrCreateSavedMessages GET|POST /v1/conversations/saved — T18 «Избранное»
func (s *Service) GetOrCreateSavedMessages(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var convID string
	err := s.pool.QueryRow(r.Context(), `
		SELECT c.id::text
		FROM conversations c
		JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1::uuid
		WHERE c.is_saved = true
		  AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) = 1
		LIMIT 1`, uid).Scan(&convID)
	if err == pgx.ErrNoRows {
		tx, err := s.pool.Begin(r.Context())
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		defer tx.Rollback(r.Context())
		nid := uuid.New()
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO conversations (id, is_saved) VALUES ($1, true)`, nid); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2::uuid)`, nid, uid); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		convID = nid.String()
	} else if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	item, err := s.conversationItem(r, uid, convID)
	if err != nil {
		// saved has no peer — synthesize
		var username, display, avatar string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT username, display_name, COALESCE(avatar_url,'') FROM users WHERE id=$1::uuid`, uid).
			Scan(&username, &display, &avatar)
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"id": convID, "updated_at": time.Now().UTC().Format(time.RFC3339Nano),
			"unread": 0, "is_saved": true,
			"peer": map[string]any{
				"id": uid, "username": username, "display_name": "Избранное", "avatar_url": avatar,
			},
			"last_message": nil,
		})
		return
	}
	item["is_saved"] = true
	if peer, ok := item["peer"].(map[string]any); ok {
		peer["display_name"] = "Избранное"
	}
	apiutil.JSON(w, http.StatusOK, item)
}
