package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/hub-socium/hub/backend/internal/webrtcice"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func defaultCallICE() []map[string]any {
	return webrtcice.DefaultICE()
}

const callRingTimeout = 45 * time.Second

type liveCall struct {
	ID        string
	ConvID    string
	Initiator string
	Video     bool
	Status    string
	Outcome   string
	Created   time.Time
	Answered  *time.Time
	Ended     *time.Time
	Duration  int
	Message   map[string]any
	PeerIDs   []string
}

// dmCallPeer returns the other member of a 1:1 chat.
// isGroup is true for group conversations (including rooms with more than two people).
func (s *Service) dmCallPeer(ctx context.Context, convID, uid string) (peer string, isGroup bool, err error) {
	var members int
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(c.is_group, false),
		       (SELECT COUNT(*)::int FROM conversation_members m WHERE m.conversation_id = c.id)
		FROM conversations c WHERE c.id = $1::uuid`, convID).Scan(&isGroup, &members)
	if err != nil {
		return "", false, err
	}
	if members > 2 {
		isGroup = true
	}
	if isGroup {
		return "", true, nil
	}
	err = s.pool.QueryRow(ctx, `
		SELECT user_id::text FROM conversation_members
		WHERE conversation_id = $1::uuid AND user_id <> $2::uuid
		LIMIT 1`, convID, uid).Scan(&peer)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return peer, false, err
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// StartCall POST /v1/conversations/{id}/call — body { video?: bool }. 1:1 only.
func (s *Service) StartCall(w http.ResponseWriter, r *http.Request) {
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
	s.expireStaleCalls(r.Context())

	peerID, isGroup, err := s.dmCallPeer(r.Context(), convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if isGroup {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Звонки доступны только в личных чатах")
		return
	}
	if peerID == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нет собеседника")
		return
	}
	if s.isBlockedEither(r, uid, peerID) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Пользователь недоступен")
		return
	}

	var req struct {
		Video *bool `json:"video"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := apiutil.DecodeJSON(r, &req); err != nil {
			apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
			return
		}
	}
	video := true
	if req.Video != nil {
		video = *req.Video
	}

	if existing, err := s.loadLiveCall(r.Context(), convID); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	} else if existing != nil {
		apiutil.JSON(w, http.StatusOK, s.callPayload(existing, peerID, uid))
		return
	}

	callID := uuid.New()
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), `
		INSERT INTO calls (id, conversation_id, initiator_id, is_group, video, status)
		VALUES ($1, $2::uuid, $3::uuid, false, $4, 'ringing')`, callID, convID, uid, video)
	if err != nil {
		if isUniqueViolation(err) {
			_ = tx.Rollback(r.Context())
			existing, lerr := s.loadLiveCall(r.Context(), convID)
			if lerr != nil || existing == nil {
				apiutil.Error(w, http.StatusConflict, "conflict", "Уже идёт звонок")
				return
			}
			apiutil.JSON(w, http.StatusOK, s.callPayload(existing, peerID, uid))
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO call_participants (call_id, user_id, state, video, joined_at)
		VALUES ($1, $2::uuid, 'joined', $3, now())`, callID, uid, video)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO call_participants (call_id, user_id, state, video)
		VALUES ($1, $2::uuid, 'ringing', $3)`, callID, peerID, video)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		if isUniqueViolation(err) {
			existing, lerr := s.loadLiveCall(r.Context(), convID)
			if lerr != nil || existing == nil {
				apiutil.Error(w, http.StatusConflict, "conflict", "Уже идёт звонок")
				return
			}
			apiutil.JSON(w, http.StatusOK, s.callPayload(existing, peerID, uid))
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var name, username, avatar string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(NULLIF(display_name,''), username), username, COALESCE(avatar_url,'')
		FROM users WHERE id=$1::uuid`, uid).Scan(&name, &username, &avatar)
	if s.push != nil {
		body := "Входящий звонок"
		if video {
			body = "Входящий видеозвонок"
		}
		s.push.NotifyUser(r.Context(), peerID, push.Payload{
			Title: name, Body: body, URL: "/app/messages/" + convID + "?call=1",
			Type: "call", FromUserID: uid, ConversationID: convID,
		})
	}
	s.BroadcastEvent(convID, map[string]any{
		"type":            "incoming_call",
		"call_id":         callID.String(),
		"conversation_id": convID,
		"video":           video,
		"status":          "ringing",
		"created_at":      time.Now().UTC().Format(time.RFC3339Nano),
		"initiator_id":    uid,
		"peer_id":         uid,
		"initiator": map[string]any{
			"id": uid, "username": username, "display_name": name, "avatar_url": avatar,
		},
	})

	row := &liveCall{
		ID: callID.String(), ConvID: convID, Initiator: uid, Video: video, Status: "ringing",
		Created: time.Now().UTC(),
	}
	apiutil.JSON(w, http.StatusOK, s.callPayload(row, peerID, uid))
}

func (s *Service) callPayload(c *liveCall, peerID, viewer string) map[string]any {
	out := map[string]any{
		"ok":              true,
		"active":          c.Status == "ringing" || c.Status == "active",
		"call_id":         c.ID,
		"conversation_id": c.ConvID,
		"peer_id":         peerID,
		"initiator_id":    c.Initiator,
		"status":          c.Status,
		"video":           c.Video,
		"ice_servers":     defaultCallICE(),
		"created_at":      c.Created.UTC().Format(time.RFC3339Nano),
	}
	if c.Outcome != "" {
		out["outcome"] = c.Outcome
	}
	if c.Answered != nil {
		out["answered_at"] = c.Answered.UTC().Format(time.RFC3339Nano)
	}
	if c.Ended != nil {
		out["ended_at"] = c.Ended.UTC().Format(time.RFC3339Nano)
	}
	if viewer != "" && viewer == c.Initiator {
		out["role"] = "caller"
	} else if viewer != "" {
		out["role"] = "callee"
	}
	return out
}

func (s *Service) loadLiveCall(ctx context.Context, convID string) (*liveCall, error) {
	var c liveCall
	var outcome *string
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, initiator_id::text, video, status,
		       outcome, created_at, answered_at, ended_at
		FROM calls
		WHERE conversation_id = $1::uuid AND status IN ('ringing','active')
		ORDER BY created_at DESC
		LIMIT 1`, convID).Scan(&c.ID, &c.ConvID, &c.Initiator, &c.Video, &c.Status, &outcome, &c.Created, &c.Answered, &c.Ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if outcome != nil {
		c.Outcome = *outcome
	}
	return &c, nil
}

// EndCall POST /v1/conversations/{id}/call/end
func (s *Service) EndCall(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	done, err := s.finishCall(r.Context(), convID, uid, "")
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if done != nil {
		s.afterCallFinished(r.Context(), done, "hangup", uid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "ended": done != nil})
}

// AnswerCall POST /v1/conversations/{id}/call/answer
func (s *Service) AnswerCall(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	s.expireStaleCalls(r.Context())
	call, err := s.loadLiveCall(r.Context(), convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if call == nil {
		apiutil.Error(w, http.StatusConflict, "conflict", "Звонок уже завершён")
		return
	}
	if call.Status == "active" {
		var peer string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT user_id::text FROM call_participants
			WHERE call_id=$1::uuid AND user_id<>$2::uuid LIMIT 1`, call.ID, uid).Scan(&peer)
		apiutil.JSON(w, http.StatusOK, s.callPayload(call, peer, uid))
		return
	}
	if call.Status != "ringing" {
		apiutil.Error(w, http.StatusConflict, "conflict", "Звонок уже завершён")
		return
	}
	if call.Initiator == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нельзя ответить на свой звонок")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE call_participants
		SET state='joined', joined_at=COALESCE(joined_at, now()), last_seen_at=now(), video=$3
		WHERE call_id=$1::uuid AND user_id=$2::uuid AND state='ringing'`, call.ID, uid, call.Video)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusConflict, "conflict", "Звонок уже завершён")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE calls
		SET status='active', answered_at=COALESCE(answered_at, now())
		WHERE id=$1::uuid AND status='ringing'`, call.ID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	call.Status = "active"
	now := time.Now().UTC()
	call.Answered = &now
	var peer string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT user_id::text FROM call_participants
		WHERE call_id=$1::uuid AND user_id<>$2::uuid LIMIT 1`, call.ID, uid).Scan(&peer)
	apiutil.JSON(w, http.StatusOK, s.callPayload(call, peer, uid))
}

// DeclineCall POST /v1/conversations/{id}/call/decline
func (s *Service) DeclineCall(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	call, err := s.loadLiveCall(r.Context(), convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if call == nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "ended": false})
		return
	}
	outcome := "declined"
	if call.Initiator == uid {
		outcome = "cancelled"
	}
	done, err := s.finishCall(r.Context(), convID, uid, outcome)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	reason := "declined"
	if outcome == "cancelled" {
		reason = "cancelled"
	}
	if done != nil {
		s.afterCallFinished(r.Context(), done, reason, uid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "ended": done != nil})
}

// GetCall GET /v1/conversations/{id}/call
func (s *Service) GetCall(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	s.expireStaleCalls(r.Context())
	call, err := s.loadLiveCall(r.Context(), convID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if call == nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"active": false, "ice_servers": defaultCallICE()})
		return
	}
	var peer string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT user_id::text FROM call_participants
		WHERE call_id=$1::uuid AND user_id<>$2::uuid LIMIT 1`, call.ID, uid).Scan(&peer)
	apiutil.JSON(w, http.StatusOK, s.callPayload(call, peer, uid))
}

// ListIncomingCalls GET /v1/me/calls/incoming — ringing 1:1 calls for the current user.
func (s *Service) ListIncomingCalls(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	s.expireStaleCalls(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id::text, c.conversation_id::text, c.video, c.status, c.created_at,
		       u.id::text, u.username, COALESCE(NULLIF(u.display_name,''), u.username), COALESCE(u.avatar_url,'')
		FROM call_participants p
		JOIN calls c ON c.id = p.call_id
		JOIN users u ON u.id = c.initiator_id
		WHERE p.user_id = $1::uuid
		  AND p.state = 'ringing'
		  AND c.status = 'ringing'
		  AND c.is_group = false
		  AND c.initiator_id <> $1::uuid
		ORDER BY c.created_at ASC
		LIMIT 10`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var callID, convID, status, initID, username, name, avatar string
		var video bool
		var created time.Time
		if rows.Scan(&callID, &convID, &video, &status, &created, &initID, &username, &name, &avatar) != nil {
			continue
		}
		items = append(items, map[string]any{
			"call_id":         callID,
			"conversation_id": convID,
			"video":           video,
			"status":          status,
			"created_at":      created.UTC().Format(time.RFC3339Nano),
			"initiator_id":    initID,
			"peer_id":         initID,
			"initiator": map[string]any{
				"id": initID, "username": username, "display_name": name, "avatar_url": avatar,
			},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "ice_servers": defaultCallICE()})
}

// PostCallSignal POST /v1/conversations/{id}/call/signal
func (s *Service) PostCallSignal(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	var req struct {
		ToUserID string          `json:"to_user_id"`
		Kind     string          `json:"kind"`
		Payload  json.RawMessage `json:"payload"`
		CallID   string          `json:"call_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	if kind != "offer" && kind != "answer" && kind != "ice" && kind != "hangup" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "kind: offer|answer|ice|hangup")
		return
	}
	to := strings.TrimSpace(req.ToUserID)
	if to == "" || !s.isMember(r, to, convID) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "to_user_id must be peer")
		return
	}
	if len(req.Payload) == 0 {
		req.Payload = []byte("{}")
	}
	callID := strings.TrimSpace(req.CallID)
	if callID == "" {
		if live, err := s.loadLiveCall(r.Context(), convID); err == nil && live != nil {
			callID = live.ID
		}
	}
	var callArg any
	if callID != "" {
		if _, err := uuid.Parse(callID); err == nil {
			callArg = callID
		}
	}
	id := uuid.New()
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO dm_call_signals (id, conversation_id, from_user_id, to_user_id, kind, payload, call_id)
		VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid)`, id, convID, uid, to, kind, req.Payload, callArg)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if kind == "hangup" {
		done, ferr := s.finishCall(r.Context(), convID, uid, "")
		if ferr == nil && done != nil {
			s.afterCallFinished(r.Context(), done, "hangup", uid)
		}
	} else {
		var payload any
		if json.Unmarshal(req.Payload, &payload) != nil {
			payload = map[string]any{}
		}
		s.BroadcastEvent(convID, map[string]any{
			"type":            "call_signal",
			"conversation_id": convID,
			"id":              id.String(),
			"from_user_id":    uid,
			"to_user_id":      to,
			"kind":            kind,
			"payload":         payload,
			"call_id":         callID,
		})
	}
	if kind == "answer" {
		if callArg != nil {
			_, _ = s.pool.Exec(r.Context(), `
				UPDATE call_participants
				SET state='joined', joined_at=COALESCE(joined_at, now()), last_seen_at=now()
				WHERE call_id=$1::uuid AND user_id=$2::uuid AND state='ringing'`, callArg, uid)
		}
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE calls
			SET status='active', answered_at=COALESCE(answered_at, now())
			WHERE conversation_id=$1::uuid AND status='ringing'`, convID)
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM dm_call_signals WHERE created_at < now() - interval '10 minutes'`)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": id.String(), "call_id": callID})
}

// PollCallSignals GET /v1/conversations/{id}/call/signals
func (s *Service) PollCallSignals(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireCallMember(w, r)
	if !ok {
		return
	}
	// The caller's signal poll is what expires an unanswered ring when the callee is offline.
	s.expireStaleCalls(r.Context())
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), `
		UPDATE dm_call_signals SET consumed_at=now()
		WHERE id IN (
		  SELECT id FROM dm_call_signals
		  WHERE conversation_id=$1::uuid AND to_user_id=$2::uuid AND consumed_at IS NULL
		    AND (
		      call_id IS NULL
		      OR call_id IN (
		        SELECT id FROM calls
		        WHERE conversation_id=$1::uuid
		          AND (status IN ('ringing','active') OR ended_at > now() - interval '20 seconds')
		      )
		    )
		  ORDER BY created_at ASC LIMIT 40
		)
		RETURNING id::text, from_user_id::text, kind, payload, created_at, call_id::text`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	items := []map[string]any{}
	for rows.Next() {
		var id, from, kind string
		var payload []byte
		var created time.Time
		var callID *string
		if rows.Scan(&id, &from, &kind, &payload, &created, &callID) != nil {
			continue
		}
		var pl any
		_ = json.Unmarshal(payload, &pl)
		item := map[string]any{
			"id": id, "from_user_id": from, "kind": kind, "payload": pl,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		}
		if callID != nil {
			item["call_id"] = *callID
		}
		items = append(items, item)
	}
	rows.Close()
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "ice_servers": defaultCallICE()})
}

func (s *Service) requireCallMember(w http.ResponseWriter, r *http.Request) (uid, convID string, ok bool) {
	uid, ok = apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return "", "", false
	}
	convID = chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return "", "", false
	}
	return uid, convID, true
}

func (s *Service) expireStaleCalls(ctx context.Context) {
	rows, err := s.pool.Query(ctx, `
		SELECT conversation_id::text
		FROM calls
		WHERE status = 'ringing' AND answered_at IS NULL AND created_at < $1`, time.Now().Add(-callRingTimeout))
	if err != nil {
		return
	}
	var convs []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			convs = append(convs, id)
		}
	}
	rows.Close()
	for _, convID := range convs {
		done, err := s.finishCall(ctx, convID, "", "missed")
		if err != nil || done == nil {
			continue
		}
		s.afterCallFinished(ctx, done, "missed", "")
	}
}

// finishCall ends the live call on a conversation and writes one msg_type=call history row.
// forceOutcome is "missed", "declined", "cancelled", or "" to derive it.
func (s *Service) finishCall(ctx context.Context, convID, actorID, forceOutcome string) (*liveCall, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var c liveCall
	var outcome *string
	err = tx.QueryRow(ctx, `
		SELECT id::text, conversation_id::text, initiator_id::text, video, status,
		       outcome, created_at, answered_at
		FROM calls
		WHERE conversation_id = $1::uuid AND status IN ('ringing','active')
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE`, convID).Scan(&c.ID, &c.ConvID, &c.Initiator, &c.Video, &c.Status, &outcome, &c.Created, &c.Answered)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	finalOutcome := forceOutcome
	if finalOutcome == "" {
		if c.Answered != nil {
			finalOutcome = "completed"
		} else if actorID != "" && actorID == c.Initiator {
			finalOutcome = "cancelled"
		} else {
			finalOutcome = "missed"
		}
	}
	c.Outcome = finalOutcome

	var ended time.Time
	err = tx.QueryRow(ctx, `
		UPDATE calls
		SET status='ended', outcome=$2, ended_at=now()
		WHERE id=$1::uuid AND status IN ('ringing','active')
		RETURNING ended_at`, c.ID, finalOutcome).Scan(&ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Ended = &ended
	c.Status = "ended"
	if c.Answered != nil && finalOutcome == "completed" {
		c.Duration = int(ended.Sub(*c.Answered).Seconds())
		if c.Duration < 1 {
			c.Duration = 1
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE call_participants
		SET state = CASE
		      WHEN $2 = 'declined' AND user_id = NULLIF($3, '')::uuid THEN 'declined'
		      WHEN state = 'joined' THEN 'left'
		      WHEN state = 'ringing' THEN 'missed'
		      ELSE state
		    END,
		    left_at = COALESCE(left_at, now()),
		    last_seen_at = now()
		WHERE call_id = $1::uuid AND state IN ('ringing','joined')`, c.ID, finalOutcome, actorID)
	if err != nil {
		return nil, err
	}

	prows, err := tx.Query(ctx, `
		SELECT user_id::text FROM call_participants WHERE call_id=$1::uuid`, c.ID)
	if err != nil {
		return nil, err
	}
	for prows.Next() {
		var pid string
		if prows.Scan(&pid) == nil {
			c.PeerIDs = append(c.PeerIDs, pid)
		}
	}
	prows.Close()

	var exists bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM messages
			WHERE conversation_id=$1::uuid AND msg_type='call' AND deleted_at IS NULL
			  AND call_meta->>'call_id' = $2
		)`, convID, c.ID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		body := callPreviewBody(c.Video, finalOutcome, c.Duration)
		meta, _ := json.Marshal(map[string]any{
			"call_id":      c.ID,
			"video":        c.Video,
			"outcome":      finalOutcome,
			"duration_sec": c.Duration,
			"initiator_id": c.Initiator,
		})
		msgID := uuid.New()
		var created time.Time
		err = tx.QueryRow(ctx, `
			INSERT INTO messages (id, conversation_id, sender_id, body, msg_type, duration_ms, call_meta)
			VALUES ($1, $2::uuid, $3::uuid, $4, 'call', $5, $6::jsonb)
			RETURNING created_at`, msgID, convID, c.Initiator, body, c.Duration*1000, meta).Scan(&created)
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `UPDATE conversations SET updated_at=$1 WHERE id=$2::uuid`, created, convID); err != nil {
			return nil, err
		}
		var parsed any
		_ = json.Unmarshal(meta, &parsed)
		c.Message = map[string]any{
			"id":              msgID.String(),
			"conversation_id": convID,
			"sender_id":       c.Initiator,
			"body":            body,
			"created_at":      created.UTC().Format(time.RFC3339Nano),
			"msg_type":        "call",
			"duration_ms":     c.Duration * 1000,
			"call_meta":       parsed,
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Service) afterCallFinished(ctx context.Context, c *liveCall, reason, actorID string) {
	if c == nil {
		return
	}
	if reason == "hangup" {
		switch c.Outcome {
		case "declined":
			reason = "declined"
		case "missed":
			reason = "missed"
		case "cancelled":
			reason = "cancelled"
		default:
			reason = "hangup"
		}
	}
	payload, _ := json.Marshal(map[string]any{"reason": reason})
	send := func(from, to string) {
		if from == "" || to == "" || from == to {
			return
		}
		_, _ = s.pool.Exec(ctx, `
			INSERT INTO dm_call_signals (id, conversation_id, from_user_id, to_user_id, kind, payload, call_id)
			VALUES ($1, $2::uuid, $3::uuid, $4::uuid, 'hangup', $5, $6::uuid)`,
			uuid.New(), c.ConvID, from, to, payload, c.ID)
	}
	from := actorID
	if from == "" {
		from = c.Initiator
	}
	for _, to := range c.PeerIDs {
		send(from, to)
	}
	// Ring timeout has no actor; the caller must see it too.
	if actorID == "" {
		for _, peer := range c.PeerIDs {
			send(peer, c.Initiator)
		}
	}
	if c.Message != nil {
		s.BroadcastEvent(c.ConvID, map[string]any{
			"type": "message", "conversation_id": c.ConvID, "message": c.Message,
		})
	}
	s.BroadcastEvent(c.ConvID, map[string]any{
		"type":            "call_signal",
		"conversation_id": c.ConvID,
		"id":              uuid.New().String(),
		"kind":            "hangup",
		"payload":         map[string]any{"reason": reason},
		"call_id":         c.ID,
	})
}
