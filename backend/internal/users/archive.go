package users

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

var archiveTypes = map[string]bool{
	"post": true, "message": true, "contact": true,
	"listing": true, "photo": true, "video": true,
}

// ListArchive GET /v1/me/archive
func (s *Service) ListArchive(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	typeFilter := strings.TrimSpace(r.URL.Query().Get("type"))
	q := `
		SELECT id::text, item_type, ref_id, title, preview, coalesce(meta::text, '{}'), created_at
		FROM user_archive WHERE user_id=$1::uuid`
	args := []any{uid}
	if typeFilter != "" && archiveTypes[typeFilter] {
		q += ` AND item_type=$2`
		args = append(args, typeFilter)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := s.pool.Query(r.Context(), q, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, itemType, refID, title, preview, metaRaw string
		var createdAt any
		if err := rows.Scan(&id, &itemType, &refID, &title, &preview, &metaRaw, &createdAt); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		var meta any = map[string]any{}
		_ = json.Unmarshal([]byte(metaRaw), &meta)
		items = append(items, map[string]any{
			"id": id, "type": itemType, "ref_id": refID,
			"title": title, "preview": preview, "meta": meta,
			"created_at": createdAt,
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// AddArchive POST /v1/me/archive  { type, ref_id, title?, preview?, meta? }
func (s *Service) AddArchive(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Type    string         `json:"type"`
		RefID   string         `json:"ref_id"`
		Title   string         `json:"title"`
		Preview string         `json:"preview"`
		Meta    map[string]any `json:"meta"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "validation_error", "invalid json")
		return
	}
	itemType := strings.TrimSpace(strings.ToLower(req.Type))
	refID := strings.TrimSpace(req.RefID)
	if !archiveTypes[itemType] || refID == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "type and ref_id required")
		return
	}
	title := truncateRunes(strings.TrimSpace(req.Title), 200)
	preview := truncateRunes(strings.TrimSpace(req.Preview), 500)
	metaBytes, _ := json.Marshal(req.Meta)
	if len(metaBytes) == 0 || string(metaBytes) == "null" {
		metaBytes = []byte("{}")
	}
	id := uuid.New()
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO user_archive (id, user_id, item_type, ref_id, title, preview, meta)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb)
		ON CONFLICT (user_id, item_type, ref_id) DO UPDATE
		  SET title = EXCLUDED.title,
		      preview = EXCLUDED.preview,
		      meta = EXCLUDED.meta,
		      created_at = now()`, id, uid, itemType, refID, title, preview, string(metaBytes))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var outID string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT id::text FROM user_archive
		WHERE user_id=$1::uuid AND item_type=$2 AND ref_id=$3`, uid, itemType, refID).Scan(&outID)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "id": outID, "type": itemType, "ref_id": refID,
	})
}

// RemoveArchive DELETE /v1/me/archive/{id}
func (s *Service) RemoveArchive(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apiutil.Error(w, http.StatusBadRequest, "validation_error", "missing id")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		DELETE FROM user_archive WHERE id=$1::uuid AND user_id=$2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
