package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

func (s *Service) loadReplySnapshot(ctx context.Context, msgID string) (map[string]any, error) {
	var body, msgType, media, sender, name string
	err := s.pool.QueryRow(ctx, `
		SELECT m.body, COALESCE(m.msg_type,'text'), COALESCE(m.media_url,''),
		       m.sender_id::text,
		       COALESCE(NULLIF(u.display_name,''), u.username, '')
		FROM messages m
		LEFT JOIN users u ON u.id = m.sender_id
		WHERE m.id = $1::uuid AND m.deleted_at IS NULL`, msgID).
		Scan(&body, &msgType, &media, &sender, &name)
	if err != nil {
		return nil, err
	}
	snap := map[string]any{
		"id":          msgID,
		"body":        body,
		"sender_id":   sender,
		"sender_name": name,
		"msg_type":    msgType,
	}
	if media != "" {
		snap["media_url"] = media
	}
	return snap, nil
}

func (s *Service) storeReplySnapshot(ctx context.Context, tx pgx.Tx, messageID string, snap map[string]any) error {
	raw, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE messages SET reply_to = $2::jsonb WHERE id = $1`, messageID, raw)
	return err
}

// attachActionFields fills reply_to and forwarded_from for a page of messages.
// A stored snapshot wins. Otherwise the live source row is used.
func (s *Service) attachActionFields(ctx context.Context, items []map[string]any) error {
	if s == nil || s.pool == nil || len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	byID := make(map[string]map[string]any, len(items))
	for _, it := range items {
		id, _ := it["id"].(string)
		if id == "" {
			continue
		}
		ids = append(ids, id)
		byID[id] = it
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT m.id::text,
		       m.reply_to,
		       COALESCE(m.forwarded_from, src.forwarded_from),
		       rq.id::text,
		       COALESCE(rq.body, ''),
		       COALESCE(rq.msg_type, 'text'),
		       COALESCE(rq.media_url, ''),
		       rq.sender_id::text,
		       COALESCE(NULLIF(ru.display_name, ''), ru.username, ''),
		       src.sender_id::text,
		       COALESCE(NULLIF(su.display_name, ''), su.username, ''),
		       COALESCE(su.username, '')
		FROM messages m
		LEFT JOIN messages rq ON rq.id = m.reply_to_id AND rq.deleted_at IS NULL
		LEFT JOIN users ru ON ru.id = rq.sender_id
		LEFT JOIN messages src ON src.id = m.forward_of
		LEFT JOIN users su ON su.id = src.sender_id
		WHERE m.id = ANY($1::uuid[])`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var replyJSON, fwdJSON []byte
		var rqID, rqBody, rqType, rqMedia, rqSender, rqName *string
		var srcSender, srcName, srcUser *string
		if err := rows.Scan(
			&id, &replyJSON, &fwdJSON,
			&rqID, &rqBody, &rqType, &rqMedia, &rqSender, &rqName,
			&srcSender, &srcName, &srcUser,
		); err != nil {
			return err
		}
		it := byID[id]
		if it == nil {
			continue
		}
		if len(replyJSON) > 0 && string(replyJSON) != "null" {
			var snap any
			if json.Unmarshal(replyJSON, &snap) == nil && snap != nil {
				it["reply_to"] = snap
			}
		} else if rqID != nil && *rqID != "" {
			snap := map[string]any{
				"id":          *rqID,
				"body":        strOr(rqBody),
				"sender_id":   strOr(rqSender),
				"sender_name": strOr(rqName),
				"msg_type":    strOr(rqType),
			}
			if media := strOr(rqMedia); media != "" {
				snap["media_url"] = media
			}
			it["reply_to"] = snap
		}
		if len(fwdJSON) > 0 && string(fwdJSON) != "null" {
			var snap any
			if json.Unmarshal(fwdJSON, &snap) == nil && snap != nil {
				it["forwarded_from"] = snap
			}
		} else if srcSender != nil && *srcSender != "" {
			name := strOr(srcName)
			if name == "" {
				name = strOr(srcUser)
			}
			it["forwarded_from"] = map[string]any{
				"user_id":  *srcSender,
				"name":     name,
				"username": strOr(srcUser),
			}
		}
	}
	return rows.Err()
}

func strOr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

type forwardPayload struct {
	Body     string
	Media    string
	MsgType  string
	Duration int
	Meta     []byte
	From     map[string]any
}

func (s *Service) loadForwardPayload(ctx context.Context, uid, msgID, convID string) (forwardPayload, error) {
	var body, media, msgType, sender, name, username string
	var duration int
	var meta, stored []byte
	err := s.pool.QueryRow(ctx, `
		SELECT m.body, COALESCE(m.media_url,''), COALESCE(m.msg_type,'text'), COALESCE(m.duration_ms,0),
		       m.meta, m.forwarded_from,
		       m.sender_id::text,
		       COALESCE(NULLIF(u.display_name,''), u.username, ''),
		       COALESCE(u.username,'')
		FROM messages m
		LEFT JOIN users u ON u.id = m.sender_id
		WHERE m.id = $1::uuid AND m.conversation_id = $2::uuid AND m.deleted_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $3::uuid
		  )`, msgID, convID, uid).
		Scan(&body, &media, &msgType, &duration, &meta, &stored, &sender, &name, &username)
	if err != nil {
		return forwardPayload{}, err
	}
	from := map[string]any{}
	if len(stored) > 0 && string(stored) != "null" && json.Unmarshal(stored, &from) == nil && from["user_id"] != nil {
		// keep the original author across a chain of forwards
	} else {
		if name == "" {
			name = username
		}
		from = map[string]any{"user_id": sender, "name": name, "username": username}
	}
	return forwardPayload{Body: body, Media: media, MsgType: msgType, Duration: duration, Meta: meta, From: from}, nil
}

// forwardInto copies one message into one or more chats the caller belongs to.
// Only members can forward. The new row records forwarded_from and is pushed over the websocket.
func (s *Service) forwardInto(w http.ResponseWriter, r *http.Request, uid, fromConv, messageID string, targets []string, asList bool) {
	seen := map[string]struct{}{}
	clean := make([]string, 0, len(targets))
	for _, id := range targets {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, err := uuid.Parse(id); err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "to_conversation_id")
			return
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	if len(clean) == 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "to_conversation_id required")
		return
	}
	if len(clean) > 20 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "too many chats")
		return
	}
	for _, to := range clean {
		if !s.isMember(r, uid, to) {
			apiutil.Error(w, http.StatusForbidden, "forbidden", "not a member of target chat")
			return
		}
	}
	src, err := s.loadForwardPayload(r.Context(), uid, messageID, fromConv)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	fromRaw, err := json.Marshal(src.From)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var metaArg any
	if len(src.Meta) > 0 && string(src.Meta) != "null" {
		metaArg = src.Meta
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	items := make([]map[string]any, 0, len(clean))
	for _, to := range clean {
		id := uuid.New().String()
		var created time.Time
		err = tx.QueryRow(r.Context(), `
			INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type, duration_ms, forward_of, forwarded_from, meta)
			VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::uuid, $9::jsonb, $10)
			RETURNING created_at`,
			id, to, uid, src.Body, src.Media, src.MsgType, src.Duration, messageID, fromRaw, metaArg).Scan(&created)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		if _, err = tx.Exec(r.Context(), `UPDATE conversations SET updated_at=now() WHERE id=$1::uuid`, to); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		out := map[string]any{
			"id": id, "conversation_id": to, "sender_id": uid, "body": src.Body,
			"msg_type": src.MsgType, "duration_ms": src.Duration, "forward_of": messageID,
			"forwarded_from": src.From,
			"created_at":     created.UTC().Format(time.RFC3339Nano),
		}
		if src.Media != "" {
			out["media_url"] = src.Media
		}
		if metaArg != nil {
			var mv any
			if json.Unmarshal(src.Meta, &mv) == nil {
				out["meta"] = mv
			}
		}
		items = append(items, out)
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	for _, out := range items {
		if src.MsgType == "poll" {
			s.copyChatPoll(r.Context(), messageID, out["id"].(string), out["conversation_id"].(string), uid)
		}
		convID, _ := out["conversation_id"].(string)
		s.BroadcastEvent(convID, map[string]any{
			"type": "message", "conversation_id": convID, "message": out,
		})
	}
	if asList {
		apiutil.JSON(w, http.StatusCreated, map[string]any{"items": items})
		return
	}
	apiutil.JSON(w, http.StatusCreated, items[0])
}
