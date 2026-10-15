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
)

// CreateReminder stores "напомни ответить" for the current member.
func (s *Service) CreateReminder(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	var req struct {
		MessageID string `json:"message_id"`
		Note      string `json:"note"`
		RemindAt  string `json:"remind_at"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	when, err := time.Parse(time.RFC3339, strings.TrimSpace(req.RemindAt))
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "remind_at must be RFC3339")
		return
	}
	if when.Before(time.Now().Add(-time.Minute)) || when.After(time.Now().Add(30*24*time.Hour)) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "remind_at must be within 30 days")
		return
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		note = "Ответить позже"
	}
	if utf8.RuneCountInString(note) > 200 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "note max 200")
		return
	}
	var msgID any
	if id := strings.TrimSpace(req.MessageID); id != "" {
		var exists bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL)`,
			id, convID).Scan(&exists)
		if !exists {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "message not in chat")
			return
		}
		msgID = id
	}
	var id string
	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO reply_reminders (user_id, conversation_id, message_id, note, remind_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		RETURNING id::text, created_at`, uid, convID, msgID, note, when.UTC()).Scan(&id, &created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить напоминание")
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id, "note": note, "remind_at": when.UTC().Format(time.RFC3339),
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

// ListReminders returns reminders the member has not dismissed.
func (s *Service) ListReminders(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, COALESCE(message_id::text,''), note, remind_at, fired_at
		FROM reply_reminders
		WHERE user_id=$1::uuid AND conversation_id=$2::uuid
		ORDER BY remind_at ASC
		LIMIT 30`, uid, convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать напоминания")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, msgID, note string
		var at time.Time
		var fired *time.Time
		if err := rows.Scan(&id, &msgID, &note, &at, &fired); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать напоминания")
			return
		}
		item := map[string]any{
			"id": id, "note": note, "remind_at": at.UTC().Format(time.RFC3339),
		}
		if msgID != "" {
			item["message_id"] = msgID
		}
		if fired != nil {
			item["fired_at"] = fired.UTC().Format(time.RFC3339)
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// CancelReminder removes a reminder owned by the caller.
func (s *Service) CancelReminder(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	rid := chi.URLParam(r, "rid")
	tag, err := s.pool.Exec(r.Context(), `
		DELETE FROM reply_reminders
		WHERE id=$1::uuid AND user_id=$2::uuid AND conversation_id=$3::uuid`, rid, uid, convID)
	if err != nil || tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "reminder not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) flushReminders(ctx context.Context) {
	rows, err := s.pool.Query(ctx, `
		UPDATE reply_reminders
		SET fired_at = now()
		WHERE id IN (
		  SELECT id FROM reply_reminders
		  WHERE fired_at IS NULL AND remind_at <= now()
		  ORDER BY remind_at ASC
		  LIMIT 30
		)
		RETURNING id::text, user_id::text, conversation_id::text, note`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, uid, convID, note string
		if rows.Scan(&id, &uid, &convID, &note) != nil {
			continue
		}
		meta, _ := json.Marshal(map[string]any{
			"conversation_id": convID,
			"reminder_id":     id,
			"note":            note,
		})
		_, _ = s.pool.Exec(ctx, `
			INSERT INTO activities (user_id, actor_id, type, meta)
			VALUES ($1::uuid, $1::uuid, 'reply_reminder', $2::jsonb)`, uid, meta)
	}
}

// OpenViewOnce reveals a one-time photo for the recipient and records the view.
func (s *Service) OpenViewOnce(w http.ResponseWriter, r *http.Request) {
	uid, convID, msgID, ok := s.memberMessage(w, r)
	if !ok {
		return
	}
	var sender, mediaURL, body string
	var once bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT sender_id::text, COALESCE(media_url,''), body, COALESCE(view_once,false)
		FROM messages
		WHERE id=$1::uuid AND conversation_id=$2::uuid AND deleted_at IS NULL`, msgID, convID).
		Scan(&sender, &mediaURL, &body, &once)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
		return
	}
	if !once {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "не одноразовое фото")
		return
	}
	if sender == uid {
		apiutil.JSON(w, http.StatusOK, map[string]any{"media_url": mediaURL, "view_once": "sent"})
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		INSERT INTO message_views (message_id, user_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, msgID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось открыть")
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusGone, "gone", "Фото уже просмотрено")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"media_url": mediaURL, "view_once": "opened"})
}

func (s *Service) insertChatMessage(ctx context.Context, convID, senderID, body, mediaURL, msgType string, meta map[string]any) (string, time.Time, error) {
	if msgType == "" {
		msgType = "text"
	}
	id := uuid.New()
	var metaArg any
	if meta != nil {
		raw, err := json.Marshal(meta)
		if err != nil {
			return "", time.Time{}, err
		}
		metaArg = raw
	}
	var created time.Time
	err := s.pool.QueryRow(ctx, `
		INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type, meta)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)
		RETURNING created_at`, id, convID, senderID, body, mediaURL, msgType, metaArg).Scan(&created)
	if err != nil {
		return "", time.Time{}, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE conversations SET updated_at=$2 WHERE id=$1::uuid`, convID, created)
	out := map[string]any{
		"id": id.String(), "conversation_id": convID, "sender_id": senderID,
		"body": body, "created_at": created.UTC().Format(time.RFC3339Nano), "msg_type": msgType,
	}
	if mediaURL != "" {
		out["media_url"] = mediaURL
	}
	if meta != nil {
		out["meta"] = meta
	}
	s.BroadcastEvent(convID, map[string]any{"type": "message", "conversation_id": convID, "message": out})
	return id.String(), created, nil
}
