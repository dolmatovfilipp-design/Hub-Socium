package payments

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/config"
)

type Service struct {
	cfg config.Config
}

func NewService(cfg config.Config) *Service {
	return &Service{cfg: cfg}
}

// DemoCheckout POST /v1/payments/yookassa/demo — sandbox only, clear demo copy.
func (s *Service) DemoCheckout(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		AmountRub   float64 `json:"amount_rub"`
		Description string  `json:"description"`
		ReturnURL   string  `json:"return_url"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.AmountRub < 1 {
		req.AmountRub = 100
	}
	if strings.TrimSpace(req.Description) == "" {
		req.Description = "Hub демо-оплата (sandbox)"
	}
	if strings.TrimSpace(req.ReturnURL) == "" {
		req.ReturnURL = "https://example.com/return"
	}

	if s.cfg.YooKassaShopID == "" || s.cfg.YooKassaSecretKey == "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"demo":    true,
			"message": "Демо-оплата: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY (тестовые ключи). Реального списания нет.",
		})
		return
	}

	payload := map[string]any{
		"amount": map[string]any{
			"value":    fmt.Sprintf("%.2f", req.AmountRub),
			"currency": "RUB",
		},
		"confirmation": map[string]any{
			"type":       "redirect",
			"return_url": req.ReturnURL,
		},
		"capture":     true,
		"description": "[DEMO] " + req.Description,
		"metadata": map[string]any{
			"hub_demo": true,
		},
	}
	raw, _ := json.Marshal(payload)
	httpReq, err := http.NewRequest(http.MethodPost, "https://api.yookassa.ru/v3/payments", bytes.NewReader(raw))
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	httpReq.SetBasicAuth(s.cfg.YooKassaShopID, s.cfg.YooKassaSecretKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Idempotence-Key", uuid.NewString())
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(httpReq)
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", err.Error())
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"ok":      false,
			"demo":    true,
			"message": "ЮKassa sandbox: " + string(b),
		})
		return
	}
	var parsed struct {
		ID           string `json:"id"`
		Confirmation struct {
			ConfirmationURL string `json:"confirmation_url"`
		} `json:"confirmation"`
	}
	_ = json.Unmarshal(b, &parsed)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"demo":             true,
		"payment_id":       parsed.ID,
		"confirmation_url": parsed.Confirmation.ConfirmationURL,
		"message":          "Демо-оплата ЮKassa (тестовый режим)",
	})
}
