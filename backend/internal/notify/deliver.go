package notify

import (
	"fmt"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"time"
)

// MailConfigured is true when SMTP_HOST is set.
func MailConfigured() bool {
	return strings.TrimSpace(os.Getenv("SMTP_HOST")) != ""
}

// ExposeDevCode is true only for a local dev process without SMTP.
// Production (HUB_ENV=production) never receives the plaintext code.
func ExposeDevCode() bool {
	if MailConfigured() {
		return false
	}
	if strings.TrimSpace(os.Getenv("HUB_HIDE_RESET_CODE")) == "1" {
		return false
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("HUB_ENV")))
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	}
	switch env {
	case "production", "prod":
		return false
	case "dev", "development":
		return true
	}
	return os.Getenv("HUB_EMBEDDED_PG") == "1" || strings.TrimSpace(os.Getenv("DATABASE_URL")) == ""
}

// SMSConfigured is true when an SMS provider and its key are set.
func SMSConfigured() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SMS_PROVIDER"))) {
	case "smsru":
		return strings.TrimSpace(os.Getenv("SMSRU_API_ID")) != ""
	case "twilio":
		return strings.TrimSpace(os.Getenv("TWILIO_ACCOUNT_SID")) != "" &&
			strings.TrimSpace(os.Getenv("TWILIO_AUTH_TOKEN")) != "" &&
			strings.TrimSpace(os.Getenv("TWILIO_FROM")) != ""
	default:
		return false
	}
}

// SendMail delivers a plain-text message. SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM.
func SendMail(to, subject, body string) error {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		return fmt.Errorf("SMTP не настроен")
	}
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	if from == "" {
		from = "help@gethub.online"
	}
	addr := host + ":" + port
	msg := []byte("From: " + from + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body + "\r\n")
	user := strings.TrimSpace(os.Getenv("SMTP_USER"))
	pass := os.Getenv("SMTP_PASSWORD")
	var auth smtp.Auth
	if user != "" {
		auth = smtp.PlainAuth("", user, pass, host)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

// SendSMS delivers a text when SMS_PROVIDER is smsru or twilio.
func SendSMS(phone, text string) error {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return fmt.Errorf("нет телефона")
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SMS_PROVIDER"))) {
	case "smsru":
		id := strings.TrimSpace(os.Getenv("SMSRU_API_ID"))
		if id == "" {
			return fmt.Errorf("SMS не настроен")
		}
		form := url.Values{}
		form.Set("api_id", id)
		form.Set("to", phone)
		form.Set("msg", text)
		form.Set("json", "1")
		client := &http.Client{Timeout: 15 * time.Second}
		res, err := client.PostForm("https://sms.ru/sms/send", form)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("sms.ru %d", res.StatusCode)
		}
		return nil
	case "twilio":
		sid := strings.TrimSpace(os.Getenv("TWILIO_ACCOUNT_SID"))
		token := strings.TrimSpace(os.Getenv("TWILIO_AUTH_TOKEN"))
		from := strings.TrimSpace(os.Getenv("TWILIO_FROM"))
		if sid == "" || token == "" || from == "" {
			return fmt.Errorf("SMS не настроен")
		}
		form := url.Values{}
		form.Set("To", phone)
		form.Set("From", from)
		form.Set("Body", text)
		req, err := http.NewRequest(http.MethodPost, "https://api.twilio.com/2010-04-01/Accounts/"+sid+"/Messages.json", strings.NewReader(form.Encode()))
		if err != nil {
			return err
		}
		req.SetBasicAuth(sid, token)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		client := &http.Client{Timeout: 15 * time.Second}
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			return fmt.Errorf("twilio %d", res.StatusCode)
		}
		return nil
	default:
		return fmt.Errorf("SMS не настроен")
	}
}
