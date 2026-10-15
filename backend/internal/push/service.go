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

type pushSender func(ctx context.Context, message []byte, s *webpush.Subscription, options *webpush.Options) (*http.Response, error)

// Service handles Web Push subscription storage and optional send (VAPID).
type Service struct {
	pool       *pgxpool.Pool
	publicKey  string
	privateKey string
	subject    string
	send       pushSender
}

func NewService(pool *pgxpool.Pool, publicKey, privateKey, subject string) *Service {
	if strings.TrimSpace(subject) == "" {
		subject = "mailto:help@gethub.online"
	}
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
	// Tag collapses repeats on iOS (one ringing call, one preview per chat).
	Tag string `json:"tag,omitempty"`
	// Type maps to notification_prefs (like|reply|follow|mention|message|call).
	// "call" still obeys pause and quiet hours. Empty skips the type toggle.
	Type string `json:"type,omitempty"`
	// Optional context for quiet-hours favorites bypass and mute checks.
	FromUserID     string `json:"-"`
	ConversationID string `json:"-"`
}

// NotifyUser sends one Web Push per subscription. Skips honestly if VAPID missing.
// Respects S10 prefs: muted types + quiet hours (Europe/Moscow). Digest batching is deferred.
func (s *Service) NotifyUser(ctx context.Context, userID string, payload Payload) {
	if s == nil {
		return
	}
	if s.blockedByMute(ctx, userID, payload) {
		return
	}
	if !notifprefs.AllowPushEx(ctx, s.pool, userID, payload.Type, payload.FromUserID, payload.ConversationID) {
		return
	}
	if payload.Tag == "" {
		switch {
		case payload.Type == "call" && payload.ConversationID != "":
			payload.Tag = "call:" + payload.ConversationID
		case payload.ConversationID != "":
			payload.Tag = "chat:" + payload.ConversationID
		case payload.Type == "mention":
			payload.Tag = "mention"
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
		subject = "mailto:help@gethub.online"
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
		send := s.send
		if send == nil {
			send = webpush.SendNotificationWithContext
		}
		resp, err := send(ctx, body, sub, &webpush.Options{
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

// TestNotify POST /v1/me/push/test — send one test notification to the caller's subscriptions.
func (s *Service) TestNotify(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if !s.Enabled() {
		apiutil.Error(w, http.StatusServiceUnavailable, "push_disabled", "нужен VAPID — задайте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY")
		return
	}
	var n int
	_ = s.pool.QueryRow(r.Context(), `SELECT count(*) FROM push_subscriptions WHERE user_id = $1::uuid`, uid).Scan(&n)
	if n == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "нет подписок — включите Push в настройках")
		return
	}
	s.NotifyUser(r.Context(), uid, Payload{
		Title: "Get Hub",
		Body:  "Тестовое уведомление · всё работает",
		URL:   "/app",
	})
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "subscriptions": n})
}

// PublicKey returns the VAPID public key (empty if unset).
func (s *Service) PublicKey() string {
	if s == nil {
		return ""
	}
	return s.publicKey
}

// VAPIDPublic GET /v1/push/vapid — public key for PushManager.subscribe.
func (s *Service) VAPIDPublic(w http.ResponseWriter, r *http.Request) {
	if s == nil || !s.Enabled() {
		apiutil.Error(w, http.StatusServiceUnavailable, "push_disabled", "Push не настроен")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"public_key": s.publicKey})
}

// blockedByMute drops pushes for a muted chat or a muted person.
func (s *Service) blockedByMute(ctx context.Context, userID string, payload Payload) bool {
	if s == nil || s.pool == nil || userID == "" {
		return false
	}
	if payload.ConversationID != "" {
		var muted bool
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM conversation_mutes
			  WHERE user_id=$1::uuid AND conversation_id=$2::uuid
			)`, userID, payload.ConversationID).Scan(&muted)
		if err == nil && muted {
			slog.Info("push skip: chat mute", "user_id", userID, "conv", payload.ConversationID, "type", payload.Type)
			return true
		}
	}
	if payload.FromUserID != "" && payload.FromUserID != userID {
		var muted bool
		err := s.pool.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM mutes WHERE muter_id=$1::uuid AND muted_id=$2::uuid
			)`, userID, payload.FromUserID).Scan(&muted)
		if err == nil && muted {
			slog.Info("push skip: user mute", "user_id", userID, "from", payload.FromUserID, "type", payload.Type)
			return true
		}
	}
	return false
}
