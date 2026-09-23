package voicerooms

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func defaultICEServers() []map[string]any {
	return []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
	}
}

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	_ = uid
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM voice_room_members WHERE last_seen < now() - interval '2 minutes'`)
	rows, err := s.pool.Query(r.Context(), `
		SELECT vr.id::text, vr.title, vr.topic, vr.host_id::text, vr.created_at,
		       u.username, u.display_name,
		       (SELECT COUNT(*)::int FROM voice_room_members m WHERE m.room_id = vr.id) AS live
		FROM voice_rooms vr
		JOIN users u ON u.id = vr.host_id
		WHERE vr.closed_at IS NULL
		ORDER BY live DESC, vr.created_at DESC
		LIMIT 50`)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, title, topic, hostID, hostUser, hostName string
		var created time.Time
		var live int
		if err := rows.Scan(&id, &title, &topic, &hostID, &created, &hostUser, &hostName, &live); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "title": title, "topic": topic, "host_id": hostID,
			"host": map[string]any{"id": hostID, "username": hostUser, "display_name": hostName},
			"live_count": live, "created_at": created.UTC().Format(time.RFC3339Nano),
			"audio": "webrtc",
			"note":  "WebRTC audio (STUN). Без TURN возможны сбои за NAT.",
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title string `json:"title"`
		Topic string `json:"topic"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Topic = strings.TrimSpace(req.Topic)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 80 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1..80")
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
		INSERT INTO voice_rooms (id, host_id, title, topic) VALUES ($1,$2::uuid,$3,$4)
		RETURNING created_at`, id, uid, req.Title, req.Topic).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO voice_room_members (room_id, user_id, muted, role)
		VALUES ($1,$2::uuid,false,'host')`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_ = tx.Commit(r.Context())
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "title": req.Title, "topic": req.Topic, "host_id": uid,
		"created_at": created.UTC().Format(time.RFC3339Nano), "audio": "webrtc",
	})
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	var title, topic, hostID string
	var created time.Time
	var closed *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT title, topic, host_id::text, created_at, closed_at FROM voice_rooms WHERE id=$1::uuid`, rid).
		Scan(&title, &topic, &hostID, &created, &closed)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "room not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT m.user_id::text, m.muted, m.role, m.last_seen, u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM voice_room_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.room_id=$1::uuid AND m.last_seen > now() - interval '2 minutes'
		ORDER BY CASE m.role WHEN 'host' THEN 0 WHEN 'speaker' THEN 1 ELSE 2 END, m.joined_at`, rid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	members := make([]map[string]any, 0)
	joined := false
	for rows.Next() {
		var mid, role, username, display, avatar string
		var muted bool
		var seen time.Time
		if rows.Scan(&mid, &muted, &role, &seen, &username, &display, &avatar) != nil {
			continue
		}
		if mid == uid {
			joined = true
		}
		members = append(members, map[string]any{
			"id": mid, "username": username, "display_name": display, "avatar_url": avatar,
			"muted": muted, "role": role, "last_seen": seen.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"id": rid, "title": title, "topic": topic, "host_id": hostID,
		"created_at": created.UTC().Format(time.RFC3339Nano),
		"closed": closed != nil, "joined": joined, "members": members,
		"audio": "webrtc",
		"note":  "Живой звук через WebRTC (mesh). Mute = track off. Без TURN — best effort.",
		"ice_servers": defaultICEServers(),
		"me": uid,
	})
}

func (s *Service) Join(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	var closed *time.Time
	err := s.pool.QueryRow(r.Context(), `SELECT closed_at FROM voice_rooms WHERE id=$1::uuid`, rid).Scan(&closed)
	if err != nil || closed != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "room not found or closed")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO voice_room_members (room_id, user_id, muted, role)
		VALUES ($1::uuid,$2::uuid,true,'listener')
		ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen=now()`, rid, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "joined": true, "muted": true, "audio": "webrtc"})
}

func (s *Service) Leave(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM voice_room_members WHERE room_id=$1::uuid AND user_id=$2::uuid`, rid, uid)
	var host string
	_ = s.pool.QueryRow(r.Context(), `SELECT host_id::text FROM voice_rooms WHERE id=$1::uuid`, rid).Scan(&host)
	if host == uid {
		_, _ = s.pool.Exec(r.Context(), `UPDATE voice_rooms SET closed_at=now() WHERE id=$1::uuid AND closed_at IS NULL`, rid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "joined": false})
}

func (s *Service) Heartbeat(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	var req struct {
		Muted *bool `json:"muted"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	if req.Muted != nil {
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE voice_room_members SET last_seen=now(), muted=$3
			WHERE room_id=$1::uuid AND user_id=$2::uuid`, rid, uid, *req.Muted)
	} else {
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE voice_room_members SET last_seen=now()
			WHERE room_id=$1::uuid AND user_id=$2::uuid`, rid, uid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PostSignal POST /v1/voice-rooms/{id}/signal — SDP/ICE to a peer in the room.
func (s *Service) PostSignal(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	var member bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM voice_room_members WHERE room_id=$1::uuid AND user_id=$2::uuid)`, rid, uid).Scan(&member)
	if !member {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "join room first")
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
	req.ToUserID = strings.TrimSpace(req.ToUserID)
	req.Kind = strings.TrimSpace(req.Kind)
	if req.ToUserID == "" || req.ToUserID == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "to_user_id required")
		return
	}
	if req.Kind != "offer" && req.Kind != "answer" && req.Kind != "ice" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "kind offer|answer|ice")
		return
	}
	if len(req.Payload) == 0 || string(req.Payload) == "null" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "payload required")
		return
	}
	var peerInRoom bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM voice_room_members WHERE room_id=$1::uuid AND user_id=$2::uuid)`, rid, req.ToUserID).Scan(&peerInRoom)
	if !peerInRoom {
		apiutil.Error(w, http.StatusNotFound, "not_found", "peer not in room")
		return
	}
	id := uuid.New()
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO voice_room_signals (id, room_id, from_user_id, to_user_id, kind, payload)
		VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb)`,
		id, rid, uid, req.ToUserID, req.Kind, []byte(req.Payload))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		DELETE FROM voice_room_signals
		WHERE room_id=$1::uuid AND (consumed_at IS NOT NULL OR created_at < now() - interval '10 minutes')`, rid)
	apiutil.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": id.String()})
}

// PollSignals GET /v1/voice-rooms/{id}/signals — claim pending signals for me.
func (s *Service) PollSignals(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rid := chi.URLParam(r, "id")
	rows, err := s.pool.Query(r.Context(), `
		WITH pending AS (
			SELECT id FROM voice_room_signals
			WHERE room_id=$1::uuid AND to_user_id=$2::uuid AND consumed_at IS NULL
			ORDER BY created_at ASC
			LIMIT 50
			FOR UPDATE SKIP LOCKED
		)
		UPDATE voice_room_signals s SET consumed_at = now()
		FROM pending p
		WHERE s.id = p.id
		RETURNING s.id::text, s.from_user_id::text, s.kind, s.payload, s.created_at`, rid, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, from, kind string
		var payload []byte
		var created time.Time
		if err := rows.Scan(&id, &from, &kind, &payload, &created); err != nil {
			continue
		}
		var obj any
		_ = json.Unmarshal(payload, &obj)
		items = append(items, map[string]any{
			"id": id, "from_user_id": from, "kind": kind, "payload": obj,
			"created_at": created.UTC().Format(time.RFC3339Nano),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "ice_servers": defaultICEServers()})
}
