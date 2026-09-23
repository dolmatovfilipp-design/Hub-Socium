package guest

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Guest / family mode: invite link → read-only feed + host profile, no account required.
type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func randomToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateLink POST /v1/me/guest-links — { label?: string }
func (s *Service) CreateLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = "Семья"
	}
	if len([]rune(label)) > 40 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "label max 40")
		return
	}
	id := uuid.New()
	token := randomToken()
	exp := time.Now().UTC().Add(30 * 24 * time.Hour)
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO guest_links (id, token, created_by, label, expires_at)
		VALUES ($1,$2,$3::uuid,$4,$5)`, id, token, uid, label, exp)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "token": token, "label": label,
		"expires_at": exp.Format(time.RFC3339),
		"path": "/g/" + token,
	})
}

// ListLinks GET /v1/me/guest-links
func (s *Service) ListLinks(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, token, label, created_at, expires_at
		FROM guest_links WHERE created_by=$1::uuid AND revoked_at IS NULL AND expires_at > now()
		ORDER BY created_at DESC LIMIT 20`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, token, label string
		var created, exp time.Time
		if rows.Scan(&id, &token, &label, &created, &exp) == nil {
			items = append(items, map[string]any{
				"id": id, "token": token, "label": label, "path": "/g/" + token,
				"created_at": created.UTC().Format(time.RFC3339),
				"expires_at": exp.UTC().Format(time.RFC3339),
			})
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// RevokeLink DELETE /v1/me/guest-links/{id}
func (s *Service) RevokeLink(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE guest_links SET revoked_at=now()
		WHERE id=$1::uuid AND created_by=$2::uuid AND revoked_at IS NULL`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "link not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// View GET /v1/guest/{token} — no auth. Read-only host profile + recent posts.
func (s *Service) View(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(chi.URLParam(r, "token"))
	if token == "" {
		apiutil.Error(w, http.StatusNotFound, "not_found", "invalid link")
		return
	}
	var hostID, label string
	var exp time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT created_by::text, label, expires_at FROM guest_links
		WHERE token=$1 AND revoked_at IS NULL`, token).Scan(&hostID, &label, &exp)
	if err != nil || time.Now().After(exp) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "ссылка недействительна или истекла")
		return
	}
	var username, display, bio, avatar string
	var verified bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT username, display_name, COALESCE(bio,''), COALESCE(avatar_url,''), COALESCE(is_verified,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, hostID).
		Scan(&username, &display, &bio, &avatar, &verified)

	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, body, COALESCE(image_url,''), created_at
		FROM posts WHERE author_id=$1::uuid AND deleted_at IS NULL AND COALESCE(status,'published')='published'
		ORDER BY created_at DESC LIMIT 30`, hostID)
	posts := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, body, img string
			var created time.Time
			if rows.Scan(&id, &body, &img, &created) == nil {
				it := map[string]any{"id": id, "body": body, "created_at": created.UTC().Format(time.RFC3339)}
				if img != "" {
					it["image_url"] = img
				}
				posts = append(posts, it)
			}
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"mode": "guest_readonly",
		"label": label,
		"host": map[string]any{
			"id": hostID, "username": username, "display_name": display,
			"bio": bio, "avatar_url": avatar, "is_verified": verified,
		},
		"posts": posts,
		"note": "Гостевой просмотр по ссылке. Регистрация не нужна. Писать и реагировать нельзя.",
	})
}
