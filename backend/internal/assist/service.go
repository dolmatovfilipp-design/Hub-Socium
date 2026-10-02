package assist

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/config"
)

// Service — compose text assist only. NEVER used for feed ranking.
type Service struct {
	cfg config.Config
}

func NewService(cfg config.Config) *Service {
	return &Service{cfg: cfg}
}

func (s *Service) Compose(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "text required")
		return
	}
	if utf8.RuneCountInString(text) > 4000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "text too long")
		return
	}

	hasOpenAI := s.cfg.OpenAIAPIKey != ""
	hasYandex := s.cfg.YandexGPTAPIKey != "" && s.cfg.YandexGPTFolder != ""
	if !hasOpenAI && !hasYandex {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"disabled": true,
			"message":  "Подключите OPENAI_API_KEY или YANDEX_GPT_API_KEY+YANDEX_GPT_FOLDER",
		})
		return
	}

	prompt := "Улучши черновик поста для соцсети на русском: яснее, короче, без кликбейта. Верни только текст поста.\n\n" + text
	var suggestion string
	var err error
	if hasOpenAI {
		suggestion, err = s.callOpenAI(prompt)
	} else {
		suggestion, err = s.callYandexGPT(prompt)
	}
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"suggestion": suggestion})
}

func (s *Service) callOpenAI(prompt string) (string, error) {
	body := map[string]any{
		"model": "gpt-4o-mini",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.4,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.cfg.OpenAIBaseURL, "/")+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenAIAPIKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 45 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", errString("openai " + res.Status + ": " + string(b))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", errString("empty openai response")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func (s *Service) callYandexGPT(prompt string) (string, error) {
	modelURI := "gpt://" + s.cfg.YandexGPTFolder + "/yandexgpt-lite"
	body := map[string]any{
		"modelUri": modelURI,
		"completionOptions": map[string]any{
			"stream":      false,
			"temperature": 0.4,
			"maxTokens":   800,
		},
		"messages": []map[string]string{
			{"role": "user", "text": prompt},
		},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, "https://llm.api.cloud.yandex.net/foundationModels/v1/completion", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Api-Key "+s.cfg.YandexGPTAPIKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 45 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", errString("yandexgpt " + res.Status + ": " + string(b))
	}
	var parsed struct {
		Result struct {
			Alternatives []struct {
				Message struct {
					Text string `json:"text"`
				} `json:"message"`
			} `json:"alternatives"`
		} `json:"result"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Result.Alternatives) == 0 {
		return "", errString("empty yandexgpt response")
	}
	return strings.TrimSpace(parsed.Result.Alternatives[0].Message.Text), nil
}

type errString string

func (e errString) Error() string { return string(e) }
