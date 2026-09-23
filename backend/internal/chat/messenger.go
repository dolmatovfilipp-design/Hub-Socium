package chat

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// PatchConversation PATCH /v1/conversations/{id} — pin / archive / folder
func (s *Service) PatchConversation(w http.ResponseWriter, r *http.Request) {
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
		Pinned   *bool   `json:"pinned"`
		Archived *bool   `json:"archived"`
		Folder   *string `json:"folder"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.Pinned != nil {
		if *req.Pinned {
			_, _ = s.pool.Exec(r.Context(), `
				UPDATE conversation_members SET pinned_at = now()
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
		} else {
			_, _ = s.pool.Exec(r.Context(), `
				UPDATE conversation_members SET pinned_at = NULL
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
		}
	}
	if req.Archived != nil {
		if *req.Archived {
			_, _ = s.pool.Exec(r.Context(), `
				UPDATE conversation_members SET archived_at = now(), folder = 'archive'
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
		} else {
			_, _ = s.pool.Exec(r.Context(), `
				UPDATE conversation_members SET archived_at = NULL,
				  folder = CASE WHEN folder = 'archive' THEN 'inbox' ELSE folder END
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid)
		}
	}
	if req.Folder != nil {
		f := strings.TrimSpace(*req.Folder)
		if f != "inbox" && f != "important" && f != "archive" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "folder: inbox|important|archive")
			return
		}
		_, err := s.pool.Exec(r.Context(), `
			UPDATE conversation_members SET folder=$3,
			  archived_at = CASE WHEN $3='archive' THEN COALESCE(archived_at, now()) ELSE NULL END
			WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid, f)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	var pinnedAt, archivedAt *time.Time
	var folder string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT pinned_at, archived_at, COALESCE(folder,'inbox')
		FROM conversation_members WHERE conversation_id=$1::uuid AND user_id=$2::uuid`,
		convID, uid).Scan(&pinnedAt, &archivedAt, &folder)
	out := map[string]any{"ok": true, "id": convID, "folder": folder, "pinned": pinnedAt != nil, "archived": archivedAt != nil}
	apiutil.JSON(w, http.StatusOK, out)
}

// ReactMessage POST /v1/conversations/{id}/messages/{msgId}/reactions {emoji}
func (s *Service) ReactMessage(w http.ResponseWriter, r *http.Request) {
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
		Emoji string `json:"emoji"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	emoji := strings.TrimSpace(req.Emoji)
	if emoji == "" || utf8.RuneCountInString(emoji) > 8 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "emoji required")
		return
	}
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL)`,
		msgID, convID).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO message_reactions (message_id, user_id, emoji)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT DO NOTHING`, msgID, uid, emoji)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "emoji": emoji})
}

// UnreactMessage DELETE /v1/conversations/{id}/messages/{msgId}/reactions?emoji=
func (s *Service) UnreactMessage(w http.ResponseWriter, r *http.Request) {
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
	emoji := strings.TrimSpace(r.URL.Query().Get("emoji"))
	if emoji == "" {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "emoji query required")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM message_reactions WHERE message_id=$1::uuid AND user_id=$2::uuid AND emoji=$3`,
		msgID, uid, emoji)
	w.WriteHeader(http.StatusNoContent)
}

// ForwardMessage POST /v1/conversations/{id}/forward {message_id, to_conversation_id}
func (s *Service) ForwardMessage(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	fromConv := chi.URLParam(r, "id")
	if !s.isMember(r, uid, fromConv) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var req struct {
		MessageID        string `json:"message_id"`
		ToConversationID string `json:"to_conversation_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if !s.isMember(r, uid, req.ToConversationID) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "not a member of target chat")
		return
	}
	var body, media, msgType string
	var durationMs int
	err := s.pool.QueryRow(r.Context(), `
		SELECT body, COALESCE(media_url,''), COALESCE(msg_type,'text'), COALESCE(duration_ms,0)
		FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL`,
		req.MessageID, fromConv).Scan(&body, &media, &msgType, &durationMs)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	id := uuid.New().String()
	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type, duration_ms, forward_of)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid)
		RETURNING created_at`, id, req.ToConversationID, uid, body, media, msgType, durationMs, req.MessageID).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE conversations SET updated_at=now() WHERE id=$1::uuid`, req.ToConversationID)
	out := map[string]any{
		"id": id, "conversation_id": req.ToConversationID, "sender_id": uid, "body": body,
		"msg_type": msgType, "duration_ms": durationMs, "forward_of": req.MessageID,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	}
	if media != "" {
		out["media_url"] = media
	}
	apiutil.JSON(w, http.StatusCreated, out)
}

// GetChatPrefs GET /v1/me/chat-prefs
func (s *Service) GetChatPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var theme, appearance string
	err := s.pool.QueryRow(r.Context(), `
		SELECT theme_id, appearance FROM user_chat_prefs WHERE user_id=$1::uuid`, uid).Scan(&theme, &appearance)
	if err != nil {
		theme, appearance = "default", "dark"
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"theme_id": theme, "appearance": appearance,
		"themes": []map[string]any{
			{"id": "default", "name": "Классика", "gradient": []string{"#000000", "#1c1c1e"}},
			{"id": "ocean", "name": "Океан", "gradient": []string{"#0a1628", "#1a4a6e"}},
			{"id": "sunset", "name": "Закат", "gradient": []string{"#1a0a0a", "#6e2a1a"}},
			{"id": "forest", "name": "Лес", "gradient": []string{"#0a1a0e", "#1a4a2e"}},
			{"id": "violet", "name": "Фиолет", "gradient": []string{"#120a1a", "#3a1a6e"}},
		},
	})
}

// UpdateChatPrefs PUT /v1/me/chat-prefs
func (s *Service) UpdateChatPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		ThemeID    string `json:"theme_id"`
		Appearance string `json:"appearance"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	allowedThemes := map[string]bool{"default": true, "ocean": true, "sunset": true, "forest": true, "violet": true}
	if req.ThemeID == "" {
		req.ThemeID = "default"
	}
	if !allowedThemes[req.ThemeID] {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "unknown theme")
		return
	}
	if req.Appearance == "" {
		req.Appearance = "dark"
	}
	if req.Appearance != "dark" && req.Appearance != "light" && req.Appearance != "system" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "appearance: dark|light|system")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO user_chat_prefs (user_id, theme_id, appearance, updated_at)
		VALUES ($1::uuid, $2, $3, now())
		ON CONFLICT (user_id) DO UPDATE SET theme_id=$2, appearance=$3, updated_at=now()`,
		uid, req.ThemeID, req.Appearance)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "theme_id": req.ThemeID, "appearance": req.Appearance})
}

