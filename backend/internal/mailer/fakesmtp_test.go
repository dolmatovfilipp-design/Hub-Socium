package mailer

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type capturedMail struct {
	From string
	To   []string
	Data string
	User string
	Pass string
	TLS  bool
}

// fakeSMTP is a tiny SMTP server for tests: EHLO, STARTTLS, AUTH PLAIN/LOGIN,
// MAIL/RCPT/DATA, with knobs to inject failures.
type fakeSMTP struct {
	t        *testing.T
	ln       net.Listener
	tlsCfg   *tls.Config
	implicit bool

	offerStartTLS bool
	authMechs     []string
	authOverPlain bool
	wantUser      string
	wantPass      string

	mailFromReply string // e.g. "451 try later"; empty = 250
	rcptReply     string
	hang          bool

	mu   sync.Mutex
	mail []capturedMail
}

func newFakeSMTP(t *testing.T, f *fakeSMTP) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f.t = t
	f.ln = ln
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go f.handle(c)
		}
	}()
	return f
}

func (f *fakeSMTP) port() int { return f.ln.Addr().(*net.TCPAddr).Port }

func (f *fakeSMTP) received() []capturedMail {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]capturedMail(nil), f.mail...)
}

func (f *fakeSMTP) handle(raw net.Conn) {
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(15 * time.Second))
	var conn net.Conn = raw
	isTLS := false
	if f.implicit {
		conn = tls.Server(raw, f.tlsCfg)
		isTLS = true
	}
	br := bufio.NewReader(conn)
	reply := func(format string, a ...any) { fmt.Fprintf(conn, format+"\r\n", a...) }
	readLine := func() (string, bool) {
		l, err := br.ReadString('\n')
		return strings.TrimRight(l, "\r\n"), err == nil
	}

	reply("220 fake.test ESMTP ready")
	if f.hang {
		time.Sleep(10 * time.Second)
		return
	}
	var cur capturedMail
	for {
		line, ok := readLine()
		if !ok {
			return
		}
		up := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(up, "EHLO"), strings.HasPrefix(up, "HELO"):
			reply("250-fake.test")
			if f.offerStartTLS && !isTLS {
				reply("250-STARTTLS")
			}
			if len(f.authMechs) > 0 && (isTLS || f.authOverPlain) {
				reply("250-AUTH %s", strings.Join(f.authMechs, " "))
			}
			reply("250 8BITMIME")
		case up == "STARTTLS":
			reply("220 ready to start TLS")
			tc := tls.Server(conn, f.tlsCfg)
			if err := tc.Handshake(); err != nil {
				return
			}
			conn = tc
			br = bufio.NewReader(conn)
			isTLS = true
			cur = capturedMail{}
		case strings.HasPrefix(up, "AUTH PLAIN"):
			arg := strings.TrimSpace(line[len("AUTH PLAIN"):])
			if arg == "" {
				reply("334 ")
				arg, _ = readLine()
			}
			dec, _ := base64.StdEncoding.DecodeString(arg)
			parts := strings.Split(string(dec), "\x00")
			if len(parts) != 3 || parts[1] != f.wantUser || parts[2] != f.wantPass {
				reply("535 5.7.8 authentication failed")
				continue
			}
			cur.User, cur.Pass = parts[1], parts[2]
			reply("235 2.7.0 authenticated")
		case up == "AUTH LOGIN":
			reply("334 %s", base64.StdEncoding.EncodeToString([]byte("Username:")))
			u, _ := readLine()
			reply("334 %s", base64.StdEncoding.EncodeToString([]byte("Password:")))
			p, _ := readLine()
			ub, _ := base64.StdEncoding.DecodeString(u)
			pb, _ := base64.StdEncoding.DecodeString(p)
			if string(ub) != f.wantUser || string(pb) != f.wantPass {
				reply("535 5.7.8 authentication failed")
				continue
			}
			cur.User, cur.Pass = string(ub), string(pb)
			reply("235 2.7.0 authenticated")
		case strings.HasPrefix(up, "MAIL FROM:"):
			if f.mailFromReply != "" {
				reply("%s", f.mailFromReply)
				continue
			}
			cur.From = between(line, '<', '>')
			reply("250 ok")
		case strings.HasPrefix(up, "RCPT TO:"):
			if f.rcptReply != "" {
				reply("%s", f.rcptReply)
				continue
			}
			cur.To = append(cur.To, between(line, '<', '>'))
			reply("250 ok")
		case up == "DATA":
			reply("354 end data with <CRLF>.<CRLF>")
			var sb strings.Builder
			for {
				l, ok := readLine()
				if !ok {
					return
				}
				if l == "." {
					break
				}
				if strings.HasPrefix(l, "..") {
					l = l[1:]
				}
				sb.WriteString(l)
				sb.WriteString("\r\n")
			}
			cur.Data = sb.String()
			cur.TLS = isTLS
			f.mu.Lock()
			f.mail = append(f.mail, cur)
			f.mu.Unlock()
			cur = capturedMail{User: cur.User, Pass: cur.Pass}
			reply("250 2.0.0 queued")
		case up == "NOOP":
			reply("250 ok")
		case up == "RSET":
			reply("250 ok")
		case up == "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 command not implemented")
		}
	}
}

func between(s string, open, close byte) string {
	i := strings.IndexByte(s, open)
	j := strings.LastIndexByte(s, close)
	if i < 0 || j <= i {
		return ""
	}
	return s[i+1 : j]
}

// testTLS returns a server config for 127.0.0.1 plus a client config trusting it.
func testTLS(t *testing.T) (server, client *tls.Config) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	server = &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
		MinVersion:   tls.VersionTLS12,
	}
	client = &tls.Config{RootCAs: pool, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12}
	return server, client
}
