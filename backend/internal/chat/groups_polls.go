package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/mentions"
	"github.com/hub-socium/hub/backend/internal/push"
)

type pollInput struct {
	Question  string   `json:"question"`
	Options   []string `json:"options"`
	Multiple  bool     `json:"multiple"`
	Anonymous *bool    `json:"anonymous"`
}

func parsePollOptions(raw []byte) []string {
	var strs []string
	if json.Unmarshal(raw, &strs) == nil && len(strs) > 0 {
		return strs
	}
	var objs []map[string]any
	if json.Unmarshal(raw, &objs) != nil || len(objs) == 0 {
		return nil
	}
	out := make([]string, 0, len(objs))
	for _, o := range objs {
		label, _ := o["label"].(string)
		if strings.TrimSpace(label) == "" {
			label, _ = o["text"].(string)
		}
		label = strings.TrimSpace(label)
		if label != "" {
			out = append(out, label)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *Service) sendChatPoll(w http.ResponseWriter, r *http.Request, uid, convID string, in *pollInput) {
	if in == nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нужен опрос")
		return
	}
	q := strings.TrimSpace(in.Question)
	if q == "" || utf8.RuneCountInString(q) > 200 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Вопрос: 1–200 символов")
		return
	}
	opts := make([]string, 0, len(in.Options))
	for _, o := range in.Options {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if utf8.RuneCountInString(o) > 100 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Вариант до 100 символов")
			return
		}
		opts = append(opts, o)
	}
	if len(opts) > 10 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Максимум 10 вариантов")
		return
	}
	if len(opts) < 2 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нужно минимум 2 варианта")
		return
	}
	anon := true
	if in.Anonymous != nil {
		anon = *in.Anonymous
	}
	raw, err := json.Marshal(opts)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
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
		INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type)
		VALUES ($1, $2::uuid, $3::uuid, $4, '', 'poll')
		RETURNING created_at`, id, convID, uid, q).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO chat_polls (message_id, conversation_id, creator_id, question, options, multiple, anonymous)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
		id, convID, uid, q, raw, in.Multiple, anon); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE conversations SET updated_at=$1 WHERE id=$2::uuid`, created, convID); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `
		UPDATE conversation_members SET last_read_at=$1
		WHERE conversation_id=$2::uuid AND user_id=$3::uuid`, created, convID, uid)
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	expiresAt := s.applyDisappearOnSend(r.Context(), convID, id.String())
	mid := id.String()
	mentions.ResolveAndNotify(r.Context(), s.pool, nil, s.push, uid, q, nil, &mid)
	preview := "📊 " + q
	if utf8.RuneCountInString(preview) > 80 {
		preview = string([]rune(preview)[:80]) + "…"
	}
	s.notifyChatPeers(r.Context(), convID, uid, preview)
	poll := s.pollPayload(r, uid, convID, id.String())
	out := map[string]any{
		"id":              id.String(),
		"conversation_id": convID,
		"sender_id":       uid,
		"body":            q,
		"created_at":      created.UTC().Format(time.RFC3339Nano),
		"msg_type":        "poll",
		"duration_ms":     0,
	}
	if poll != nil {
		out["poll"] = poll
	}
	if expiresAt != nil {
		out["expires_at"] = expiresAt.UTC().Format(time.RFC3339Nano)
	}
	s.BroadcastEvent(convID, map[string]any{"type": "message", "conversation_id": convID, "message": out})
	apiutil.JSON(w, http.StatusCreated, out)
}

// VoteChatPoll POST /v1/conversations/{id}/messages/{msgId}/poll/vote
func (s *Service) VoteChatPoll(w http.ResponseWriter, r *http.Request) {
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
		OptionIdx  *int  `json:"option_idx"`
		OptionIdxs []int `json:"option_idxs"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	idxs := req.OptionIdxs
	if req.OptionIdx != nil {
		idxs = []int{*req.OptionIdx}
	}
	if len(idxs) == 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Выберите вариант")
		return
	}
	var optionsRaw []byte
	var multiple bool
	var closed *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT options, multiple, closed_at FROM chat_polls
		WHERE message_id=$1::uuid AND conversation_id=$2::uuid`, msgID, convID).
		Scan(&optionsRaw, &multiple, &closed)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Опрос не найден")
		return
	}
	if closed != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Опрос завершён")
		return
	}
	labels := parsePollOptions(optionsRaw)
	chosen := idxs[0]
	if !multiple && len(idxs) > 1 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Можно выбрать один вариант")
		return
	}
	for _, i := range idxs {
		if i < 0 || i >= len(labels) {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нет такого варианта")
			return
		}
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if !multiple {
		if _, err := tx.Exec(r.Context(), `
			DELETE FROM chat_poll_votes WHERE message_id=$1::uuid AND user_id=$2::uuid AND option_idx <> $3`,
			msgID, uid, chosen); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO chat_poll_votes (message_id, user_id, option_idx)
			VALUES ($1::uuid, $2::uuid, $3)
			ON CONFLICT DO NOTHING`, msgID, uid, chosen); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	} else {
		for _, i := range idxs {
			tag, err := tx.Exec(r.Context(), `
				DELETE FROM chat_poll_votes WHERE message_id=$1::uuid AND user_id=$2::uuid AND option_idx=$3`,
				msgID, uid, i)
			if err != nil {
				apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
				return
			}
			if tag.RowsAffected() == 0 {
				if _, err := tx.Exec(r.Context(), `
					INSERT INTO chat_poll_votes (message_id, user_id, option_idx)
					VALUES ($1::uuid, $2::uuid, $3)
					ON CONFLICT DO NOTHING`, msgID, uid, i); err != nil {
					apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
					return
				}
			}
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	poll := s.pollPayload(r, uid, convID, msgID)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "poll": poll})
}

// CloseChatPoll POST /v1/conversations/{id}/messages/{msgId}/poll/close
func (s *Service) CloseChatPoll(w http.ResponseWriter, r *http.Request) {
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
	var creator *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT creator_id::text FROM chat_polls WHERE message_id=$1::uuid AND conversation_id=$2::uuid`,
		msgID, convID).Scan(&creator)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "Опрос не найден")
		return
	}
	role := s.roleOf(r, uid, convID)
	if (creator == nil || *creator != uid) && !staffRole(role) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Закрыть опрос может автор или администратор")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE chat_polls SET closed_at=COALESCE(closed_at, now())
		WHERE message_id=$1::uuid`, msgID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "poll": s.pollPayload(r, uid, convID, msgID)})
}

func (s *Service) pollPayload(r *http.Request, uid, convID, msgID string) map[string]any {
	var question string
	var optionsRaw []byte
	var multiple, anonymous bool
	var closed *time.Time
	var creator *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT question, options, multiple, anonymous, closed_at, creator_id::text
		FROM chat_polls WHERE message_id=$1::uuid AND conversation_id=$2::uuid`, msgID, convID).
		Scan(&question, &optionsRaw, &multiple, &anonymous, &closed, &creator)
	if err != nil {
		return nil
	}
	labels := parsePollOptions(optionsRaw)
	if labels == nil {
		labels = []string{}
	}
	counts := map[int]int{}
	voters := map[int][]string{}
	rows, qerr := s.pool.Query(r.Context(), `
		SELECT v.option_idx, COALESCE(NULLIF(u.display_name,''), u.username)
		FROM chat_poll_votes v
		JOIN users u ON u.id = v.user_id
		WHERE v.message_id=$1::uuid
		ORDER BY v.created_at`, msgID)
	if qerr == nil {
		for rows.Next() {
			var idx int
			var name string
			if rows.Scan(&idx, &name) == nil {
				counts[idx]++
				voters[idx] = append(voters[idx], name)
			}
		}
		rows.Close()
	}
	my := map[int]bool{}
	mrows, merr := s.pool.Query(r.Context(), `
		SELECT option_idx FROM chat_poll_votes WHERE message_id=$1::uuid AND user_id=$2::uuid`, msgID, uid)
	if merr == nil {
		for mrows.Next() {
			var idx int
			if mrows.Scan(&idx) == nil {
				my[idx] = true
			}
		}
		mrows.Close()
	}
	options := make([]map[string]any, 0, len(labels))
	total := 0
	myVotes := make([]int, 0)
	seenVoters := map[string]struct{}{}
	for i, label := range labels {
		item := map[string]any{"idx": i, "label": label, "votes": counts[i], "voted": my[i]}
		if !anonymous {
			names := voters[i]
			if names == nil {
				names = []string{}
			}
			item["voters"] = names
		}
		options = append(options, item)
		if my[i] {
			myVotes = append(myVotes, i)
		}
	}
	vrows, verr := s.pool.Query(r.Context(), `
		SELECT user_id::text FROM chat_poll_votes WHERE message_id=$1::uuid`, msgID)
	if verr == nil {
		for vrows.Next() {
			var id string
			if vrows.Scan(&id) == nil {
				seenVoters[id] = struct{}{}
			}
		}
		vrows.Close()
		total = len(seenVoters)
	}
	role := s.roleOf(r, uid, convID)
	canClose := (creator != nil && *creator == uid) || staffRole(role)
	return map[string]any{
		"question":     question,
		"options":      options,
		"multiple":     multiple,
		"anonymous":    anonymous,
		"closed":       closed != nil,
		"total_voters": total,
		"my_votes":     myVotes,
		"can_close":    canClose,
	}
}

func (s *Service) attachChatPolls(r *http.Request, uid, convID string, items []map[string]any) {
	for _, it := range items {
		if it["msg_type"] != "poll" {
			continue
		}
		id, _ := it["id"].(string)
		if p := s.pollPayload(r, uid, convID, id); p != nil {
			it["poll"] = p
		}
	}
}

func (s *Service) attachGroupSenders(r *http.Request, convID string, items []map[string]any) {
	var isGroup bool
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_group,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&isGroup)
	if !isGroup || len(items) == 0 {
		return
	}
	seen := map[uuid.UUID]struct{}{}
	ids := make([]uuid.UUID, 0)
	for _, it := range items {
		sid, _ := it["sender_id"].(string)
		u, err := uuid.Parse(sid)
		if err != nil {
			continue
		}
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		ids = append(ids, u)
	}
	if len(ids) == 0 {
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, username, display_name, COALESCE(avatar_url,'')
		FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, ids)
	if err != nil {
		return
	}
	defer rows.Close()
	byID := map[string]map[string]any{}
	for rows.Next() {
		var id, uname, display, avatar string
		if rows.Scan(&id, &uname, &display, &avatar) != nil {
			continue
		}
		byID[id] = map[string]any{"id": id, "username": uname, "display_name": display, "avatar_url": avatar}
	}
	for _, it := range items {
		sid, _ := it["sender_id"].(string)
		if sender, ok := byID[sid]; ok {
			it["sender"] = sender
		}
	}
}

func (s *Service) copyChatPoll(ctx context.Context, fromMsg, toMsg, toConv, creator string) {
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO chat_polls (message_id, conversation_id, creator_id, question, options, multiple, anonymous)
		SELECT $2::uuid, $3::uuid, $4::uuid, question, options, multiple, anonymous
		FROM chat_polls WHERE message_id=$1::uuid
		ON CONFLICT DO NOTHING`, fromMsg, toMsg, toConv, creator)
}

func (s *Service) notifyChatPeers(ctx context.Context, convID, senderID, preview string) {
	if s.push == nil {
		return
	}
	var senderName string
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id=$1::uuid`, senderID).Scan(&senderName)
	rows, err := s.pool.Query(ctx, `
		SELECT cm.user_id::text,
		       EXISTS(SELECT 1 FROM mutes WHERE muter_id=cm.user_id AND muted_id=$2::uuid),
		       EXISTS(SELECT 1 FROM conversation_mutes WHERE user_id=cm.user_id AND conversation_id=$1::uuid)
		FROM conversation_members cm
		WHERE cm.conversation_id=$1::uuid AND cm.user_id <> $2::uuid`, convID, senderID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var peerID string
		var muted, convMuted bool
		if rows.Scan(&peerID, &muted, &convMuted) != nil || muted || convMuted || peerID == "" {
			continue
		}
		s.push.NotifyUser(ctx, peerID, push.Payload{
			Title:          senderName,
			Body:           preview,
			URL:            "/app/messages/" + convID,
			Type:           "message",
			FromUserID:     senderID,
			ConversationID: convID,
		})
	}
}
