package channels

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/payments"
)

const payOffMessage = "Оплата не подключена. Задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY"

func (s *Service) returnURL(r *http.Request) string {
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if strings.HasPrefix(origin, "http://") || strings.HasPrefix(origin, "https://") {
		return origin + "/app/channels"
	}
	return "https://gethub.online/app/channels"
}

// SetPrice lets the owner change the subscription price.
func (s *Service) SetPrice(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var req struct {
		PriceMinor int `json:"price_minor"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.PriceMinor < 0 || (req.PriceMinor > 0 && req.PriceMinor < 100) || req.PriceMinor > 100_000_000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "цена 0 или от 1 ₽")
		return
	}
	if req.PriceMinor > 0 && !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE channels SET price_minor=$3
		WHERE id=$1::uuid AND owner_id=$2::uuid AND deleted_at IS NULL`, cid, uid, req.PriceMinor)
	if err != nil || tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "цену меняет владелец")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"price_minor": req.PriceMinor,
		"payments":    s.paymentsOn(),
	})
}

// Subscribe starts a YooKassa payment for a paid channel.
func (s *Service) Subscribe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var owner, title string
	var price int
	err := s.pool.QueryRow(r.Context(), `
		SELECT owner_id::text, title, COALESCE(price_minor,0)
		FROM channels WHERE id=$1::uuid AND deleted_at IS NULL`, cid).Scan(&owner, &title, &price)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if owner == uid || price == 0 {
		apiutil.JSON(w, http.StatusOK, map[string]any{"joined": true, "price_minor": price})
		return
	}
	var active bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT status='active' FROM channel_subscriptions
		WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, uid).Scan(&active)
	if active {
		apiutil.JSON(w, http.StatusOK, map[string]any{"status": "active", "price_minor": price})
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	redir, err := payments.CreateRedirect(s.shopID, s.secret, price, "Подписка: "+title, s.returnURL(r), map[string]string{
		"source": "channel_sub", "channel_id": cid, "user_id": uid,
	})
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "ЮKassa не приняла платёж")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO channel_subscriptions (channel_id, user_id, status, provider_payment_id, confirmation_url)
		VALUES ($1::uuid, $2::uuid, 'pending', $3, $4)
		ON CONFLICT (channel_id, user_id) DO UPDATE SET
		  status='pending', provider_payment_id=EXCLUDED.provider_payment_id,
		  confirmation_url=EXCLUDED.confirmation_url, paid_at=NULL`,
		cid, uid, redir.ID, redir.URL)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить подписку")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"status": "pending", "confirmation_url": redir.URL, "payment_id": redir.ID, "price_minor": price,
	})
}

// ConfirmSubscribe checks YooKassa and joins the channel after a successful payment.
func (s *Service) ConfirmSubscribe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	var status, payID string
	err := s.pool.QueryRow(r.Context(), `
		SELECT status, provider_payment_id FROM channel_subscriptions
		WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, uid).Scan(&status, &payID)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "подписка не найдена")
		return
	}
	if status == "active" {
		apiutil.JSON(w, http.StatusOK, map[string]any{"status": "active"})
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	st, err := payments.PaymentStatus(s.shopID, s.secret, payID)
	if err != nil || st != "succeeded" {
		apiutil.JSON(w, http.StatusOK, map[string]any{"status": "pending"})
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE channel_subscriptions SET status='active', paid_at=now()
		WHERE channel_id=$1::uuid AND user_id=$2::uuid`, cid, uid)
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT DO NOTHING`, cid, uid)
	apiutil.JSON(w, http.StatusOK, map[string]any{"status": "active", "joined": true})
}

// UnlockPost starts payment for a paid channel post.
func (s *Service) UnlockPost(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	cid := chi.URLParam(r, "id")
	pid := chi.URLParam(r, "postId")
	var price int
	var title string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(p.price_minor,0), ch.title
		FROM channel_posts p JOIN channels ch ON ch.id = p.channel_id
		WHERE p.id=$1::uuid AND p.channel_id=$2::uuid AND p.deleted_at IS NULL`, pid, cid).Scan(&price, &title)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	if price == 0 {
		apiutil.JSON(w, http.StatusOK, map[string]any{"unlocked": true})
		return
	}
	var paid bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT paid_at IS NOT NULL FROM channel_post_unlocks
		WHERE post_id=$1::uuid AND user_id=$2::uuid`, pid, uid).Scan(&paid)
	if paid {
		apiutil.JSON(w, http.StatusOK, map[string]any{"unlocked": true})
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	redir, err := payments.CreateRedirect(s.shopID, s.secret, price, "Пост в «"+title+"»", s.returnURL(r), map[string]string{
		"source": "channel_post", "post_id": pid, "user_id": uid,
	})
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "ЮKassa не приняла платёж")
		return
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO channel_post_unlocks (post_id, user_id, provider_payment_id, confirmation_url)
		VALUES ($1::uuid, $2::uuid, $3, $4)
		ON CONFLICT (post_id, user_id) DO UPDATE SET
		  provider_payment_id=EXCLUDED.provider_payment_id,
		  confirmation_url=EXCLUDED.confirmation_url`, pid, uid, redir.ID, redir.URL)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить оплату")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"unlocked": false, "confirmation_url": redir.URL, "payment_id": redir.ID, "price_minor": price,
	})
}

// ConfirmUnlock marks a paid post open after YooKassa succeeds.
func (s *Service) ConfirmUnlock(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	pid := chi.URLParam(r, "postId")
	var payID string
	var paid bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT provider_payment_id, paid_at IS NOT NULL
		FROM channel_post_unlocks WHERE post_id=$1::uuid AND user_id=$2::uuid`, pid, uid).Scan(&payID, &paid)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "оплата не найдена")
		return
	}
	if paid {
		apiutil.JSON(w, http.StatusOK, map[string]any{"unlocked": true})
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	st, err := payments.PaymentStatus(s.shopID, s.secret, payID)
	if err != nil || st != "succeeded" {
		apiutil.JSON(w, http.StatusOK, map[string]any{"unlocked": false, "status": "pending"})
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE channel_post_unlocks SET paid_at=now()
		WHERE post_id=$1::uuid AND user_id=$2::uuid`, pid, uid)
	apiutil.JSON(w, http.StatusOK, map[string]any{"unlocked": true})
}
