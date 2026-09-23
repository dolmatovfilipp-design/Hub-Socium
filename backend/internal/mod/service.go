package mod

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service serves moderation queue endpoints.
type Service struct {
	pool     *pgxpool.Pool
	modToken string
}

func NewService(pool *pgxpool.Pool, modToken string) *Service {
	return &Service{pool: pool, modToken: strings.TrimSpace(modToken)}
}

// ListReports GET /v1/mod/reports — auth + admin gate (role / mod token / first user).
func (s *Service) ListReports(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if !s.authorized(r, uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "moderator access required")
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT r.id::text,
		       r.reporter_id::text,
		       COALESCE(rep.username, ''),
		       COALESCE(r.reported_user_id::text, ''),
		       COALESCE(tgt.username, ''),
		       COALESCE(r.post_id::text, ''),
		       r.reason,
		       r.status,
		       r.created_at
		FROM reports r
		LEFT JOIN users rep ON rep.id = r.reporter_id
		LEFT JOIN users tgt ON tgt.id = r.reported_user_id
		ORDER BY r.created_at DESC
		LIMIT 200`)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "list reports failed")
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var (
			id, reporterID, reporterName string
			targetID, targetName, postID string
			reason, status               string
			created                      time.Time
		)
		if err := rows.Scan(&id, &reporterID, &reporterName, &targetID, &targetName, &postID, &reason, &status, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "scan report failed")
			return
		}
		items = append(items, map[string]any{
			"id":             id,
			"reporter_id":    reporterID,
			"reporter":       reporterName,
			"target_user_id": emptyNil(targetID),
			"target":         emptyNil(targetName),
			"post_id":        emptyNil(postID),
			"reason":         reason,
			"status":         status,
			"created_at":     created.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "list reports failed")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"reports": items})
}

func (s *Service) authorized(r *http.Request, uid string) bool {
	if tok := strings.TrimSpace(r.Header.Get("X-Hub-Mod-Token")); tok != "" && s.modToken != "" && tok == s.modToken {
		return true
	}
	// Also accept Authorization: Bearer <HUB_MOD_TOKEN> when it is not a JWT (no two dots).
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		raw := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		if s.modToken != "" && raw == s.modToken && strings.Count(raw, ".") != 2 {
			return true
		}
	}
	ok, err := IsAdminUser(r.Context(), s.pool, uid)
	return err == nil && ok
}

// IsAdminUser is true when role=admin, username is филипп, or uid is the earliest user.
func IsAdminUser(ctx context.Context, pool *pgxpool.Pool, uid string) (bool, error) {
	var role, username string
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(role, 'user'), username
		FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, uid).Scan(&role, &username)
	if err != nil {
		return false, err
	}
	if role == "admin" || username == "филипп" {
		return true, nil
	}
	var firstID string
	err = pool.QueryRow(ctx, `
		SELECT id::text FROM users
		WHERE deleted_at IS NULL
		ORDER BY created_at ASC, id ASC
		LIMIT 1`).Scan(&firstID)
	if err != nil {
		return false, err
	}
	return firstID == uid, nil
}

func emptyNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}


// ResolveReport PATCH /v1/mod/reports/{id} — body { "status": "open"|"reviewing"|"resolved"|"rejected" }
func (s *Service) ResolveReport(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if !s.authorized(r, uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "moderator access required")
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	st := strings.ToLower(strings.TrimSpace(req.Status))
	allowed := map[string]bool{"open": true, "reviewing": true, "resolved": true, "rejected": true}
	if !allowed[st] {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "status must be open|reviewing|resolved|rejected")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE reports SET status = $2 WHERE id = $1::uuid`, id, st)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "report not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": id, "status": st})
}

// SetVerified PUT /v1/mod/users/{id}/verified — body { "verified": true|false }
func (s *Service) SetVerified(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	admin, err := IsAdminUser(r.Context(), s.pool, uid)
	if err != nil || !admin {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "admin only")
		return
	}
	target := chi.URLParam(r, "id")
	var req struct {
		Verified bool `json:"verified"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE users SET is_verified=$2 WHERE id=$1::uuid AND deleted_at IS NULL`, target, req.Verified)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "id": target, "is_verified": req.Verified})
}
