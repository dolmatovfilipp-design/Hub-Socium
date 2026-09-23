package push

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/notifprefs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles Web Push subscription storage and optional send (VAPID).
type Service struct {
	pool       *pgxpool.Pool
	publicKey  string
	privateKey string
	subject    string
}

func NewService(pool *pgxpool.Pool, publicKey, privateKey, subject string) *Service {
	return &Service{
		pool:       pool,
		publicKey:  strings.TrimSpace(publicKey),
		privateKey: strings.TrimSpace(privateKey),
		subject:    strings.TrimSpace(subject),
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.publicKey != "" && s.privateKey != ""
}

// Subscribe POST /v1/me/push — upsert subscription JSON.
func (s *Service) Subscribe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Endpoint       string `json:"endpoint"`
		ExpirationTime *int64 `json:"expirationTime"`
		Keys           struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	endpoint := strings.TrimSpace(req.Endpoint)
	p256dh := strings.TrimSpace(req.Keys.P256dh)
	auth := strings.TrimSpace(req.Keys.Auth)
	if endpoint == "" || p256dh == "" || auth == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "endpoint, keys.p256dh, keys.auth required")
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1::uuid, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE
		SET user_id = EXCLUDED.user_id,
		    p256dh = EXCLUDED.p256dh,
		    auth = EXCLUDED.auth`, uid, endpoint, p256dh, auth)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "subscribe failed")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "endpoint": endpoint})
}

// Unsubscribe DELETE /v1/me/push — body { "endpoint": "..." }.
func (s *Service) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "endpoint required")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		DELETE FROM push_subscriptions
		WHERE user_id = $1::uuid AND endpoint = $2`, uid, endpoint)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "unsubscribe failed")
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "subscription not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
	// Type maps to notification_prefs (like|reply|follow|mention|message). Empty = skip pref gate.
	Type string `json:"type,omitempty"`
	// Optional context for quiet-hours favorites bypass (T11).
	FromUserID     string `json:"-"`
	ConversationID string `json:"-"`
}

// NotifyUser sends one Web Push per subscription. Skips honestly if VAPID missing.
// Respects S10 prefs: muted types + quiet hours (Europe/Moscow). Digest batching is deferred.
func (s *Service) NotifyUser(ctx context.Context, userID string, payload Payload) {
	if s == nil {
		return
	}
	if payload.Type != "" {
		if !notifprefs.AllowPushEx(ctx, s.pool, userID, payload.Type, payload.FromUserID, payload.ConversationID) {
			return
		}
	} else {
		if !notifprefs.AllowPushEx(ctx, s.pool, userID, "", payload.FromUserID, payload.ConversationID) {
			return
		}
	}
	if !s.Enabled() {
		slog.Info("push skip: нужен VAPID", "user_id", userID, "title", payload.Title)
		return
	}
	rows, err := s.pool.Query(ctx, `
		SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1::uuid`, userID)
	if err != nil {
		slog.Warn("push list failed", "err", err)
		return
	}
	defer rows.Close()

	body, _ := json.Marshal(payload)
	subject := s.subject
	if subject == "" {
		subject = "mailto:ops@hub.local"
	}

	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}
		sub := &webpush.Subscription{
			Endpoint: endpoint,
			Keys: webpush.Keys{
				P256dh: p256dh,
				Auth:   auth,
			},
		}
		resp, err := webpush.SendNotificationWithContext(ctx, body, sub, &webpush.Options{
			Subscriber:      subject,
			VAPIDPublicKey:  s.publicKey,
			VAPIDPrivateKey: s.privateKey,
			TTL:             60,
		})
		if err != nil {
			slog.Warn("push send failed", "err", err, "endpoint", truncate(endpoint, 48))
			continue
		}
		if resp != nil {
			status := resp.StatusCode
			_ = resp.Body.Close()
			if status == http.StatusGone || status == http.StatusNotFound {
				_, _ = s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
			}
		}
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
