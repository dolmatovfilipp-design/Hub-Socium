package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/notify"
	"github.com/jackc/pgx/v5"
)

// RequestContactCode POST /v1/auth/contact-code/request
// Body: { "contact", "channel": "email"|"phone" }
func (s *Service) RequestContactCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
		Channel string `json:"channel"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	channel := strings.TrimSpace(req.Channel)
	if channel != "email" && channel != "phone" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "channel: email|phone")
		return
	}
	if channel == "email" && !strings.Contains(contact, "@") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Укажите email")
		return
	}
	if channel == "phone" && strings.Contains(contact, "@") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Укажите телефон")
		return
	}
	if channel == "email" && !notify.MailConfigured() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "Почта не отправляется: задайте SMTP_HOST")
		return
	}
	if channel == "phone" && !notify.SMSConfigured() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "SMS не отправляются: задайте SMS_PROVIDER")
		return
	}
	var recent int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM contact_codes
		WHERE contact=$1 AND created_at > now() - interval '60 seconds'`, contact).Scan(&recent)
	if recent > 0 {
		apiutil.Error(w, http.StatusTooManyRequests, "rate_limited", "Подождите минуту перед новым кодом")
		return
	}
	code, err := randomDigits(6)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "code")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO contact_codes (contact, channel, code_hash, expires_at)
		VALUES ($1, $2, $3, $4)`, contact, channel, hashResetCode(code), time.Now().Add(15*time.Minute))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var sendErr error
	if channel == "email" {
		sendErr = notify.SendMail(contact, "Код Get Hub", "Код подтверждения: "+code+"\nОн действует 15 минут.")
	} else {
		sendErr = notify.SendSMS(contact, "Get Hub код: "+code)
	}
	if sendErr != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "Не удалось отправить код")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Код отправлен"})
}

// ConfirmContactCode POST /v1/auth/contact-code/confirm
func (s *Service) ConfirmContactCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Contact string `json:"contact"`
		Code    string `json:"code"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	contact := strings.TrimSpace(req.Contact)
	code := strings.TrimSpace(req.Code)
	if len(code) != 6 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "нужен 6-значный код")
		return
	}
	var id string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id::text FROM contact_codes
		WHERE contact=$1 AND code_hash=$2 AND expires_at > now()
		ORDER BY created_at DESC LIMIT 1`, contact, hashResetCode(code)).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Неверный код")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM contact_codes WHERE contact=$1`, contact)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "verified": true})
}
