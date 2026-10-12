package users

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"golang.org/x/crypto/bcrypt"
)

// DeleteAccount POST /v1/me/delete
// Body: { "password": "..." }
// Soft-deletes the account and stamps purged_at. Login stops working.
func (s *Service) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "введите пароль")
		return
	}
	var hash string
	err := s.pool.QueryRow(r.Context(), `
		SELECT password_hash FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&hash)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "Неверный пароль")
		return
	}
	id, err := uuid.Parse(uid)
	if err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "bad user")
		return
	}
	anon := "deleted_" + strings.ReplaceAll(id.String(), "-", "")[:12]

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var purgedAt string
	err = tx.QueryRow(r.Context(), `
		UPDATE users SET
		  deleted_at = now(),
		  purged_at = now(),
		  email = NULL,
		  phone = NULL,
		  email_verified = false,
		  phone_verified = false,
		  bio = '',
		  about = '',
		  services = '',
		  avatar_url = '',
		  display_name = 'Удалённый аккаунт',
		  username = $2,
		  presence_text = '',
		  links = '[]'::jsonb
		WHERE id=$1::uuid AND deleted_at IS NULL
		RETURNING purged_at::text`, uid, anon).Scan(&purgedAt)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `UPDATE posts SET deleted_at=now() WHERE author_id=$1::uuid AND deleted_at IS NULL`, uid)
	_, _ = tx.Exec(r.Context(), `UPDATE stories SET deleted_at=now() WHERE author_id=$1::uuid AND deleted_at IS NULL`, uid)
	_, _ = tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL`, uid)
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "purged_at": purgedAt})
}
