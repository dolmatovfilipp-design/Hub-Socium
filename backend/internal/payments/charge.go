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
)

// Redirect is a YooKassa payment waiting for the buyer.
type Redirect struct {
	ID  string
	URL string
}

// KeysSet reports whether a shop can create real charges.
func KeysSet(shopID, secret string) bool {
	return strings.TrimSpace(shopID) != "" && strings.TrimSpace(secret) != ""
}

// RubString formats kopeks as a YooKassa amount value.
func RubString(amountMinor int) string {
	if amountMinor < 0 {
		amountMinor = 0
	}
	return fmt.Sprintf("%d.%02d", amountMinor/100, amountMinor%100)
}

// CreateRedirect starts a captured redirect payment. Callers must check KeysSet first.
func CreateRedirect(shopID, secret string, amountMinor int, description, returnURL string, meta map[string]string) (Redirect, error) {
	if !KeysSet(shopID, secret) {
		return Redirect{}, fmt.Errorf("payments: not configured")
	}
	if amountMinor < 100 {
		return Redirect{}, fmt.Errorf("amount below 1 RUB")
	}
	description = strings.TrimSpace(description)
	if description == "" {
		description = "Оплата Get Hub"
	}
	if len([]rune(description)) > 128 {
		description = string([]rune(description)[:128])
	}
	returnURL = strings.TrimSpace(returnURL)
	if returnURL == "" {
		returnURL = "https://gethub.online/app"
	}
	payload := map[string]any{
		"amount": map[string]string{
			"value":    RubString(amountMinor),
			"currency": "RUB",
		},
		"confirmation": map[string]string{
			"type":       "redirect",
			"return_url": returnURL,
		},
		"capture":     true,
		"description": description,
	}
	if len(meta) > 0 {
		payload["metadata"] = meta
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, "https://api.yookassa.ru/v3/payments", bytes.NewReader(raw))
	if err != nil {
		return Redirect{}, err
	}
	req.SetBasicAuth(strings.TrimSpace(shopID), strings.TrimSpace(secret))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotence-Key", uuid.NewString())
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return Redirect{}, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return Redirect{}, fmt.Errorf("yookassa %s: %s", res.Status, string(b))
	}
	var parsed struct {
		ID           string `json:"id"`
		Confirmation struct {
			ConfirmationURL string `json:"confirmation_url"`
		} `json:"confirmation"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return Redirect{}, err
	}
	if parsed.ID == "" || parsed.Confirmation.ConfirmationURL == "" {
		return Redirect{}, fmt.Errorf("yookassa: empty confirmation")
	}
	return Redirect{ID: parsed.ID, URL: parsed.Confirmation.ConfirmationURL}, nil
}

// PaymentStatus returns the YooKassa status string (pending, waiting_for_capture, succeeded, canceled).
func PaymentStatus(shopID, secret, paymentID string) (string, error) {
	if !KeysSet(shopID, secret) {
		return "", fmt.Errorf("payments: not configured")
	}
	paymentID = strings.TrimSpace(paymentID)
	if paymentID == "" {
		return "", fmt.Errorf("payment id required")
	}
	req, err := http.NewRequest(http.MethodGet, "https://api.yookassa.ru/v3/payments/"+paymentID, nil)
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(strings.TrimSpace(shopID), strings.TrimSpace(secret))
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("yookassa %s: %s", res.Status, string(b))
	}
	var parsed struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", err
	}
	return parsed.Status, nil
}
