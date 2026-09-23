package meetups

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	mid := chi.URLParam(r, "id")
	var host, title, desc, cityV, place, uname, dname string
	var starts, created time.Time
	var going int
	var igo bool
	var convID *uuid.UUID
	err := s.pool.QueryRow(r.Context(), `
		SELECT m.host_id::text, m.title, m.description, m.city, m.place, m.starts_at, m.created_at, m.conversation_id,
		       u.username, u.display_name,
		       (SELECT COUNT(*)::int FROM meetup_rsvps r WHERE r.meetup_id=m.id AND r.status='going'),
		       EXISTS(SELECT 1 FROM meetup_rsvps r2 WHERE r2.meetup_id=m.id AND r2.user_id=$2::uuid AND r2.status='going')
		FROM meetups m JOIN users u ON u.id=m.host_id
		WHERE m.id=$1::uuid AND m.deleted_at IS NULL`, mid, uid).
		Scan(&host, &title, &desc, &cityV, &place, &starts, &created, &convID, &uname, &dname, &going, &igo)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "meetup not found")
		return
	}
	out := map[string]any{
		"id": mid, "host_id": host, "title": title, "description": desc, "city": cityV, "place": place,
		"starts_at": starts.UTC().Format(time.RFC3339Nano), "created_at": created.UTC().Format(time.RFC3339Nano),
		"going": going, "i_go": igo, "host": map[string]any{"id": host, "username": uname, "display_name": dname},
	}
	if convID != nil {
		out["conversation_id"] = convID.String()
	}
	apiutil.JSON(w, http.StatusOK, out)
}

func (s *Service) RSVPGoing(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	mid := chi.URLParam(r, "id")
	var hostID string
	var convID *uuid.UUID
	err := s.pool.QueryRow(r.Context(), `SELECT host_id::text, conversation_id FROM meetups WHERE id=$1::uuid AND deleted_at IS NULL`, mid).
		Scan(&hostID, &convID)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "meetup not found")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO meetup_rsvps (meetup_id, user_id, status) VALUES ($1::uuid,$2::uuid,'going')
		ON CONFLICT (meetup_id, user_id) DO UPDATE SET status='going'`, mid, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if convID == nil {
		newConv := uuid.New()
		tx, err := s.pool.Begin(r.Context())
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		defer tx.Rollback(r.Context())
		if _, err = tx.Exec(r.Context(), `INSERT INTO conversations (id) VALUES ($1)`, newConv); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		_, _ = tx.Exec(r.Context(), `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2::uuid) ON CONFLICT DO NOTHING`, newConv, hostID)
		_, _ = tx.Exec(r.Context(), `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2::uuid) ON CONFLICT DO NOTHING`, newConv, uid)
		_, _ = tx.Exec(r.Context(), `UPDATE meetups SET conversation_id=$1 WHERE id=$2::uuid`, newConv, mid)
		_ = tx.Commit(r.Context())
		convID = &newConv
	} else {
		_, _ = s.pool.Exec(r.Context(), `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2::uuid) ON CONFLICT DO NOTHING`, *convID, uid)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "i_go": true, "conversation_id": convID.String()})
}

func (s *Service) RSVPCancel(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	mid := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `UPDATE meetup_rsvps SET status='cancelled' WHERE meetup_id=$1::uuid AND user_id=$2::uuid`, mid, uid)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "i_go": false})
}
