// Package mailer sends transactional email over SMTP using only the standard library.
package mailer

import (
	"fmt"
	"net"
	"net/mail"
	"os"
	"strconv"
	"strings"
)

// TLS modes for the SMTP connection.
const (
	// TLSStartTLS connects in plaintext and requires the STARTTLS upgrade (typically port 587).
	TLSStartTLS = "starttls"
	// TLSImplicit speaks TLS from the first byte, a.k.a. SMTPS (typically port 465).
	TLSImplicit = "tls"
	// TLSNone is unencrypted; only for loopback relays and local dev sinks.
	TLSNone = "none"
)

// Config holds SMTP settings. The zero value (empty Host) means email is disabled.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	// From is the sender, either a bare address or `Name <addr>`.
	From string
	TLS  string
}

// Enabled reports whether SMTP is configured.
func (c Config) Enabled() bool { return c.Host != "" }

// FromAddress returns the parsed sender; valid only after Validate succeeds.
func (c Config) FromAddress() (*mail.Address, error) {
	return mail.ParseAddress(c.From)
}

// ConfigFromEnv reads SMTP_* variables. get is usually os.Getenv.
//
// Defaults are chosen to be secure: unless SMTP_TLS says otherwise, the
// connection must be upgraded with STARTTLS, except on the SMTPS port 465
// where TLS is implicit. Unencrypted delivery needs an explicit SMTP_TLS=none.
func ConfigFromEnv(get func(string) string) (Config, error) {
	if get == nil {
		get = os.Getenv
	}
	c := Config{
		Host:     strings.TrimSpace(get("SMTP_HOST")),
		Username: strings.TrimSpace(get("SMTP_USERNAME")),
		Password: strings.TrimRight(get("SMTP_PASSWORD"), "\r\n"),
		From:     strings.TrimSpace(get("SMTP_FROM")),
	}
	rawPort := strings.TrimSpace(get("SMTP_PORT"))
	rawTLS := strings.TrimSpace(get("SMTP_TLS"))

	if c.Host == "" {
		for _, kv := range [][2]string{
			{"SMTP_USERNAME", c.Username}, {"SMTP_PASSWORD", c.Password}, {"SMTP_FROM", c.From},
			{"SMTP_PORT", rawPort}, {"SMTP_TLS", rawTLS},
		} {
			if kv[1] != "" {
				return Config{}, fmt.Errorf("%s is set but SMTP_HOST is empty", kv[0])
			}
		}
		return Config{}, nil
	}

	if rawPort != "" {
		p, err := strconv.Atoi(rawPort)
		if err != nil || p < 1 || p > 65535 {
			return Config{}, fmt.Errorf("SMTP_PORT must be a number in 1..65535 (got %q)", rawPort)
		}
		c.Port = p
	}
	if rawTLS != "" {
		mode, err := ParseTLSMode(rawTLS)
		if err != nil {
			return Config{}, err
		}
		c.TLS = mode
	}
	if c.TLS == "" {
		if c.Port == 465 {
			c.TLS = TLSImplicit
		} else {
			c.TLS = TLSStartTLS
		}
	}
	if c.Port == 0 {
		switch c.TLS {
		case TLSImplicit:
			c.Port = 465
		case TLSNone:
			c.Port = 25
		default:
			c.Port = 587
		}
	}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// ParseTLSMode normalises SMTP_TLS values.
func ParseTLSMode(s string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "starttls":
		return TLSStartTLS, nil
	case "tls", "ssl", "smtps":
		return TLSImplicit, nil
	case "none", "off", "plain":
		return TLSNone, nil
	}
	return "", fmt.Errorf("SMTP_TLS must be one of starttls, tls, none (got %q)", s)
}

// Validate checks an enabled configuration. A disabled one is always valid.
func (c Config) Validate() error {
	if !c.Enabled() {
		return nil
	}
	if strings.ContainsAny(c.Host, " \t/\\@") || (strings.Contains(c.Host, ":") && net.ParseIP(c.Host) == nil) {
		return fmt.Errorf("SMTP_HOST must be a bare hostname or IP without scheme or port (got %q)", c.Host)
	}
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("SMTP_PORT must be in 1..65535 (got %d)", c.Port)
	}
	switch c.TLS {
	case TLSStartTLS, TLSImplicit, TLSNone:
	default:
		return fmt.Errorf("SMTP_TLS must be one of starttls, tls, none (got %q)", c.TLS)
	}
	if c.From == "" {
		return fmt.Errorf("SMTP_FROM is required when SMTP_HOST is set (e.g. \"Get Hub <no-reply@example.com>\")")
	}
	from, err := mail.ParseAddress(c.From)
	if err != nil {
		return fmt.Errorf("SMTP_FROM is not a valid address: %w", err)
	}
	if !isASCII(from.Address) {
		return fmt.Errorf("SMTP_FROM address must be ASCII (got %q)", from.Address)
	}
	if (c.Username == "") != (c.Password == "") {
		return fmt.Errorf("SMTP_USERNAME and SMTP_PASSWORD must be set together")
	}
	if c.TLS == TLSNone && c.Username != "" && !isLoopback(c.Host) {
		return fmt.Errorf("refusing to send SMTP credentials to %q without TLS: use SMTP_TLS=starttls or tls", c.Host)
	}
	return nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}
