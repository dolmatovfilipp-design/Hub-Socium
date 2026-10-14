package chat

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/payments"
)

const payOffMessage = "Оплата не подключена. Задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY"

func (s *Service) isBusiness(r *http.Request, uid string) bool {
	var on bool
	_ = s.pool.QueryRow(r.Context(), `SELECT COALESCE(business_mode,false) FROM users WHERE id=$1::uuid`, uid).Scan(&on)
	return on
}

func (s *Service) returnURL(r *http.Request) string {
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if strings.HasPrefix(origin, "http://") || strings.HasPrefix(origin, "https://") {
		return origin + "/app"
	}
	return "https://gethub.online/app"
}

// GenerateSticker builds a sticker from a text description.
// OpenAI images when OPENAI_API_KEY is set; otherwise a sticker drawn from the text LLM.
func (s *Service) GenerateSticker(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Prompt         string `json:"prompt"`
		ConversationID string `json:"conversation_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" || utf8.RuneCountInString(prompt) > 300 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "prompt 1..300")
		return
	}
	if !s.liveAI() {
		aiDisabled(w, aiOffMessage)
		return
	}
	convID := strings.TrimSpace(req.ConversationID)
	if convID != "" && !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	var raw []byte
	var contentType, ext, provider string
	if strings.TrimSpace(s.speech.OpenAIKey) != "" {
		png, err := s.openAIImage(r.Context(), prompt)
		if err != nil {
			apiutil.Error(w, http.StatusBadGateway, "upstream", "не удалось сгенерировать стикер")
			return
		}
		raw, contentType, ext, provider = png, "image/png", ".png", "openai"
	} else {
		line, err := s.completePrompt(r.Context(), "Стикер для мессенджера. Ответь одной строкой: эмодзи | подпись до 18 символов | цвет hex. Тема: "+prompt)
		if err != nil {
			apiutil.Error(w, http.StatusBadGateway, "upstream", "не удалось сгенерировать стикер")
			return
		}
		emoji, caption, color := parseStickerLine(line, prompt)
		raw, contentType, ext, provider = buildStickerSVG(emoji, caption, color), "image/svg+xml", ".svg", "llm"
	}
	if s.blobs == nil {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "хранилище медиа недоступно")
		return
	}
	url, err := s.blobs.StoreBytes(r.Context(), uid, contentType, ext, raw)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить стикер")
		return
	}
	out := map[string]any{"media_url": url, "provider": provider}
	if convID != "" {
		msgID, created, err := s.insertChatMessage(r.Context(), convID, uid, "Стикер", url, "sticker", map[string]any{"prompt": prompt})
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось отправить стикер")
			return
		}
		out["message_id"] = msgID
		out["created_at"] = created.UTC().Format(time.RFC3339Nano)
	}
	apiutil.JSON(w, http.StatusCreated, out)
}

// CreateOrder posts an order card into a seller chat.
func (s *Service) CreateOrder(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	if !s.isBusiness(r, uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "заказ может создать продавец")
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	var req struct {
		Title       string `json:"title"`
		AmountMinor int    `json:"amount_minor"`
		BuyerID     string `json:"buyer_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || utf8.RuneCountInString(title) > 120 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1..120")
		return
	}
	if req.AmountMinor < 100 || req.AmountMinor > 100_000_000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "сумма от 1 ₽ до 1 000 000 ₽")
		return
	}
	buyer := strings.TrimSpace(req.BuyerID)
	if buyer == "" || buyer == uid {
		_ = s.pool.QueryRow(r.Context(), `
			SELECT user_id::text FROM conversation_members
			WHERE conversation_id=$1::uuid AND user_id<>$2::uuid
			ORDER BY joined_at ASC LIMIT 1`, convID, uid).Scan(&buyer)
	}
	if buyer == "" || buyer == uid || !s.isMember(r, buyer, convID) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "укажите покупателя из чата")
		return
	}
	orderID := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO chat_orders (id, conversation_id, seller_id, buyer_id, title, amount_minor)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)
		RETURNING created_at`, orderID, convID, uid, buyer, title, req.AmountMinor).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось создать заказ")
		return
	}
	meta := map[string]any{
		"kind": "order", "order_id": orderID.String(), "title": title,
		"amount_minor": req.AmountMinor, "currency": "RUB", "status": "pending",
	}
	msgID, _, err := s.insertChatMessage(r.Context(), convID, uid, title, "", "text", meta)
	if err == nil {
		_, _ = s.pool.Exec(r.Context(), `UPDATE chat_orders SET message_id=$2::uuid WHERE id=$1`, orderID, msgID)
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": orderID.String(), "title": title, "amount_minor": req.AmountMinor,
		"currency": "RUB", "status": "pending", "buyer_id": buyer,
		"message_id": msgID, "created_at": created.UTC().Format(time.RFC3339Nano),
		"payments": s.paymentsOn(),
	})
}

func (s *Service) loadOrder(r *http.Request, orderID string) (convID, seller, buyer, title, status, payID, payURL string, amount int, err error) {
	err = s.pool.QueryRow(r.Context(), `
		SELECT conversation_id::text, seller_id::text, buyer_id::text, title, amount_minor,
		       status, provider_payment_id, confirmation_url
		FROM chat_orders WHERE id=$1::uuid`, orderID).
		Scan(&convID, &seller, &buyer, &title, &amount, &status, &payID, &payURL)
	return
}

func (s *Service) markOrderPaid(ctx context.Context, orderID string) string {
	_, _ = s.pool.Exec(ctx, `
		UPDATE chat_orders SET status='paid', paid_at=now() WHERE id=$1::uuid AND status='pending'`, orderID)
	_, _ = s.pool.Exec(ctx, `
		UPDATE messages
		SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{status}', '"paid"'::jsonb, true)
		WHERE id = (SELECT message_id FROM chat_orders WHERE id=$1::uuid)`, orderID)
	return "paid"
}

// overlayOrderStatus copies the live order row onto the chat card so a paid
// order does not stay "pending" on the bubble after YooKassa confirms it.
func (s *Service) overlayOrderStatus(ctx context.Context, convID string, items []map[string]any) {
	ids := make([]string, 0)
	for _, it := range items {
		meta, ok := it["meta"].(map[string]any)
		if !ok || meta["kind"] != "order" {
			continue
		}
		if id, ok := meta["order_id"].(string); ok && id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || s.pool == nil {
		return
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, status FROM chat_orders
		WHERE conversation_id=$1::uuid AND id::text = ANY($2::text[])`, convID, ids)
	if err != nil {
		return
	}
	defer rows.Close()
	status := map[string]string{}
	for rows.Next() {
		var id, st string
		if rows.Scan(&id, &st) == nil {
			status[id] = st
		}
	}
	for _, it := range items {
		meta, ok := it["meta"].(map[string]any)
		if !ok {
			continue
		}
		id, _ := meta["order_id"].(string)
		if st := status[id]; st != "" {
			meta["status"] = st
		}
	}
}

func (s *Service) orderJSON(id, title, status, payURL string, amount int, payments bool) map[string]any {
	return map[string]any{
		"id": id, "title": title, "amount_minor": amount, "currency": "RUB",
		"status": status, "confirmation_url": payURL, "payments": payments,
	}
}

// GetOrder returns the order and refreshes a pending YooKassa status.
func (s *Service) GetOrder(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	orderID := chi.URLParam(r, "id")
	convID, seller, buyer, title, status, payID, payURL, amount, err := s.loadOrder(r, orderID)
	if err != nil || !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "order not found")
		return
	}
	if status == "pending" && payID != "" && s.paymentsOn() {
		if st, stErr := payments.PaymentStatus(s.payShop, s.paySecret, payID); stErr == nil && st == "succeeded" {
			status = s.markOrderPaid(r.Context(), orderID)
		}
	}
	if !s.paymentsOn() && status != "paid" {
		out := s.orderJSON(orderID, title, status, "", amount, false)
		out["disabled"] = true
		out["message"] = payOffMessage
		_ = seller
		_ = buyer
		apiutil.JSON(w, http.StatusOK, out)
		return
	}
	apiutil.JSON(w, http.StatusOK, s.orderJSON(orderID, title, status, payURL, amount, s.paymentsOn()))
}

// PayOrder starts a YooKassa payment for the buyer.
func (s *Service) PayOrder(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	orderID := chi.URLParam(r, "id")
	convID, _, buyer, title, status, _, payURL, amount, err := s.loadOrder(r, orderID)
	if err != nil || !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "order not found")
		return
	}
	if uid != buyer {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "оплачивает покупатель")
		return
	}
	if status == "paid" {
		apiutil.JSON(w, http.StatusOK, s.orderJSON(orderID, title, status, payURL, amount, s.paymentsOn()))
		return
	}
	if !s.paymentsOn() {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", payOffMessage)
		return
	}
	redir, err := payments.CreateRedirect(s.payShop, s.paySecret, amount, title, s.returnURL(r), map[string]string{
		"source":   "chat_order",
		"order_id": orderID,
	})
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "ЮKassa не приняла платёж")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE chat_orders SET provider_payment_id=$2, confirmation_url=$3 WHERE id=$1::uuid`,
		orderID, redir.ID, redir.URL)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"id": orderID, "status": "pending", "confirmation_url": redir.URL, "payment_id": redir.ID,
	})
}

// SellerDraft asks the LLM for a reply the seller can approve.
func (s *Service) SellerDraft(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	if !s.isBusiness(r, uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "черновик доступен продавцу")
		return
	}
	if !s.liveAI() {
		aiDisabled(w, aiOffMessage)
		return
	}
	lines, err := s.recentLines(r.Context(), convID, 16)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать чат")
		return
	}
	script := transcriptOf(lines)
	if strings.TrimSpace(script) == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "в чате нет вопросов")
		return
	}
	prompt := "Ты помощник продавца. Напиши один короткий ответ покупателю по переписке. Без выдуманных цен и обещаний, которых нет в тексте. Только текст ответа.\n\n" + script
	body, err := s.completePrompt(r.Context(), prompt)
	if err != nil || strings.TrimSpace(body) == "" {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "не удалось подготовить ответ")
		return
	}
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(body) > 1000 {
		body = string([]rune(body)[:1000])
	}
	var source any
	if n := len(lines); n > 0 {
		source = lines[n-1].ID
	}
	var id string
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO seller_reply_drafts (conversation_id, seller_id, source_message_id, body)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
		RETURNING id::text`, convID, uid, source, body).Scan(&id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить черновик")
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{"id": id, "body": body, "status": "pending"})
}

func (s *Service) draftOwned(r *http.Request, draftID, uid string) (convID, body, status string, err error) {
	err = s.pool.QueryRow(r.Context(), `
		SELECT conversation_id::text, body, status
		FROM seller_reply_drafts
		WHERE id=$1::uuid AND seller_id=$2::uuid`, draftID, uid).Scan(&convID, &body, &status)
	return
}

// ApproveSellerDraft sends the draft as a normal message.
func (s *Service) ApproveSellerDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	draftID := chi.URLParam(r, "id")
	convID, body, status, err := s.draftOwned(r, draftID, uid)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "draft not found")
		return
	}
	if status != "pending" {
		apiutil.Error(w, http.StatusConflict, "conflict", "черновик уже закрыт")
		return
	}
	msgID, created, err := s.insertChatMessage(r.Context(), convID, uid, body, "", "text", nil)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось отправить")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `UPDATE seller_reply_drafts SET status='sent' WHERE id=$1::uuid`, draftID)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "message_id": msgID, "body": body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

// DismissSellerDraft drops a draft without sending it.
func (s *Service) DismissSellerDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	draftID := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE seller_reply_drafts SET status='dismissed'
		WHERE id=$1::uuid AND seller_id=$2::uuid AND status='pending'`, draftID, uid)
	if err != nil || tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "draft not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func parseStickerLine(line, fallback string) (emoji, caption, color string) {
	parts := strings.Split(line, "|")
	emoji, caption, color = "✨", fallback, "#2c2c2e"
	if len(parts) > 0 {
		if e := strings.TrimSpace(parts[0]); e != "" && utf8.RuneCountInString(e) <= 4 {
			emoji = e
		}
	}
	if len(parts) > 1 {
		c := strings.TrimSpace(parts[1])
		if c != "" {
			caption = c
		}
	}
	if utf8.RuneCountInString(caption) > 18 {
		caption = string([]rune(caption)[:18])
	}
	if len(parts) > 2 {
		c := strings.TrimSpace(parts[2])
		if len(c) == 7 && strings.HasPrefix(c, "#") {
			color = c
		}
	}
	return emoji, caption, color
}

func buildStickerSVG(emoji, caption, color string) []byte {
	esc := func(s string) string {
		s = strings.ReplaceAll(s, "&", "&amp;")
		s = strings.ReplaceAll(s, "<", "&lt;")
		s = strings.ReplaceAll(s, ">", "&gt;")
		return s
	}
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
		`<rect width="512" height="512" rx="96" fill="` + esc(color) + `"/>` +
		`<text x="256" y="250" text-anchor="middle" font-size="180">` + esc(emoji) + `</text>` +
		`<text x="256" y="400" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="36">` + esc(caption) + `</text>` +
		`</svg>`
	return []byte(svg)
}
