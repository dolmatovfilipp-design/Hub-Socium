package chat

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/push"
)

// defaultCallICE returns STUN (+ optional TURN).
// Prefer env:
//
//	HUB_TURN_URLS=turn:host:80,turns:host:443   (comma-separated)
//	HUB_TURN_USERNAME / HUB_TURN_CREDENTIAL     (optional shared auth)
//
// If HUB_TURN_URLS unset, adds free public openrelay.metered.ca demo TURN
// (rate-limited; OK for MVP demos — replace in prod). Multiple Google STUN always included.
func defaultCallICE() []map[string]any {
	out := []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
		{"urls": "stun:stun2.l.google.com:19302"},
	}
	urlsEnv := strings.TrimSpace(os.Getenv("HUB_TURN_URLS"))
	user := strings.TrimSpace(os.Getenv("HUB_TURN_USERNAME"))
	cred := strings.TrimSpace(os.Getenv("HUB_TURN_CREDENTIAL"))
	if urlsEnv != "" {
		for _, u := range strings.Split(urlsEnv, ",") {
			u = strings.TrimSpace(u)
			if u == "" {
				continue
			}
			entry := map[string]any{"urls": u}
			if user != "" {
				entry["username"] = user
				entry["credential"] = cred
			}
			out = append(out, entry)
		}
		return out
	}
	// Public demo TURN — reduces symmetric-NAT failures; not for production load.
	out = append(out,
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:80",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:443",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
		map[string]any{
			"urls":       "turn:openrelay.metered.ca:443?transport=tcp",
			"username":   "openrelayproject",
			"credential": "openrelayproject",
		},
	)
	return out
}

// StartCall POST /v1/conversations/{id}/call — body { video?: true }
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
	var peerID string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT user_id::text FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id<>$2::uuid LIMIT 1`, convID, uid).Scan(&peerID)
	if peerID == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "no peer")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO dm_calls (conversation_id, caller_id, callee_id, status, started_at)
		VALUES ($1::uuid,$2::uuid,$3::uuid,'ringing',now())
		ON CONFLICT (conversation_id) DO UPDATE SET
		  caller_id=EXCLUDED.caller_id, callee_id=EXCLUDED.callee_id,
		  status='ringing', started_at=now(), ended_at=NULL`, convID, uid, peerID)

	if s.push != nil {
		var name string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id=$1::uuid`, uid).Scan(&name)
		s.push.NotifyUser(r.Context(), peerID, push.Payload{
			Title: name, Body: "Входящий видеозвонок", URL: "/app/messages/" + convID + "?call=1",
			Type: "message", FromUserID: uid, ConversationID: convID,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "conversation_id": convID, "peer_id": peerID,
		"status": "ringing", "ice_servers": defaultCallICE(), "video": true,
	})
}

// EndCall POST /v1/conversations/{id}/call/end
func (s *Service) EndCall(w http.ResponseWriter, r *http.Request) {
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
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE dm_calls SET status='ended', ended_at=now()
		WHERE conversation_id=$1::uuid`, convID)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GetCall GET /v1/conversations/{id}/call
func (s *Service) GetCall(w http.ResponseWriter, r *http.Request) {
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
	var caller, callee, status string
	var started time.Time
	var ended *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT caller_id::text, callee_id::text, status, started_at, ended_at
		FROM dm_calls WHERE conversation_id=$1::uuid`, convID).
		Scan(&caller, &callee, &status, &started, &ended)
	if err != nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"active": false, "ice_servers": defaultCallICE()})
		return
	}
	active := status == "ringing" || status == "active"
	out := map[string]any{
		"active": active, "status": status, "caller_id": caller, "callee_id": callee,
		"started_at": started.UTC().Format(time.RFC3339), "ice_servers": defaultCallICE(),
	}
	if ended != nil {
		out["ended_at"] = ended.UTC().Format(time.RFC3339)
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// PostCallSignal POST /v1/conversations/{id}/call/signal
func (s *Service) PostCallSignal(w http.ResponseWriter, r *http.Request) {
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
		ToUserID string          `json:"to_user_id"`
		Kind     string          `json:"kind"`
		Payload  json.RawMessage `json:"payload"`
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
	id := uuid.New()
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO dm_call_signals (id, conversation_id, from_user_id, to_user_id, kind, payload)
		VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6)`, id, convID, uid, to, kind, req.Payload)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if kind == "hangup" {
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE dm_calls SET status='ended', ended_at=now() WHERE conversation_id=$1::uuid`, convID)
	} else if kind == "answer" || kind == "offer" {
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE dm_calls SET status='active' WHERE conversation_id=$1::uuid AND status='ringing'`, convID)
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM dm_call_signals WHERE created_at < now() - interval '10 minutes'`)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": id.String()})
}

// PollCallSignals GET /v1/conversations/{id}/call/signals
func (s *Service) PollCallSignals(w http.ResponseWriter, r *http.Request) {
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
		  ORDER BY created_at ASC LIMIT 40
		)
		RETURNING id::text, from_user_id::text, kind, payload, created_at`, convID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	items := []map[string]any{}
	for rows.Next() {
		var id, from, kind string
		var payload []byte
		var created time.Time
		if rows.Scan(&id, &from, &kind, &payload, &created) != nil {
			continue
		}
		var pl any
		_ = json.Unmarshal(payload, &pl)
		items = append(items, map[string]any{
			"id": id, "from_user_id": from, "kind": kind, "payload": pl,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	rows.Close()
	_ = tx.Commit(r.Context())
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "ice_servers": defaultCallICE()})
}
