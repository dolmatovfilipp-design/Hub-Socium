package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := apiutil.WithRequestID(r.Context(), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &wrapWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		rid, _ := apiutil.RequestIDFromContext(r.Context())
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.status,
			"dur_ms", time.Since(start).Milliseconds(),
			"request_id", rid,
		)
		// Capture intentional 5xx once (panics are handled in Recoverer; skip 4xx).
		if ww.status >= 500 && !ww.panicRecovered {
			hub := sentry.GetHubFromContext(r.Context())
			if hub == nil {
				hub = sentry.CurrentHub()
			}
			if hub != nil && hub.Client() != nil {
				hub.WithScope(func(scope *sentry.Scope) {
					scope.SetTag("http.status_code", http.StatusText(ww.status))
					scope.SetExtra("status", ww.status)
					scope.SetExtra("path", r.URL.Path)
					scope.SetExtra("method", r.Method)
					scope.SetExtra("request_id", rid)
					hub.CaptureMessage("http_5xx")
				})
			}
		}
	})
}

type wrapWriter struct {
	http.ResponseWriter
	status         int
	panicRecovered bool
}

func (w *wrapWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if ww, ok := w.(*wrapWriter); ok {
					ww.panicRecovered = true
				}
				hub := sentry.GetHubFromContext(r.Context())
				if hub == nil {
					hub = sentry.CurrentHub()
				}
				if hub != nil && hub.Client() != nil {
					hub.RecoverWithContext(r.Context(), rec)
				}
				slog.Error("panic", "err", rec)
				http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
