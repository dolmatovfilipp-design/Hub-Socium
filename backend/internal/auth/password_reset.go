package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/quality"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	resetCodeTTL = 15 * time.Minute

	// Same wording for every failed confirmation so the API never reveals
	// whether the account exists, the code was wrong, or it expired.
	resetInvalidMsg = "неверный или просроченный код"

	// bcrypt silently ignores bytes past 72 (newer versions refuse them).
	maxPasswordBytes = 72
)

func deriveKey(secret, label string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(label))
	return mac.Sum(nil)
}

// resetCodeHash binds the stored hash to the user and a server-side key, so a
// leaked table cannot be brute-forced offline (the code space is only 10^6).
func (s *Service) resetCodeHash(userID uuid.UUID, code string) string {
	mac := hmac.New(sha256.New, s.resetKey)
	mac.Write([]byte(userID.String()))
	mac.Write([]byte{0})
	mac.Write([]byte(code))
	return hex.EncodeToString(mac.Sum(nil))
}

// randomResetCode returns a uniformly distributed 6-digit code.
func randomResetCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func isSixDigits(s string) bool {
	if len(s) != 6 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// exposeResetCodeInResponse is the dev-only shortcut: with no mailer, local
// development gets the code in the JSON response instead of an email.
// It is never on outside dev mode, and never when email delivery is configured.
// HUB_HIDE_RESET_CODE=1 turns it off in dev as well.
func exposeResetCodeInResponse(devMode, emailReady bool) bool {
	if !devMode || emailReady {
		return false
	}
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("HUB_HIDE_RESET_CODE")), "1")
}

type resetUser struct {
	id       uuid.UUID
	username string
	email    string // empty when the account has no email
}

func (s *Service) findResetUser(ctx context.Context, contact string) (*resetUser, error) {
	var (
		u     resetUser
		email *string
	)
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, email FROM users
		WHERE deleted_at IS NULL
		  AND (
		    lower(username) = lower($1)
		    OR (email IS NOT NULL AND lower(email) = lower($1))
		    OR (phone IS NOT NULL AND phone = $1)
		  )
		LIMIT 1`, contact).Scan(&u.id, &u.username, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if email != nil {
		u.email = strings.TrimSpace(*email)
	}
	return &u, nil
}

// issueResetCode stores a fresh code, replacing any active one. It reports
// issued=false when the account is throttled; callers must answer exactly as if
// the code had been sent.
func (s *Service) issueResetCode(ctx context.Context, userID uuid.UUID, contact, code string) (id uuid.UUID, issued bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, false, err
	}
	defer tx.Rollback(ctx)

	// Serialise concurrent requests for the same account so the limits below hold.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "pwreset:"+userID.String()); err != nil {
		return uuid.Nil, false, err
	}

	var (
		lastHour    int
		coolingDown bool
	)
	if err = tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
		       COALESCE(bool_or(created_at > now() - ($2::int * interval '1 second')), false)
		FROM password_reset_codes WHERE user_id = $1`,
		userID, quality.ResetCooldownSec).Scan(&lastHour, &coolingDown); err != nil {
		return uuid.Nil, false, err
	}
	if coolingDown || lastHour >= quality.ResetPerUserPerHour {
		return uuid.Nil, false, nil
	}

	if _, err = tx.Exec(ctx, `UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return uuid.Nil, false, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM password_reset_codes WHERE user_id = $1 AND created_at < now() - interval '1 day'`, userID); err != nil {
		return uuid.Nil, false, err
	}
	if err = tx.QueryRow(ctx, `
		INSERT INTO password_reset_codes (user_id, contact, code_hash, expires_at)
		VALUES ($1, $2, $3, now() + ($4::int * interval '1 second'))
		RETURNING id`,
		userID, contact, s.resetCodeHash(userID, code), int(resetCodeTTL/time.Second)).Scan(&id); err != nil {
		return uuid.Nil, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

// resetLink is the one-tap link from the email. Email and code travel in the URL
// fragment, which browsers never send to a server, so they stay out of access logs.
func (s *Service) resetLink(email, code string) string {
	if s.appURL == "" {
		return ""
	}
	q := url.Values{}
	q.Set("email", email)
	q.Set("code", code)
	return s.appURL + "/reset#" + q.Encode()
}

func internalError(w http.ResponseWriter, step string, err error) {
	slog.Error("password reset", "step", step, "err", err)
	apiutil.Error(w, http.StatusInternalServerError, "internal", "внутренняя ошибка, попробуйте позже")
}

// RequestPasswordReset POST /v1/auth/password-reset/request
// Body: { "contact": "email|phone|username" }
//
// The code goes to the email stored on the account. The response is the same
// whether or not the account exists, has an email, or is throttled, so it
// cannot be used to probe for accounts. Without a configured mailer the
// endpoint answers 503, except in dev mode where the code is returned inline.
func (s *Service) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	if n := utf8.RuneCountInString(contact); n < 3 || n > 254 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "укажите email, телефон или имя пользователя")
		return
	}

	emailReady := s.mail != nil
	exposeCode := exposeResetCodeInResponse(s.devMode, emailReady)
	if !emailReady && !exposeCode {
		apiutil.Error(w, http.StatusServiceUnavailable, "email_unavailable",
			"восстановление пароля по почте сейчас недоступно, попробуйте позже")
		return
	}

	msg := fmt.Sprintf("Если аккаунт найден и к нему привязана почта, мы отправили на неё код. Он действует %d минут.", int(resetCodeTTL/time.Minute))
	if exposeCode {
		msg = "DEV: SMTP не настроен, письмо не отправляется. Код возвращается в ответе API."
	}
	out := map[string]any{"ok": true, "message": msg}

	ctx := r.Context()
	u, err := s.findResetUser(ctx, contact)
	if err != nil {
		internalError(w, "lookup", err)
		return
	}
	if u == nil || (emailReady && u.email == "") {
		apiutil.JSON(w, http.StatusOK, out)
		return
	}

	code, err := randomResetCode()
	if err != nil {
		internalError(w, "generate", err)
		return
	}
	codeID, issued, err := s.issueResetCode(ctx, u.id, contact, code)
	if err != nil {
		internalError(w, "store", err)
		return
	}
	if !issued {
		slog.Info("password reset throttled", "user_id", u.id)
		apiutil.JSON(w, http.StatusOK, out)
		return
	}

	if emailReady {
		if err := s.mail.Enqueue(resetEmail(u.email, u.username, code, s.resetLink(u.email, code))); err != nil {
			slog.Error("password reset email not queued", "user_id", u.id, "err", err)
			// Free the cooldown so the user can simply try again.
			if _, derr := s.pool.Exec(ctx, `DELETE FROM password_reset_codes WHERE id = $1`, codeID); derr != nil {
				slog.Error("password reset cleanup", "user_id", u.id, "err", derr)
			}
		}
	}
	slog.Info("password reset requested", "user_id", u.id, "emailed", emailReady)

	if exposeCode {
		out["dev_code"] = code
		out["dev_note"] = "SMTP не настроен — код только в ответе API (не для продакшена)"
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// consumeResetAttempt counts one guess against every active code of the user
// and returns them. Counting happens before comparing, inside one statement:
// concurrent guesses queue on the row lock, and Postgres re-checks
// attempts < max for each, so parallel requests cannot exceed the limit.
func (s *Service) consumeResetAttempt(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE password_reset_codes SET attempts = attempts + 1
		WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
		RETURNING id, code_hash`, userID, quality.ResetCodeMaxAttempts)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	active := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id   uuid.UUID
			hash string
		)
		if err := rows.Scan(&id, &hash); err != nil {
			return nil, err
		}
		active[id] = hash
	}
	return active, rows.Err()
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
	if n := utf8.RuneCountInString(contact); n < 3 || n > 254 || !isSixDigits(code) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "contact и 6-значный код обязательны")
		return
	}
	if utf8.RuneCountInString(pass) < 4 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "пароль не менее 4 символов")
		return
	}
	if len(pass) > maxPasswordBytes {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "пароль слишком длинный")
		return
	}

	ctx := r.Context()
	u, err := s.findResetUser(ctx, contact)
	if err != nil {
		internalError(w, "lookup", err)
		return
	}
	if u == nil {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", resetInvalidMsg)
		return
	}

	active, err := s.consumeResetAttempt(ctx, u.id)
	if err != nil {
		internalError(w, "attempt", err)
		return
	}
	want := s.resetCodeHash(u.id, code)
	var matched uuid.UUID
	for id, hash := range active {
		if hmac.Equal([]byte(hash), []byte(want)) {
			matched = id
		}
	}
	if matched == uuid.Nil {
		if _, err := s.pool.Exec(ctx, `
			UPDATE password_reset_codes SET used_at = now()
			WHERE user_id = $1 AND used_at IS NULL AND attempts >= $2`, u.id, quality.ResetCodeMaxAttempts); err != nil {
			slog.Error("password reset burn", "user_id", u.id, "err", err)
		}
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", resetInvalidMsg)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		internalError(w, "hash", err)
		return
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		internalError(w, "begin", err)
		return
	}
	defer tx.Rollback(ctx)

	// Claim the code first: of two parallel correct requests only one gets 1 row.
	claim, err := tx.Exec(ctx, `
		UPDATE password_reset_codes SET used_at = now()
		WHERE id = $1 AND used_at IS NULL AND expires_at > now()`, matched)
	if err != nil {
		internalError(w, "claim", err)
		return
	}
	if claim.RowsAffected() != 1 {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", resetInvalidMsg)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, u.id, string(hash)); err != nil {
		internalError(w, "update password", err)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, u.id); err != nil {
		internalError(w, "revoke sessions", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		internalError(w, "commit", err)
		return
	}
	slog.Info("password reset completed", "user_id", u.id)

	if s.mail != nil && u.email != "" {
		if err := s.mail.Enqueue(passwordChangedEmail(u.email, u.username, time.Now())); err != nil {
			slog.Warn("password changed email not queued", "user_id", u.id, "err", err)
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Пароль обновлён"})
}
