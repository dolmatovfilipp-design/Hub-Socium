package chat

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
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
		Pinned    *bool   `json:"pinned"`
		Archived  *bool   `json:"archived"`
		Folder    *string `json:"folder"`
		Title     *string `json:"title"`
		AvatarURL *string `json:"avatar_url"`
		PermSend  *string `json:"perm_send"`
		PermAdd   *string `json:"perm_add"`
		PermInfo  *string `json:"perm_info"`
		PermPin   *string `json:"perm_pin"`
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
	if req.PermSend != nil || req.PermAdd != nil || req.PermInfo != nil || req.PermPin != nil {
		if s.roleOf(r, uid, convID) != "owner" {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "Только владелец меняет права")
			return
		}
		var isGroup bool
		_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_group,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup)
		if !isGroup {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это не группа")
			return
		}
		setPerm := func(col string, val *string) bool {
			if val == nil {
				return true
			}
			v := strings.TrimSpace(*val)
			if !validPerm(v) {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Право: all или admins")
				return false
			}
			if _, err := s.pool.Exec(r.Context(), `UPDATE conversations SET `+col+`=$2 WHERE id=$1::uuid`, convID, v); err != nil {
				apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
				return false
			}
			return true
		}
		if !setPerm("perm_send", req.PermSend) || !setPerm("perm_add", req.PermAdd) || !setPerm("perm_info", req.PermInfo) || !setPerm("perm_pin", req.PermPin) {
			return
		}
	}
	if req.Title != nil || req.AvatarURL != nil {
		allowed, isGroup := s.mayAct(r, uid, convID, "info")
		if !isGroup {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это не группа")
			return
		}
		if !allowed {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "Менять описание могут только администраторы")
			return
		}
		if req.Title != nil {
			tt := strings.TrimSpace(*req.Title)
			if tt == "" || utf8.RuneCountInString(tt) > 80 {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1-80")
				return
			}
			_, _ = s.pool.Exec(r.Context(), `UPDATE conversations SET title=$2 WHERE id=$1::uuid`, convID, tt)
		}
		if req.AvatarURL != nil {
			av := strings.TrimSpace(*req.AvatarURL)
			var v any
			if av != "" {
				v = av
			}
			_, _ = s.pool.Exec(r.Context(), `UPDATE conversations SET avatar_url=$2 WHERE id=$1::uuid`, convID, v)
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
	var gTitle, gAvatar string
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(title,''), COALESCE(avatar_url,'') FROM conversations WHERE id=$1::uuid`, convID).Scan(&gTitle, &gAvatar)
	out := map[string]any{"ok": true, "id": convID, "folder": folder, "pinned": pinnedAt != nil, "archived": archivedAt != nil, "title": gTitle, "avatar_url": gAvatar}
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

// ForwardMessage POST /v1/conversations/{id}/forward
// {message_id, to_conversation_id} or {message_id, to_conversation_ids: []}.
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
		MessageID         string   `json:"message_id"`
		ToConversationID  string   `json:"to_conversation_id"`
		ToConversationIDs []string `json:"to_conversation_ids"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if strings.TrimSpace(req.MessageID) == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "message_id required")
		return
	}
	if len(req.ToConversationIDs) > 0 {
		s.forwardInto(w, r, uid, fromConv, req.MessageID, req.ToConversationIDs, true)
		return
	}
	s.forwardInto(w, r, uid, fromConv, req.MessageID, []string{req.ToConversationID}, false)
}
