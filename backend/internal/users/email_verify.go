package users

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

func hashVerifyCode(code string) string {
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

func exposeVerifyCode() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("HUB_HIDE_RESET_CODE")), "1") {
		return false
	}
	if strings.TrimSpace(os.Getenv("SMTP_HOST")) != "" {
		return false
	}
	return true
}

// RequestEmailVerify POST /v1/me/email/verify/request
// Sends a 6-digit code for the account email. email_verified flips only on confirm.
func (s *Service) RequestEmailVerify(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var email string
	var verified bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(email,''), COALESCE(email_verified,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&email, &verified)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	email = strings.TrimSpace(email)
	if !strings.Contains(email, "@") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Добавьте email в профиле")
		return
	}
	if verified {
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "email_verified": true, "message": "Почта уже подтверждена"})
		return
	}
	var recent int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM email_verify_codes
		WHERE user_id=$1::uuid AND created_at > now() - interval '60 seconds'`, uid).Scan(&recent)
	if recent > 0 {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Подождите минуту перед новым кодом")
		return
	}
	code, err := randomDigits(6)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "code generate failed")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO email_verify_codes (user_id, email, code_hash, expires_at)
		VALUES ($1::uuid, $2, $3, $4)`, uid, email, hashVerifyCode(code), time.Now().Add(15*time.Minute))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "store code failed")
		return
	}
	out := map[string]any{
		"ok":      true,
		"message": "Код отправлен на почту. В DEV без SMTP код в ответе API.",
	}
	if exposeVerifyCode() {
		out["dev_code"] = code
		out["dev_note"] = "SMTP не настроен — код только в ответе API (не для продакшена)"
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// ConfirmEmailVerify POST /v1/me/email/verify/confirm
// Body: { "code": "123456" }
func (s *Service) ConfirmEmailVerify(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	code := strings.TrimSpace(req.Code)
	if len(code) != 6 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "нужен 6-значный код")
		return
	}
	var email string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(email,'') FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&email)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	email = strings.TrimSpace(email)
	var codeID string
	err = s.pool.QueryRow(r.Context(), `
		SELECT id::text FROM email_verify_codes
		WHERE user_id=$1::uuid
		  AND lower(email)=lower($2)
		  AND code_hash=$3
		  AND used_at IS NULL
		  AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1`, uid, email, hashVerifyCode(code)).Scan(&codeID)
	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "неверный или просроченный код")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `UPDATE email_verify_codes SET used_at=now() WHERE id=$1::uuid`, codeID); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		UPDATE users SET email_verified=true WHERE id=$1::uuid AND deleted_at IS NULL AND lower(COALESCE(email,''))=lower($2)`,
		uid, email); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "email_verified": true, "message": "Почта подтверждена"})
}
