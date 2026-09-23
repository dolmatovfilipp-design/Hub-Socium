package sentryx

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
)

// Init configures Sentry from SENTRY_DSN. No-op (returns false) when unset.
func Init() bool {
	dsn := strings.TrimSpace(os.Getenv("SENTRY_DSN"))
	if dsn == "" {
		return false
	}
	env := os.Getenv("SENTRY_ENV")
	if env == "" {
		env = "development"
	}
	opts := sentry.ClientOptions{
		Dsn:              dsn,
		Environment:      env,
		Release:          os.Getenv("SENTRY_RELEASE"),
		SendDefaultPII:   false,
		BeforeSend:       scrubEvent,
		BeforeBreadcrumb: scrubBreadcrumb,
	}
	if err := sentry.Init(opts); err != nil {
		slog.Warn("sentry init failed", "err", err)
		return false
	}
	slog.Info("sentry enabled", "env", env)
	return true
}

// Flush waits briefly for pending events (call on shutdown).
func Flush() {
	sentry.Flush(2 * time.Second)
}

// Middleware attaches the hub to the request context. Safe when Sentry is not initialized.
func Middleware() func(http.Handler) http.Handler {
	return sentryhttp.New(sentryhttp.Options{
		Repanic:         true,
		WaitForDelivery: false,
	}).Handle
}

func scrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	if event.Request != nil {
		scrubHeaders(event.Request.Headers)
		event.Request.Cookies = ""
		event.Request.Data = "" // never attach bodies (may contain passwords)
	}
	if event.User.Email != "" {
		event.User.Email = ""
	}
	if event.Extra != nil {
		event.Extra = scrubMap(event.Extra)
	}
	return event
}

func scrubBreadcrumb(breadcrumb *sentry.Breadcrumb, _ *sentry.BreadcrumbHint) *sentry.Breadcrumb {
	if breadcrumb == nil {
		return nil
	}
	if breadcrumb.Data != nil {
		breadcrumb.Data = scrubMap(breadcrumb.Data)
	}
	return breadcrumb
}

func scrubHeaders(h map[string]string) {
	if h == nil {
		return
	}
	for k := range h {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "cookie" || lk == "set-cookie" {
			h[k] = "[Filtered]"
		}
	}
}

func scrubMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if sensitiveKey(k) {
			out[k] = "[Filtered]"
			continue
		}
		switch t := v.(type) {
		case map[string]any:
			out[k] = scrubMap(t)
		case string:
			if looksLikeJWT(t) {
				out[k] = "[Filtered JWT]"
			} else {
				out[k] = t
			}
		default:
			out[k] = v
		}
	}
	return out
}

func sensitiveKey(k string) bool {
	lk := strings.ToLower(k)
	switch {
	case lk == "authorization", lk == "cookie", lk == "password", lk == "passwd",
		lk == "token", lk == "access_token", lk == "refresh_token", lk == "jwt",
		lk == "email", lk == "phone", lk == "secret", strings.Contains(lk, "password"):
		return true
	default:
		return false
	}
}

func looksLikeJWT(s string) bool {
	return strings.HasPrefix(s, "eyJ") && strings.Count(s, ".") >= 2
}
