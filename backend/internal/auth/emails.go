package auth

import (
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/hub-socium/hub/backend/internal/mailer"
)

const brandName = "Get Hub"

var ruMonths = [...]string{
	"января", "февраля", "марта", "апреля", "мая", "июня",
	"июля", "августа", "сентября", "октября", "ноября", "декабря",
}

// ruPlural picks the Russian noun form for n: 1 минута, 2 минуты, 5 минут.
func ruPlural(n int, one, few, many string) string {
	if n < 0 {
		n = -n
	}
	if m := n % 100; m >= 11 && m <= 14 {
		return many
	}
	switch n % 10 {
	case 1:
		return one
	case 2, 3, 4:
		return few
	}
	return many
}

func formatRuTime(t time.Time) string {
	t = t.UTC()
	return fmt.Sprintf("%d %s %d, %s UTC", t.Day(), ruMonths[t.Month()-1], t.Year(), t.Format("15:04"))
}

type resetEmailData struct {
	Brand       string
	Username    string
	Code        string
	Minutes     int
	MinutesWord string
}

type changedEmailData struct {
	Brand    string
	Username string
	When     string
}

var (
	resetText = texttemplate.Must(texttemplate.New("reset.txt").Parse(`Здравствуйте!

Вы запросили сброс пароля для аккаунта @{{.Username}} в {{.Brand}}.

Ваш код: {{.Code}}

Код действует {{.Minutes}} {{.MinutesWord}} и подходит для одного использования. Никому его не сообщайте: сотрудники {{.Brand}} никогда не спрашивают код.

Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо: пароль останется прежним.

— {{.Brand}}
`))

	resetHTML = htmltemplate.Must(htmltemplate.New("reset.html").Parse(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Код для сброса пароля</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f3f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;background:#ffffff;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;">
<tr><td style="padding:28px 28px 0 28px;font-size:20px;font-weight:700;letter-spacing:-0.2px;">{{.Brand}}</td></tr>
<tr><td style="padding:20px 28px 0 28px;font-size:16px;line-height:24px;">Вы запросили сброс пароля для аккаунта <b>@{{.Username}}</b>. Введите этот код в приложении:</td></tr>
<tr><td align="center" style="padding:22px 28px;">
<div style="display:inline-block;background:#f2f3f5;border-radius:12px;padding:14px 22px;font-family:'SFMono-Regular',Menlo,Consolas,'Courier New',monospace;font-size:32px;line-height:40px;letter-spacing:8px;font-weight:700;color:#111111;">{{.Code}}</div>
</td></tr>
<tr><td style="padding:0 28px;font-size:14px;line-height:21px;color:#555555;">Код действует {{.Minutes}} {{.MinutesWord}} и подходит для одного использования. Никому его не сообщайте: сотрудники {{.Brand}} никогда не спрашивают код.</td></tr>
<tr><td style="padding:14px 28px 28px 28px;font-size:14px;line-height:21px;color:#555555;">Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо: пароль останется прежним.</td></tr>
</table>
<div style="max-width:440px;padding:16px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8f98;text-align:center;">Это автоматическое письмо, отвечать на него не нужно.</div>
</td></tr>
</table>
</body>
</html>
`))

	changedText = texttemplate.Must(texttemplate.New("changed.txt").Parse(`Здравствуйте!

Пароль для аккаунта @{{.Username}} в {{.Brand}} был изменён {{.When}}. Все активные сеансы завершены.

Если это сделали вы, больше ничего делать не нужно.

Если это были не вы, срочно восстановите доступ ещё раз: нажмите «Забыли пароль?» на экране входа. Заодно проверьте безопасность почты, к которой привязан аккаунт.

— {{.Brand}}
`))

	changedHTML = htmltemplate.Must(htmltemplate.New("changed.html").Parse(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Пароль изменён</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f3f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;background:#ffffff;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;">
<tr><td style="padding:28px 28px 0 28px;font-size:20px;font-weight:700;letter-spacing:-0.2px;">{{.Brand}}</td></tr>
<tr><td style="padding:20px 28px 0 28px;font-size:16px;line-height:24px;">Пароль для аккаунта <b>@{{.Username}}</b> был изменён {{.When}}. Все активные сеансы завершены.</td></tr>
<tr><td style="padding:14px 28px 0 28px;font-size:14px;line-height:21px;color:#555555;">Если это сделали вы, больше ничего делать не нужно.</td></tr>
<tr><td style="padding:14px 28px 28px 28px;font-size:14px;line-height:21px;color:#555555;"><b>Если это были не вы</b>, срочно восстановите доступ ещё раз: нажмите «Забыли пароль?» на экране входа. Заодно проверьте безопасность почты, к которой привязан аккаунт.</td></tr>
</table>
<div style="max-width:440px;padding:16px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8f98;text-align:center;">Это автоматическое письмо, отвечать на него не нужно.</div>
</td></tr>
</table>
</body>
</html>
`))
)

func resetEmail(to, username, code string) mailer.Message {
	minutes := int(resetCodeTTL / time.Minute)
	d := resetEmailData{
		Brand:       brandName,
		Username:    username,
		Code:        code,
		Minutes:     minutes,
		MinutesWord: ruPlural(minutes, "минуту", "минуты", "минут"),
	}
	return mailer.Message{
		To:      to,
		Kind:    "password_reset",
		Subject: "Код для сброса пароля " + brandName,
		Text:    mustRenderText(resetText, d),
		HTML:    mustRenderHTML(resetHTML, d),
	}
}

func passwordChangedEmail(to, username string, at time.Time) mailer.Message {
	d := changedEmailData{Brand: brandName, Username: username, When: formatRuTime(at)}
	return mailer.Message{
		To:      to,
		Kind:    "password_changed",
		Subject: "Пароль " + brandName + " изменён",
		Text:    mustRenderText(changedText, d),
		HTML:    mustRenderHTML(changedHTML, d),
	}
}

func mustRenderText(t *texttemplate.Template, data any) string {
	var b strings.Builder
	if err := t.Execute(&b, data); err != nil {
		panic("auth: render email text: " + err.Error())
	}
	return b.String()
}

func mustRenderHTML(t *htmltemplate.Template, data any) string {
	var b strings.Builder
	if err := t.Execute(&b, data); err != nil {
		panic("auth: render email html: " + err.Error())
	}
	return b.String()
}
