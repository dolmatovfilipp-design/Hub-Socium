package mailer

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Mailer delivers messages through one SMTP server. It opens a fresh
// connection per message, which is plenty for transactional volume and avoids
// stale-connection handling.
type Mailer struct {
	cfg  Config
	from *mail.Address
	helo string

	dialTimeout time.Duration
	opTimeout   time.Duration
	// tls overrides the default TLS settings; set by tests to trust a throwaway CA.
	tls *tls.Config
}

// New validates cfg and returns a ready Mailer.
func New(cfg Config) (*Mailer, error) {
	if !cfg.Enabled() {
		return nil, errors.New("mailer: SMTP is not configured (SMTP_HOST is empty)")
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	from, err := mail.ParseAddress(cfg.From)
	if err != nil {
		return nil, err
	}
	helo := "localhost"
	if i := strings.LastIndexByte(from.Address, '@'); i >= 0 && validHostname(from.Address[i+1:]) {
		helo = from.Address[i+1:]
	}
	return &Mailer{
		cfg:         cfg,
		from:        from,
		helo:        helo,
		dialTimeout: 10 * time.Second,
		opTimeout:   30 * time.Second,
	}, nil
}

// FromAddress is the envelope sender used for outgoing mail.
func (m *Mailer) FromAddress() string { return m.from.Address }

func validHostname(s string) bool {
	if s == "" || len(s) > 253 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '.'
		if !ok {
			return false
		}
	}
	return true
}

func (m *Mailer) tlsConfig() *tls.Config {
	if m.tls != nil {
		return m.tls.Clone()
	}
	return &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12}
}

// Send delivers msg. It honours ctx cancellation and deadlines.
func (m *Mailer) Send(ctx context.Context, msg Message) error {
	to, err := parseRecipient(msg.To)
	if err != nil {
		return err
	}
	data, err := m.build(msg, to, time.Now())
	if err != nil {
		return err
	}
	c, closeConn, err := m.open(ctx)
	if err != nil {
		return err
	}
	defer closeConn()

	if err := c.Mail(m.from.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(data); err != nil {
		_ = w.Close()
		return fmt.Errorf("smtp write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp end of DATA: %w", err)
	}
	_ = c.Quit()
	return nil
}

// Verify connects, upgrades to TLS and authenticates without sending anything.
func (m *Mailer) Verify(ctx context.Context) error {
	c, closeConn, err := m.open(ctx)
	if err != nil {
		return err
	}
	defer closeConn()
	if err := c.Noop(); err != nil {
		return fmt.Errorf("smtp NOOP: %w", err)
	}
	_ = c.Quit()
	return nil
}

// open returns a client that is connected, encrypted per cfg.TLS and authenticated.
func (m *Mailer) open(ctx context.Context) (*smtp.Client, func(), error) {
	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	dialer := &net.Dialer{Timeout: m.dialTimeout}

	var (
		conn net.Conn
		err  error
	)
	if m.cfg.TLS == TLSImplicit {
		td := tls.Dialer{NetDialer: dialer, Config: m.tlsConfig()}
		conn, err = td.DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("smtp connect %s: %w", addr, err)
	}

	deadline := time.Now().Add(m.opTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	closeConn := func() {
		stop()
		_ = conn.Close()
	}
	fail := func(err error) (*smtp.Client, func(), error) {
		closeConn()
		return nil, nil, err
	}

	c, err := smtp.NewClient(conn, m.cfg.Host)
	if err != nil {
		return fail(fmt.Errorf("smtp greeting: %w", err))
	}
	if err := c.Hello(m.helo); err != nil {
		return fail(fmt.Errorf("smtp EHLO: %w", err))
	}
	if m.cfg.TLS == TLSStartTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return fail(permanent(errors.New("smtp: server does not offer STARTTLS; use SMTP_TLS=tls for port 465, or SMTP_TLS=none only for a trusted local relay")))
		}
		if err := c.StartTLS(m.tlsConfig()); err != nil {
			return fail(fmt.Errorf("smtp STARTTLS: %w", err))
		}
	}
	if m.cfg.Username != "" {
		auth, err := m.authFor(c)
		if err != nil {
			return fail(err)
		}
		if err := c.Auth(auth); err != nil {
			return fail(fmt.Errorf("smtp auth: %w", err))
		}
	}
	return c, closeConn, nil
}

func (m *Mailer) authFor(c *smtp.Client) (smtp.Auth, error) {
	ok, params := c.Extension("AUTH")
	if !ok {
		return nil, permanent(errors.New("smtp: server does not advertise AUTH but SMTP_USERNAME is set"))
	}
	mechs := strings.Fields(strings.ToUpper(params))
	switch {
	case slices.Contains(mechs, "PLAIN"):
		return smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host), nil
	case slices.Contains(mechs, "LOGIN"):
		return &loginAuth{username: m.cfg.Username, password: m.cfg.Password, host: m.cfg.Host}, nil
	}
	return nil, permanent(fmt.Errorf("smtp: no supported AUTH mechanism (server offers %q)", params))
}

// loginAuth implements the legacy AUTH LOGIN some providers still require.
type loginAuth struct{ username, password, host string }

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !isLoopback(server.Name) {
		return "", nil, errors.New("smtp: refusing AUTH LOGIN over an unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, errors.New("smtp: wrong host name")
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(fromServer))) {
	case "username:":
		return []byte(a.username), nil
	case "password:":
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("smtp: unexpected AUTH LOGIN challenge %q", fromServer)
}

type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func permanent(err error) error { return permanentError{err} }

// IsPermanent reports whether retrying the same message cannot succeed:
// SMTP 5xx replies, invalid messages and configuration mismatches.
func IsPermanent(err error) bool {
	var pe permanentError
	if errors.As(err, &pe) || errors.Is(err, ErrInvalidMessage) {
		return true
	}
	var te *textproto.Error
	return errors.As(err, &te) && te.Code >= 500
}

// TestMessage is what `api -send-test-email` sends.
func TestMessage(to string) Message {
	return Message{
		To:      to,
		Kind:    "smtp_test",
		Subject: "Get Hub: проверка почты",
		Text:    "Это тестовое письмо от Get Hub.\nЕсли вы его читаете, отправка почты настроена верно.\n",
	}
}
