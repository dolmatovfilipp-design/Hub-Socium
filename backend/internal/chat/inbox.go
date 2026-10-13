package chat

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

// recipientInboxState decides where a new DM lands for the recipient.
// errMessageClosed means the recipient does not accept this sender.
func (s *Service) recipientInboxState(ctx context.Context, senderID, peerID string) (string, error) {
	var policy string
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(message_policy,'requests') FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, peerID).Scan(&policy)
	if err != nil {
		return "", err
	}
	var follows, restricted bool
	_ = s.pool.QueryRow(ctx, `
		SELECT
		  EXISTS(SELECT 1 FROM follows WHERE follower_id=$1::uuid AND followee_id=$2::uuid),
		  EXISTS(SELECT 1 FROM feed_signals WHERE user_id=$1::uuid AND kind='restrict' AND target_user_id=$2::uuid)`,
		peerID, senderID).Scan(&follows, &restricted)
	if restricted {
		return "request", nil
	}
	switch policy {
	case "none":
		return "", errMessageClosed
	case "following":
		if follows {
			return "inbox", nil
		}
		return "", errMessageClosed
	case "everyone":
		return "inbox", nil
	default:
		if follows {
			return "inbox", nil
		}
		return "request", nil
	}
}

var errMessageClosed = errClosed("Этот пользователь не принимает сообщения")

type errClosed string

func (e errClosed) Error() string { return string(e) }

func (s *Service) noteHiddenWords(ctx context.Context, convID, senderID, body string) {
	body = strings.ToLower(body)
	if strings.TrimSpace(body) == "" {
		return
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id::text, COALESCE(u.hidden_words,'')
		FROM conversation_members me
		JOIN users u ON u.id = me.user_id
		WHERE me.conversation_id=$1::uuid AND me.user_id <> $2::uuid`, convID, senderID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, words string
		if err := rows.Scan(&id, &words); err != nil {
			return
		}
		if wordsMatch(words, body) {
			_, _ = s.pool.Exec(ctx, `
				UPDATE conversation_members SET inbox_state='hidden'
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid AND inbox_state <> 'inbox'`, convID, id)
			_, _ = s.pool.Exec(ctx, `
				UPDATE conversation_members SET inbox_state='hidden'
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid AND inbox_state='request'`, convID, id)
			_, _ = s.pool.Exec(ctx, `
				UPDATE conversation_members SET inbox_state='hidden'
				WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, id)
		}
	}
}

func wordsMatch(list, body string) bool {
	for _, line := range strings.Split(list, "\n") {
		w := strings.ToLower(strings.TrimSpace(line))
		if len(w) < 2 {
			continue
		}
		if strings.Contains(body, w) {
			return true
		}
	}
	return false
}

func (s *Service) SetRequestState(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	var req struct {
		Action string `json:"action"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	state := "inbox"
	switch req.Action {
	case "accept":
		state = "inbox"
	case "hide":
		state = "hidden"
	default:
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "action: accept|hide")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members SET inbox_state=$3
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid, state)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "inbox_state": state})
}

func isMessageClosed(err error) bool {
	_, ok := err.(errClosed)
	if ok {
		return true
	}
	return err == pgx.ErrNoRows
}
