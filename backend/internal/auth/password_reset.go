package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func hashResetCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

func randomDigits(n int) (string, error) {
	const digits = "0123456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, n)
	for i := range b {
		out[i] = digits[int(b[i])%10]
	}
	return string(out), nil
}

// exposeResetCodeInResponse is honest DEV: no SMTP → return code in JSON.
// Set SMTP_HOST (or HUB_HIDE_RESET_CODE=1) to hide the code in responses.
func exposeResetCodeInResponse() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("HUB_HIDE_RESET_CODE")), "1") {
		return false
	}
	if strings.TrimSpace(os.Getenv("SMTP_HOST")) != "" {
		return false
	}
	return true
}

// RequestPasswordReset POST /v1/auth/password-reset/request
// Body: { "contact": "email|phone|username" }
// Always 200 when well-formed (anti-enumeration). In DEV returns dev_code.
func (s *Service) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	if utf8.RuneCountInString(contact) < 3 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "укажите email, телефон или имя пользователя")
		return
	}

	ctx := r.Context()
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM users
		WHERE deleted_at IS NULL
		  AND (
		    lower(username) = lower($1)
		    OR (email IS NOT NULL AND lower(email) = lower($1))
		    OR (phone IS NOT NULL AND phone = $1)
		  )
		LIMIT 1`, contact).Scan(&userID)

	out := map[string]any{
		"ok":      true,
		"message": "Если аккаунт найден, код отправлен. В DEV без SMTP код в ответе API.",
	}

	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.JSON(w, http.StatusOK, out)
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	code, err := randomDigits(6)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "code generate failed")
		return
	}
	expires := time.Now().Add(15 * time.Minute)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO password_reset_codes (user_id, contact, code_hash, expires_at)
		VALUES ($1, $2, $3, $4)`, userID, contact, hashResetCode(code), expires)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "store code failed")
		return
	}

	if exposeResetCodeInResponse() {
		out["dev_code"] = code
		out["dev_note"] = "SMTP не настроен — код только в ответе API (не для продакшена)"
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// ConfirmPasswordReset POST /v1/auth/password-reset/confirm
// Body: { "contact", "code", "new_password" }
func (s *Service) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact     string `json:"contact"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	code := strings.TrimSpace(req.Code)
	pass := req.NewPassword
	if utf8.RuneCountInString(contact) < 3 || len(code) != 6 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "contact и 6-значный код обязательны")
		return
	}
	if utf8.RuneCountInString(pass) < 4 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "пароль не менее 4 символов")
		return
	}

	ctx := r.Context()
	var userID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM users
		WHERE deleted_at IS NULL
		  AND (
		    lower(username) = lower($1)
		    OR (email IS NOT NULL AND lower(email) = lower($1))
		    OR (phone IS NOT NULL AND phone = $1)
		  )
		LIMIT 1`, contact).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "неверный код или контакт")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var resetID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		SELECT id FROM password_reset_codes
		WHERE user_id = $1
		  AND code_hash = $2
		  AND used_at IS NULL
		  AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1`, userID, hashResetCode(code)).Scan(&resetID)
	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "неверный или просроченный код")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "hash failed")
		return
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, userID, string(hash)); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE password_reset_codes SET used_at = now() WHERE id = $1`, resetID); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// Invalidate sessions
	_, _ = tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	if err := tx.Commit(ctx); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Пароль обновлён"})
}
