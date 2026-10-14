package users

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/notify"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	emailCodeTTL      = 10 * time.Minute
	emailCodeAttempts = 5
)

var (
	// ErrVerifyCooldown is returned when a code was sent less than 60 seconds ago.
	ErrVerifyCooldown = errors.New("verify cooldown")
	// ErrVerifyNoMail is returned when SMTP is not configured and the code must not be exposed.
	ErrVerifyNoMail = errors.New("verify mail unavailable")
)

// IssuedEmailCode is the result of storing a fresh verification code.
type IssuedEmailCode struct {
	Mailed  bool
	DevCode string
}

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

// IssueEmailCode stores a hashed 6-digit code (10 minutes, 5 attempts, 60s resend)
// and sends it through the password-reset mailer when SMTP is configured.
func IssueEmailCode(ctx context.Context, pool *pgxpool.Pool, userID, email string) (IssuedEmailCode, error) {
	email = strings.TrimSpace(email)
	if !strings.Contains(email, "@") {
		return IssuedEmailCode{}, errors.New("email required")
	}
	var recent int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM email_verify_codes
		WHERE user_id=$1::uuid AND created_at > now() - interval '60 seconds'`, userID).Scan(&recent); err != nil {
		return IssuedEmailCode{}, err
	}
	if recent > 0 {
		return IssuedEmailCode{}, ErrVerifyCooldown
	}
	code, err := randomDigits(6)
	if err != nil {
		return IssuedEmailCode{}, err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO email_verify_codes (user_id, email, code_hash, expires_at, attempts)
		VALUES ($1::uuid, $2, $3, $4, 0)`, userID, email, hashVerifyCode(code), time.Now().Add(emailCodeTTL))
	if err != nil {
		return IssuedEmailCode{}, err
	}
	if notify.MailConfigured() {
		if err := notify.SendMail(email, "Код Get Hub", "Код подтверждения почты: "+code+"\nОн действует 10 минут."); err != nil {
			return IssuedEmailCode{}, err
		}
		return IssuedEmailCode{Mailed: true}, nil
	}
	if notify.ExposeDevCode() {
		return IssuedEmailCode{DevCode: code}, nil
	}
	return IssuedEmailCode{}, ErrVerifyNoMail
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
	issued, err := IssueEmailCode(r.Context(), s.pool, uid, email)
	if errors.Is(err, ErrVerifyCooldown) {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Подождите минуту перед новым кодом")
		return
	}
	if errors.Is(err, ErrVerifyNoMail) {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "Подтверждение почты недоступно: задайте SMTP_HOST")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "Не удалось отправить письмо")
		return
	}
	out := map[string]any{
		"ok":      true,
		"message": "Код отправлен на почту. Он действует 10 минут.",
	}
	if !issued.Mailed && issued.DevCode != "" {
		out["dev_code"] = issued.DevCode
		out["message"] = "Код создан. Почта на этом сервере не настроена."
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
	var codeID, storedHash string
	var attempts int
	err = s.pool.QueryRow(r.Context(), `
		SELECT id::text, code_hash, attempts
		FROM email_verify_codes
		WHERE user_id=$1::uuid
		  AND lower(email)=lower($2)
		  AND used_at IS NULL
		  AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1`, uid, email).Scan(&codeID, &storedHash, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "неверный или просроченный код")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if attempts >= emailCodeAttempts {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Слишком много попыток. Запросите новый код")
		return
	}
	if storedHash != hashVerifyCode(code) {
		attempts++
		_, _ = s.pool.Exec(r.Context(), `UPDATE email_verify_codes SET attempts=$2 WHERE id=$1::uuid`, codeID, attempts)
		if attempts >= emailCodeAttempts {
			apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Слишком много попыток. Запросите новый код")
			return
		}
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "неверный или просроченный код")
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
