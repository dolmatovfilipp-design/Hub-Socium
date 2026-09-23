package users

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

const maxWidgetsSelfServe = 2

// ListWidgets GET /v1/users/{id}/widgets
func (s *Service) ListWidgets(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "id")
	if raw == "" {
		raw = chi.URLParam(r, "username")
	}
	var uid string
	if _, err := uuid.Parse(raw); err == nil {
		uid = raw
	} else {
		_ = s.pool.QueryRow(r.Context(), `SELECT id::text FROM users WHERE username=$1 AND deleted_at IS NULL`, raw).Scan(&uid)
	}
	if uid == "" {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, kind, title, payload, sort_order
		FROM profile_widgets WHERE user_id=$1::uuid
		ORDER BY sort_order, created_at LIMIT 10`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, kind, title string
		var payload []byte
		var sort int
		if rows.Scan(&id, &kind, &title, &payload, &sort) != nil {
			continue
		}
		var pl any
		_ = json.Unmarshal(payload, &pl)
		items = append(items, map[string]any{"id": id, "kind": kind, "title": title, "payload": pl, "sort_order": sort})
	}
	var verified bool
	var presenceStatus, presenceText string
	var attention int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(is_verified,false), COALESCE(presence_status,'available'), COALESCE(presence_text,''), COALESCE(attention_count,0)
		FROM users WHERE id=$1::uuid`, uid).Scan(&verified, &presenceStatus, &presenceText, &attention)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items": items, "is_verified": verified,
		"presence_status": presenceStatus, "presence_text": presenceText, "attention_count": attention,
	})
}

// UpsertWidget POST /v1/me/widgets — self-serve up to 2; verified unlimited (cap 10)
func (s *Service) UpsertWidget(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		ID      string          `json:"id"`
		Kind    string          `json:"kind"`
		Title   string          `json:"title"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Kind = strings.TrimSpace(req.Kind)
	if req.Kind != "price_list" && req.Kind != "portfolio" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "kind must be price_list or portfolio")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		if req.Kind == "price_list" {
			req.Title = "Прайс"
		} else {
			req.Title = "Портфолио"
		}
	}
	if utf8.RuneCountInString(req.Title) > 80 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title too long")
		return
	}
	if len(req.Payload) == 0 {
		req.Payload = []byte("[]")
	}
	var arr []any
	if err := json.Unmarshal(req.Payload, &arr); err != nil || len(arr) > 20 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "payload must be array max 20")
		return
	}

	var verified bool
	var count int
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(is_verified,false) FROM users WHERE id=$1::uuid`, uid).Scan(&verified)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM profile_widgets WHERE user_id=$1::uuid`, uid).Scan(&count)

	if req.ID == "" {
		capN := maxWidgetsSelfServe
		if verified {
			capN = 10
		}
		if count >= capN {
			apiutil.Error(w, http.StatusForbidden, "limit", "widget limit reached (verify for more)")
			return
		}
		id := uuid.New()
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO profile_widgets (id, user_id, kind, title, payload)
			VALUES ($1,$2::uuid,$3,$4,$5::jsonb)`, id, uid, req.Kind, req.Title, string(req.Payload))
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		apiutil.JSON(w, http.StatusCreated, map[string]any{"ok": true, "id": id.String()})
		return
	}

	tag, err := s.pool.Exec(r.Context(), `
		UPDATE profile_widgets SET kind=$3, title=$4, payload=$5::jsonb, updated_at=now()
		WHERE id=$1::uuid AND user_id=$2::uuid`, req.ID, uid, req.Kind, req.Title, string(req.Payload))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "widget not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": req.ID})
}

// DeleteWidget DELETE /v1/me/widgets/{id}
func (s *Service) DeleteWidget(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM profile_widgets WHERE id=$1::uuid AND user_id=$2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "widget not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
