package mailer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

const (
	testUser = "mailer-user"
	testPass = "s3cret pass"
)

func newTestMailer(t *testing.T, srv *fakeSMTP, tlsMode, user, pass string) *Mailer {
	t.Helper()
	m, err := New(Config{
		Host:     "127.0.0.1",
		Port:     srv.port(),
		Username: user,
		Password: pass,
		From:     "Get Hub <no-reply@hub.test>",
		TLS:      tlsMode,
	})
	if err != nil {
		t.Fatal(err)
	}
	m.opTimeout = 5 * time.Second
	return m
}

func sampleMessage() Message {
	return Message{
		To:      "anna@example.com",
		Kind:    "test",
		Subject: "Код для сброса пароля Get Hub",
		Text:    "Здравствуйте!\nВаш код: 482915\n.\nСтрока после одинокой точки.\n",
		HTML:    "<p>Ваш код: <b>482915</b></p>",
	}
}

func TestSendMessageContent(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{})
	m := newTestMailer(t, srv, TLSNone, "", "")
	if err := m.Send(context.Background(), sampleMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := srv.received()
	if len(got) != 1 {
		t.Fatalf("want 1 message, got %d", len(got))
	}
	g := got[0]
	if g.From != "no-reply@hub.test" || len(g.To) != 1 || g.To[0] != "anna@example.com" {
		t.Fatalf("envelope = %+v", g)
	}

	parsed, err := mail.ReadMessage(strings.NewReader(g.Data))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	subj, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil || subj != sampleMessage().Subject {
		t.Fatalf("subject = %q (%v)", subj, err)
	}
	from, err := parsed.Header.AddressList("From")
	if err != nil || len(from) != 1 || from[0].Name != "Get Hub" || from[0].Address != "no-reply@hub.test" {
		t.Fatalf("from = %+v (%v)", from, err)
	}
	if to := parsed.Header.Get("To"); to != "anna@example.com" {
		t.Fatalf("to = %q", to)
	}
	if _, err := parsed.Header.Date(); err != nil {
		t.Fatalf("date: %v", err)
	}
	if id := parsed.Header.Get("Message-ID"); !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, "@hub.test>") {
		t.Fatalf("message-id = %q", id)
	}
	if parsed.Header.Get("MIME-Version") != "1.0" || parsed.Header.Get("Auto-Submitted") != "auto-generated" {
		t.Fatalf("headers = %v", parsed.Header)
	}

	mt, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/alternative" {
		t.Fatalf("content-type = %q (%v)", mt, err)
	}
	mr := multipart.NewReader(parsed.Body, params["boundary"])
	var kinds []string
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(quotedprintable.NewReader(p))
		if err != nil {
			t.Fatal(err)
		}
		ct, _, _ := mime.ParseMediaType(p.Header.Get("Content-Type"))
		kinds = append(kinds, ct)
		switch ct {
		case "text/plain":
			want := strings.ReplaceAll(sampleMessage().Text, "\n", "\r\n")
			if string(body) != want {
				t.Fatalf("text part =\n%q\nwant\n%q", body, want)
			}
		case "text/html":
			if !strings.Contains(string(body), "<b>482915</b>") {
				t.Fatalf("html part = %q", body)
			}
		}
	}
	if strings.Join(kinds, ",") != "text/plain,text/html" {
		t.Fatalf("parts = %v", kinds)
	}
}

func TestSendPlainTextOnly(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{})
	m := newTestMailer(t, srv, TLSNone, "", "")
	msg := sampleMessage()
	msg.HTML = ""
	if err := m.Send(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	parsed, err := mail.ReadMessage(strings.NewReader(srv.received()[0].Data))
	if err != nil {
		t.Fatal(err)
	}
	if ct := parsed.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestSendStartTLSWithPlainAuth(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	srv := newFakeSMTP(t, &fakeSMTP{
		tlsCfg: serverTLS, offerStartTLS: true, authMechs: []string{"PLAIN", "LOGIN"},
		wantUser: testUser, wantPass: testPass,
	})
	m := newTestMailer(t, srv, TLSStartTLS, testUser, testPass)
	m.tls = clientTLS
	if err := m.Send(context.Background(), sampleMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := srv.received()
	if len(got) != 1 || !got[0].TLS || got[0].User != testUser || got[0].Pass != testPass {
		t.Fatalf("got %+v", got)
	}
}

func TestSendImplicitTLSWithLoginAuth(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	srv := newFakeSMTP(t, &fakeSMTP{
		tlsCfg: serverTLS, implicit: true, authMechs: []string{"LOGIN"},
		wantUser: testUser, wantPass: testPass,
	})
	m := newTestMailer(t, srv, TLSImplicit, testUser, testPass)
	m.tls = clientTLS
	if err := m.Send(context.Background(), sampleMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := srv.received()
	if len(got) != 1 || !got[0].TLS || got[0].User != testUser {
		t.Fatalf("got %+v", got)
	}
}

func TestSendRejectsUntrustedCertificate(t *testing.T) {
	serverTLS, _ := testTLS(t)
	srv := newFakeSMTP(t, &fakeSMTP{tlsCfg: serverTLS, implicit: true})
	m := newTestMailer(t, srv, TLSImplicit, "", "")
	err := m.Send(context.Background(), sampleMessage())
	if err == nil {
		t.Fatal("expected certificate verification error")
	}
	if len(srv.received()) != 0 {
		t.Fatal("message must not be delivered over an untrusted connection")
	}
}

func TestStartTLSRequiredButNotOffered(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{})
	m := newTestMailer(t, srv, TLSStartTLS, "", "")
	err := m.Send(context.Background(), sampleMessage())
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("err = %v", err)
	}
	if !IsPermanent(err) {
		t.Fatal("missing STARTTLS is a configuration error, not transient")
	}
	if len(srv.received()) != 0 {
		t.Fatal("must not silently downgrade to plaintext")
	}
}

func TestAuthFailureIsPermanent(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	srv := newFakeSMTP(t, &fakeSMTP{
		tlsCfg: serverTLS, offerStartTLS: true, authMechs: []string{"PLAIN"},
		wantUser: testUser, wantPass: testPass,
	})
	m := newTestMailer(t, srv, TLSStartTLS, testUser, "wrong-password")
	m.tls = clientTLS
	err := m.Send(context.Background(), sampleMessage())
	if err == nil || !IsPermanent(err) {
		t.Fatalf("err = %v permanent=%v", err, err != nil && IsPermanent(err))
	}
}

func TestServerRepliesClassifyRetryability(t *testing.T) {
	cases := []struct {
		name          string
		srv           *fakeSMTP
		wantPermanent bool
	}{
		{"4xx on MAIL FROM is transient", &fakeSMTP{mailFromReply: "451 4.3.0 try again later"}, false},
		{"5xx on RCPT TO is permanent", &fakeSMTP{rcptReply: "550 5.1.1 no such user"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newFakeSMTP(t, tc.srv)
			m := newTestMailer(t, srv, TLSNone, "", "")
			err := m.Send(context.Background(), sampleMessage())
			if err == nil {
				t.Fatal("expected error")
			}
			var te *textproto.Error
			if !errors.As(err, &te) {
				t.Fatalf("want *textproto.Error in chain, got %T: %v", err, err)
			}
			if IsPermanent(err) != tc.wantPermanent {
				t.Fatalf("IsPermanent = %v, want %v (%v)", IsPermanent(err), tc.wantPermanent, err)
			}
		})
	}
}

func TestSendTimesOutOnHungServer(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{hang: true})
	m := newTestMailer(t, srv, TLSNone, "", "")
	m.opTimeout = 300 * time.Millisecond
	start := time.Now()
	err := m.Send(context.Background(), sampleMessage())
	if err == nil {
		t.Fatal("expected timeout")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("took %v", d)
	}
	if IsPermanent(err) {
		t.Fatal("timeouts are transient")
	}
}

func TestSendHonoursContextCancel(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{hang: true})
	m := newTestMailer(t, srv, TLSNone, "", "")
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()
	start := time.Now()
	if err := m.Send(ctx, sampleMessage()); err == nil {
		t.Fatal("expected error after cancel")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("cancel not honoured promptly: %v", d)
	}
}

func TestVerify(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	srv := newFakeSMTP(t, &fakeSMTP{
		tlsCfg: serverTLS, offerStartTLS: true, authMechs: []string{"PLAIN"},
		wantUser: testUser, wantPass: testPass,
	})
	m := newTestMailer(t, srv, TLSStartTLS, testUser, testPass)
	m.tls = clientTLS
	if err := m.Verify(context.Background()); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if len(srv.received()) != 0 {
		t.Fatal("verify must not send mail")
	}
	bad := newTestMailer(t, srv, TLSStartTLS, testUser, "nope")
	bad.tls = clientTLS
	if err := bad.Verify(context.Background()); err == nil {
		t.Fatal("verify should fail with wrong credentials")
	}
}

func TestRecipientAndHeaderInjectionRejected(t *testing.T) {
	srv := newFakeSMTP(t, &fakeSMTP{})
	m := newTestMailer(t, srv, TLSNone, "", "")

	badRecipients := []string{
		"",
		"victim@example.com\r\nBcc: attacker@example.com",
		"victim@example.com\nBcc: attacker@example.com",
		"Victim <victim@example.com>",
		"a@example.com, b@example.com",
		"not-an-address",
		"имя@example.com",
	}
	for _, to := range badRecipients {
		msg := sampleMessage()
		msg.To = to
		err := m.Send(context.Background(), msg)
		if !errors.Is(err, ErrInvalidMessage) || !IsPermanent(err) {
			t.Errorf("recipient %q: err = %v", to, err)
		}
	}

	msg := sampleMessage()
	msg.Subject = "hi\r\nBcc: attacker@example.com"
	if err := m.Send(context.Background(), msg); !errors.Is(err, ErrInvalidMessage) {
		t.Errorf("subject injection: err = %v", err)
	}
	msg = sampleMessage()
	msg.Text = "  \n"
	if err := m.Send(context.Background(), msg); !errors.Is(err, ErrInvalidMessage) {
		t.Errorf("empty body: err = %v", err)
	}
	if n := len(srv.received()); n != 0 {
		t.Fatalf("%d invalid messages reached the server", n)
	}
}

func TestMaskEmail(t *testing.T) {
	for in, want := range map[string]string{
		"anna@example.com":   "a***@example.com",
		"филипп@example.com": "ф***@example.com",
		"@example.com":       "***",
		"nonsense":           "***",
	} {
		if got := MaskEmail(in); got != want {
			t.Errorf("MaskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNewRequiresValidConfig(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Fatal("disabled config must not build a mailer")
	}
	if _, err := New(Config{Host: "smtp.example.com", Port: 587, TLS: TLSStartTLS}); err == nil {
		t.Fatal("missing SMTP_FROM must be rejected")
	}
}

func ExampleMaskEmail() {
	fmt.Println(MaskEmail("anna@example.com"))
	// Output: a***@example.com
}
