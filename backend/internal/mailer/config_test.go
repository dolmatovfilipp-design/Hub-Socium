package mailer

import (
	"strings"
	"testing"
)

func env(kv map[string]string) func(string) string {
	return func(k string) string { return kv[k] }
}

func TestConfigFromEnv(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		want    Config
		wantErr string
	}{
		{name: "disabled when empty", env: map[string]string{}, want: Config{}},
		{
			name: "starttls on 587 by default",
			env:  map[string]string{"SMTP_HOST": "smtp.example.com", "SMTP_FROM": "no-reply@example.com"},
			want: Config{Host: "smtp.example.com", Port: 587, TLS: TLSStartTLS, From: "no-reply@example.com"},
		},
		{
			name: "port 465 implies implicit TLS",
			env:  map[string]string{"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "465", "SMTP_FROM": "no-reply@example.com", "SMTP_USERNAME": "u", "SMTP_PASSWORD": "p"},
			want: Config{Host: "smtp.example.com", Port: 465, TLS: TLSImplicit, From: "no-reply@example.com", Username: "u", Password: "p"},
		},
		{
			name: "ssl alias and default port",
			env:  map[string]string{"SMTP_HOST": "smtp.example.com", "SMTP_TLS": "SSL", "SMTP_FROM": "no-reply@example.com"},
			want: Config{Host: "smtp.example.com", Port: 465, TLS: TLSImplicit, From: "no-reply@example.com"},
		},
		{
			name: "none is explicit and defaults to port 25",
			env:  map[string]string{"SMTP_HOST": "localhost", "SMTP_TLS": "none", "SMTP_FROM": "Get Hub <hub@example.com>"},
			want: Config{Host: "localhost", Port: 25, TLS: TLSNone, From: "Get Hub <hub@example.com>"},
		},
		{
			name: "mailpit style local sink",
			env:  map[string]string{"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "1025", "SMTP_TLS": "none", "SMTP_FROM": "hub@example.com"},
			want: Config{Host: "127.0.0.1", Port: 1025, TLS: TLSNone, From: "hub@example.com"},
		},
		{
			name: "password keeps inner spaces, loses trailing newline",
			env:  map[string]string{"SMTP_HOST": "smtp.example.com", "SMTP_FROM": "a@example.com", "SMTP_USERNAME": "u", "SMTP_PASSWORD": "p w\n"},
			want: Config{Host: "smtp.example.com", Port: 587, TLS: TLSStartTLS, From: "a@example.com", Username: "u", Password: "p w"},
		},
		{name: "port not a number", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_PORT": "abc", "SMTP_FROM": "a@example.com"}, wantErr: "SMTP_PORT"},
		{name: "port out of range", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_PORT": "70000", "SMTP_FROM": "a@example.com"}, wantErr: "SMTP_PORT"},
		{name: "unknown tls mode", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_TLS": "maybe", "SMTP_FROM": "a@example.com"}, wantErr: "SMTP_TLS"},
		{name: "from required", env: map[string]string{"SMTP_HOST": "h.example.com"}, wantErr: "SMTP_FROM"},
		{name: "from must parse", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_FROM": "not an address"}, wantErr: "SMTP_FROM"},
		{name: "from must be ascii", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_FROM": "имя@example.com"}, wantErr: "ASCII"},
		{name: "host must not be a URL", env: map[string]string{"SMTP_HOST": "smtp://h.example.com", "SMTP_FROM": "a@example.com"}, wantErr: "SMTP_HOST"},
		{name: "host must not include port", env: map[string]string{"SMTP_HOST": "h.example.com:587", "SMTP_FROM": "a@example.com"}, wantErr: "SMTP_HOST"},
		{name: "username without password", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_FROM": "a@example.com", "SMTP_USERNAME": "u"}, wantErr: "together"},
		{name: "password without username", env: map[string]string{"SMTP_HOST": "h.example.com", "SMTP_FROM": "a@example.com", "SMTP_PASSWORD": "p"}, wantErr: "together"},
		{
			name:    "credentials never go out unencrypted to a remote host",
			env:     map[string]string{"SMTP_HOST": "smtp.example.com", "SMTP_TLS": "none", "SMTP_FROM": "a@example.com", "SMTP_USERNAME": "u", "SMTP_PASSWORD": "p"},
			wantErr: "without TLS",
		},
		{
			name: "credentials over loopback without TLS are fine",
			env:  map[string]string{"SMTP_HOST": "127.0.0.1", "SMTP_TLS": "none", "SMTP_FROM": "a@example.com", "SMTP_USERNAME": "u", "SMTP_PASSWORD": "p"},
			want: Config{Host: "127.0.0.1", Port: 25, TLS: TLSNone, From: "a@example.com", Username: "u", Password: "p"},
		},
		{name: "stray vars without host fail fast", env: map[string]string{"SMTP_FROM": "a@example.com"}, wantErr: "SMTP_FROM is set but SMTP_HOST is empty"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ConfigFromEnv(env(tc.env))
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got  %+v\nwant %+v", got, tc.want)
			}
			if got.Enabled() != (tc.want.Host != "") {
				t.Fatal("Enabled mismatch")
			}
		})
	}
}
