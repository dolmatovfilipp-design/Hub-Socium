package mailer

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"time"
)

// Message is one outgoing email. Text is required; HTML is optional and sent
// as the preferred alternative when present.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
	// Kind labels the message in logs ("password_reset"); never sent on the wire.
	Kind string
}

// ErrInvalidMessage marks messages that can never be delivered as given.
var ErrInvalidMessage = errors.New("mailer: invalid message")

// parseRecipient accepts exactly one plain ASCII address. Display names and
// address lists are rejected so a user-controlled value cannot add recipients.
func parseRecipient(raw string) (*mail.Address, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.ContainsAny(raw, "\r\n") {
		return nil, fmt.Errorf("%w: bad recipient", ErrInvalidMessage)
	}
	a, err := mail.ParseAddress(raw)
	if err != nil || a.Name != "" || a.Address != raw {
		return nil, fmt.Errorf("%w: bad recipient", ErrInvalidMessage)
	}
	if !isASCII(a.Address) {
		return nil, fmt.Errorf("%w: non-ASCII recipient addresses are not supported", ErrInvalidMessage)
	}
	return a, nil
}

func checkHeaderValue(name, v string) error {
	if strings.ContainsAny(v, "\r\n\x00") {
		return fmt.Errorf("%w: %s contains a line break", ErrInvalidMessage, name)
	}
	return nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("mailer: crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func writeQP(buf *bytes.Buffer, s string) error {
	w := quotedprintable.NewWriter(buf)
	if _, err := w.Write([]byte(s)); err != nil {
		return err
	}
	return w.Close()
}

// build renders msg as an RFC 5322 message with CRLF line endings.
func (m *Mailer) build(msg Message, to *mail.Address, now time.Time) ([]byte, error) {
	if err := checkHeaderValue("subject", msg.Subject); err != nil {
		return nil, err
	}
	if strings.TrimSpace(msg.Text) == "" {
		return nil, fmt.Errorf("%w: empty body", ErrInvalidMessage)
	}

	var b bytes.Buffer
	hdr := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }

	domain := "localhost"
	if i := strings.LastIndexByte(m.from.Address, '@'); i >= 0 {
		domain = m.from.Address[i+1:]
	}
	hdr("From", m.from.String())
	hdr("To", to.Address)
	hdr("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	hdr("Date", now.UTC().Format(time.RFC1123Z))
	hdr("Message-ID", "<"+randomHex(16)+"@"+domain+">")
	hdr("MIME-Version", "1.0")
	hdr("Auto-Submitted", "auto-generated")

	text := strings.ReplaceAll(msg.Text, "\r\n", "\n")
	if msg.HTML == "" {
		hdr("Content-Type", "text/plain; charset=UTF-8")
		hdr("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := writeQP(&b, text); err != nil {
			return nil, err
		}
		return b.Bytes(), nil
	}

	boundary := "hub-" + randomHex(12)
	hdr("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	part := func(ctype, body string) error {
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		hdr("Content-Type", ctype+"; charset=UTF-8")
		hdr("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := writeQP(&b, strings.ReplaceAll(body, "\r\n", "\n")); err != nil {
			return err
		}
		b.WriteString("\r\n")
		return nil
	}
	if err := part("text/plain", text); err != nil {
		return nil, err
	}
	if err := part("text/html", msg.HTML); err != nil {
		return nil, err
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

// MaskEmail hides most of the local part for logs: "ф***@example.com".
func MaskEmail(addr string) string {
	at := strings.LastIndexByte(addr, '@')
	if at <= 0 {
		return "***"
	}
	r := []rune(addr[:at])
	return string(r[:1]) + "***" + addr[at:]
}
