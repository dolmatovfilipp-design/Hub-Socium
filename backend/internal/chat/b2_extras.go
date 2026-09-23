package chat

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// SetDisappear PATCH/PUT /v1/conversations/{id}/disappear
// body: { "hours": 24|null, "after_read": bool }
func (s *Service) SetDisappear(w http.ResponseWriter, r *http.Request) {
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
		Hours     *int  `json:"hours"`
		AfterRead *bool `json:"after_read"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	hours := req.Hours
	if hours != nil {
		h := *hours
		if h != 0 && h != 1 && h != 6 && h != 24 && h != 168 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "hours: 0|1|6|24|168")
			return
		}
		if h == 0 {
			hours = nil
		}
	}
	afterRead := false
	if req.AfterRead != nil {
		afterRead = *req.AfterRead
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE conversations SET disappear_hours=$2, disappear_after_read=$3 WHERE id=$1::uuid`,
		convID, hours, afterRead)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "disappear_hours": hours, "disappear_after_read": afterRead,
	})
}

// GetDisappear GET /v1/conversations/{id}/disappear
func (s *Service) GetDisappear(w http.ResponseWriter, r *http.Request) {
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
	var hours *int
	var afterRead bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT disappear_hours, COALESCE(disappear_after_read,false) FROM conversations WHERE id=$1::uuid`,
		convID).Scan(&hours, &afterRead)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"disappear_hours": hours, "disappear_after_read": afterRead,
	})
}

// ScheduleDM POST /v1/conversations/{id}/scheduled-messages
func (s *Service) ScheduleDM(w http.ResponseWriter, r *http.Request) {
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
		Body        string  `json:"body"`
		MediaURL    *string `json:"media_url"`
		MsgType     string  `json:"msg_type"`
		ScheduledAt string  `json:"scheduled_at"`
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
	tparse, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		tparse, err = time.Parse(time.RFC3339Nano, req.ScheduledAt)
	}
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "scheduled_at must be RFC3339")
		return
	}
	if !tparse.After(time.Now().Add(30 * time.Second)) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "scheduled_at must be in the future")
		return
	}
	media := ""
	if req.MediaURL != nil {
		media = strings.TrimSpace(*req.MediaURL)
	}
	msgType := strings.TrimSpace(req.MsgType)
	if msgType == "" {
		msgType = "text"
	}
	id := uuid.New()
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO scheduled_dms (id, conversation_id, sender_id, body, media_url, msg_type, scheduled_at)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7)`,
		id, convID, uid, req.Body, media, msgType, tparse.UTC())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "conversation_id": convID, "body": req.Body,
		"scheduled_at": tparse.UTC().Format(time.RFC3339Nano), "status": "scheduled",
	})
}

// ListScheduledDMs GET /v1/conversations/{id}/scheduled-messages
func (s *Service) ListScheduledDMs(w http.ResponseWriter, r *http.Request) {
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
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, body, COALESCE(media_url,''), COALESCE(msg_type,'text'), scheduled_at, created_at
		FROM scheduled_dms
		WHERE conversation_id=$1::uuid AND sender_id=$2::uuid AND sent_at IS NULL AND cancelled_at IS NULL
		ORDER BY scheduled_at ASC`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, body, media, msgType string
		var sched, created time.Time
		if rows.Scan(&id, &body, &media, &msgType, &sched, &created) != nil {
			continue
		}
		it := map[string]any{
			"id": id, "body": body, "msg_type": msgType,
			"scheduled_at": sched.UTC().Format(time.RFC3339Nano),
			"created_at":   created.UTC().Format(time.RFC3339Nano),
		}
		if media != "" {
			it["media_url"] = media
		}
		items = append(items, it)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// CancelScheduledDM DELETE /v1/conversations/{id}/scheduled-messages/{sid}
func (s *Service) CancelScheduledDM(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	convID := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "sid")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE scheduled_dms SET cancelled_at=now()
		WHERE id=$1::uuid AND conversation_id=$2::uuid AND sender_id=$3::uuid
		  AND sent_at IS NULL AND cancelled_at IS NULL`, sid, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "scheduled message not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// StartDMScheduleWorker publishes due scheduled DMs every 20s.
func (s *Service) StartDMScheduleWorker(ctx context.Context) {
	if s == nil || s.pool == nil {
		return
	}
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.flushScheduled(ctx)
				s.purgeExpired(ctx)
			}
		}
	}()
}

func (s *Service) flushScheduled(ctx context.Context) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, conversation_id::text, sender_id::text, body, COALESCE(media_url,''), COALESCE(msg_type,'text')
		FROM scheduled_dms
		WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at <= now()
		ORDER BY scheduled_at ASC
		LIMIT 50`)
	if err != nil {
		slog.Warn("scheduled dm query", "err", err)
		return
	}
	defer rows.Close()
	type row struct{ id, conv, sender, body, media, msgType string }
	var due []row
	for rows.Next() {
		var r row
		if rows.Scan(&r.id, &r.conv, &r.sender, &r.body, &r.media, &r.msgType) == nil {
			due = append(due, r)
		}
	}
	for _, r := range due {
		msgID := uuid.New()
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			continue
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO messages (id, conversation_id, sender_id, body, media_url, msg_type)
			VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6)`,
			msgID, r.conv, r.sender, r.body, r.media, r.msgType)
		if err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		_, _ = tx.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1::uuid`, r.conv)
		_, err = tx.Exec(ctx, `UPDATE scheduled_dms SET sent_at=now() WHERE id=$1::uuid`, r.id)
		if err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		_ = tx.Commit(ctx)
	}
	if len(due) > 0 {
		slog.Info("published scheduled dms", "count", len(due))
	}
}

func (s *Service) purgeExpired(ctx context.Context) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE messages SET deleted_at=now()
		WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()`)
	if err != nil {
		slog.Warn("purge expired msgs", "err", err)
		return
	}
	if tag.RowsAffected() > 0 {
		slog.Info("purged expired messages", "count", tag.RowsAffected())
	}
}

// applyDisappearOnSend sets expires_at from conversation settings; returns expires_at for response.
func (s *Service) applyDisappearOnSend(ctx context.Context, convID, msgID string) *time.Time {
	var hours *int
	var afterRead bool
	_ = s.pool.QueryRow(ctx, `
		SELECT disappear_hours, COALESCE(disappear_after_read,false) FROM conversations WHERE id=$1::uuid`,
		convID).Scan(&hours, &afterRead)
	if hours != nil && *hours > 0 {
		exp := time.Now().UTC().Add(time.Duration(*hours) * time.Hour)
		_, _ = s.pool.Exec(ctx, `UPDATE messages SET expires_at=$2 WHERE id=$1::uuid`, msgID, exp)
		return &exp
	}
	return nil
}

// expireAfterRead soft-deletes peer messages marked for after-read disappear once reader marks read.
func (s *Service) expireAfterRead(ctx context.Context, convID, readerUID string) {
	var afterRead bool
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(disappear_after_read,false) FROM conversations WHERE id=$1::uuid`, convID).Scan(&afterRead)
	if !afterRead {
		return
	}
	// Mark unread peer messages as read_at, then schedule near-term expiry (MVP: delete after 30s of read)
	_, _ = s.pool.Exec(ctx, `
		UPDATE messages SET read_at=COALESCE(read_at, now()),
		  expires_at = COALESCE(expires_at, now() + interval '30 seconds')
		WHERE conversation_id=$1::uuid AND sender_id<>$2::uuid
		  AND deleted_at IS NULL AND read_at IS NULL`, convID, readerUID)
}
