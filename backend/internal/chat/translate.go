package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

type translatorKind int

const (
	trNone translatorKind = iota
	trLibre
	trOpenAI
	trYandex
	trMyMemory
)

// myMemoryEndpoint is the keyless fallback. Tests may override it.
var myMemoryEndpoint = "https://api.mymemory.translated.net/get"

func (c SpeechConfig) translator() translatorKind {
	if strings.TrimSpace(c.TranslateURL) != "" {
		return trLibre
	}
	if strings.TrimSpace(c.OpenAIKey) != "" {
		return trOpenAI
	}
	if strings.TrimSpace(c.YandexKey) != "" && strings.TrimSpace(c.YandexFolder) != "" {
		return trYandex
	}
	if c.AllowFallback {
		return trMyMemory
	}
	return trNone
}

// TranslateMessage translates a chat message into the requested language and caches the result.
func (s *Service) TranslateMessage(w http.ResponseWriter, r *http.Request) {
	_, convID, msgID, ok := s.memberMessage(w, r)
	if !ok {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	target, okLang := normalizeLang(req.Target)
	if !okLang {
		target = "ru"
	}
	if s.speech.translator() == trNone {
		apiutil.Error(w, http.StatusServiceUnavailable, "unavailable", "Перевод не настроен")
		return
	}
	body, _, msgType, err := s.loadMessage(r.Context(), convID, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "message not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать сообщение")
		return
	}
	sourceText := strings.TrimSpace(body)
	if msgType == "voice" || msgType == "video_note" {
		var trText, trStatus string
		err = s.pool.QueryRow(r.Context(), `
			SELECT text, status FROM message_transcripts WHERE message_id=$1::uuid`, msgID).
			Scan(&trText, &trStatus)
		if err != nil || trStatus != "done" || strings.TrimSpace(trText) == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Сначала расшифруйте сообщение")
			return
		}
		sourceText = strings.TrimSpace(trText)
	}
	if sourceText == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нечего переводить")
		return
	}
	if utf8.RuneCountInString(sourceText) > 4000 {
		sourceText = string([]rune(sourceText)[:4000])
	}
	hash := bodyHash(sourceText)
	var cached, sourceLang, provider string
	err = s.pool.QueryRow(r.Context(), `
		SELECT text, source_lang, provider FROM message_translations
		WHERE message_id=$1::uuid AND target_lang=$2 AND body_hash=$3`, msgID, target, hash).
		Scan(&cached, &sourceLang, &provider)
	if err == nil && strings.TrimSpace(cached) != "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"text":     cached,
			"source":   sourceLang,
			"provider": provider,
		})
		return
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать перевод")
		return
	}
	out, detected, provider, trErr := s.translateText(r.Context(), sourceText, target)
	if trErr != nil {
		msg := trErr.Error()
		if msg == "" {
			msg = "Не удалось перевести"
		}
		apiutil.Error(w, http.StatusBadGateway, "upstream", msg)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		INSERT INTO message_translations (message_id, target_lang, body_hash, text, source_lang, provider)
		VALUES ($1::uuid, $2, $3, $4, $5, $6)
		ON CONFLICT (message_id, target_lang, body_hash) DO UPDATE SET
		  text=EXCLUDED.text, source_lang=EXCLUDED.source_lang, provider=EXCLUDED.provider`,
		msgID, target, hash, out, detected, provider)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"text":     out,
		"source":   detected,
		"provider": provider,
	})
}

func (s *Service) translateText(ctx context.Context, text, target string) (out, source, provider string, err error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", "", "", fmt.Errorf("Нечего переводить")
	}
	switch s.speech.translator() {
	case trLibre:
		return s.libreTranslate(ctx, text, target)
	case trOpenAI:
		return s.llmTranslate(ctx, text, target, "openai")
	case trYandex:
		return s.llmTranslate(ctx, text, target, "yandex")
	case trMyMemory:
		src := guessLang(text)
		dst := target
		if src == dst {
			dst = otherLang(dst)
		}
		out, err = myMemoryTranslate(ctx, s.httpClient(), text, src, dst)
		if err != nil {
			return "", "", "", fmt.Errorf("Не удалось перевести")
		}
		return out, src, "mymemory", nil
	default:
		return "", "", "", fmt.Errorf("Перевод не настроен")
	}
}

func (s *Service) libreTranslate(ctx context.Context, text, target string) (string, string, string, error) {
	out, detected, err := s.libreOnce(ctx, text, "auto", target)
	if err != nil {
		return "", "", "", fmt.Errorf("Не удалось перевести")
	}
	if detected == "" {
		detected = guessLang(text)
	}
	if detected == target {
		alt := otherLang(target)
		altOut, _, altErr := s.libreOnce(ctx, text, detected, alt)
		if altErr == nil && strings.TrimSpace(altOut) != "" {
			return altOut, detected, "libretranslate", nil
		}
	}
	return out, detected, "libretranslate", nil
}

func (s *Service) libreOnce(ctx context.Context, text, source, target string) (string, string, error) {
	payload := map[string]any{
		"q":      text,
		"source": source,
		"target": target,
		"format": "text",
	}
	if s.speech.TranslateKey != "" {
		payload["api_key"] = s.speech.TranslateKey
	}
	raw, _ := json.Marshal(payload)
	endpoint := strings.TrimRight(s.speech.TranslateURL, "/") + "/translate"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := s.httpClient().Do(req)
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", "", fmt.Errorf("libre %d", res.StatusCode)
	}
	var parsed struct {
		TranslatedText   string          `json:"translatedText"`
		DetectedLanguage json.RawMessage `json:"detectedLanguage"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", "", err
	}
	out := strings.TrimSpace(parsed.TranslatedText)
	if out == "" {
		return "", "", fmt.Errorf("empty translation")
	}
	return out, detectedLang(parsed.DetectedLanguage), nil
}

func (s *Service) llmTranslate(ctx context.Context, text, target, kind string) (string, string, string, error) {
	prompt := "Translate the message into language \"" + target + "\". " +
		"Detect the source language. Reply with JSON only: {\"source\":\"xx\",\"text\":\"...\"}. " +
		"source is ISO 639-1. If the message is already in the target language, translate it into " +
		otherLang(target) + " instead. No commentary.\n\n" + text
	var raw string
	var err error
	provider := kind
	if kind == "openai" {
		raw, err = s.openAIComplete(ctx, prompt)
	} else {
		raw, err = s.yandexComplete(ctx, prompt)
		provider = "yandex"
	}
	if err != nil {
		return "", "", "", fmt.Errorf("Не удалось перевести")
	}
	raw = extractJSONObject(raw)
	var parsed struct {
		Source string `json:"source"`
		Text   string `json:"text"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil || strings.TrimSpace(parsed.Text) == "" {
		return "", "", "", fmt.Errorf("Не удалось перевести")
	}
	src, ok := normalizeLang(parsed.Source)
	if !ok {
		src = guessLang(text)
	}
	return strings.TrimSpace(parsed.Text), src, provider, nil
}

func (s *Service) openAIComplete(ctx context.Context, prompt string) (string, error) {
	body := map[string]any{
		"model": "gpt-4o-mini",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.speech.OpenAIBase, "/")+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.speech.OpenAIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.httpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("openai %d", res.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", fmt.Errorf("empty openai")
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func (s *Service) yandexComplete(ctx context.Context, prompt string) (string, error) {
	body := map[string]any{
		"modelUri": "gpt://" + s.speech.YandexFolder + "/yandexgpt-lite",
		"completionOptions": map[string]any{
			"stream":      false,
			"temperature": 0.2,
			"maxTokens":   2000,
		},
		"messages": []map[string]string{
			{"role": "user", "text": prompt},
		},
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://llm.api.cloud.yandex.net/foundationModels/v1/completion", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Api-Key "+s.speech.YandexKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.httpClient().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("yandex %d", res.StatusCode)
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
	if err := json.Unmarshal(b, &parsed); err != nil || len(parsed.Result.Alternatives) == 0 {
		return "", fmt.Errorf("empty yandex")
	}
	return strings.TrimSpace(parsed.Result.Alternatives[0].Message.Text), nil
}

func myMemoryTranslate(ctx context.Context, client *http.Client, text, source, target string) (string, error) {
	parts := splitRunes(text, 400)
	var b strings.Builder
	for i, part := range parts {
		out, err := myMemoryOne(ctx, client, part, source, target)
		if err != nil {
			return "", err
		}
		if i > 0 && b.Len() > 0 && out != "" {
			b.WriteByte(' ')
		}
		b.WriteString(out)
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "", fmt.Errorf("empty")
	}
	return out, nil
}

func myMemoryOne(ctx context.Context, client *http.Client, text, source, target string) (string, error) {
	q := url.Values{}
	q.Set("q", text)
	q.Set("langpair", source+"|"+target)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, myMemoryEndpoint+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("mymemory %d", res.StatusCode)
	}
	var parsed struct {
		ResponseData struct {
			TranslatedText string `json:"translatedText"`
		} `json:"responseData"`
		ResponseStatus int `json:"responseStatus"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return "", err
	}
	out := strings.TrimSpace(parsed.ResponseData.TranslatedText)
	if parsed.ResponseStatus >= 400 || out == "" || strings.Contains(strings.ToUpper(out), "MYMEMORY WARNING") {
		return "", fmt.Errorf("mymemory rejected")
	}
	return out, nil
}

func detectedLang(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var asString string
	if json.Unmarshal(raw, &asString) == nil {
		if lang, ok := normalizeLang(asString); ok {
			return lang
		}
	}
	var obj struct {
		Language string `json:"language"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		if lang, ok := normalizeLang(obj.Language); ok {
			return lang
		}
	}
	return ""
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = s[:i]
		}
		s = strings.TrimSpace(s)
	}
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start >= 0 && end > start {
		return s[start : end+1]
	}
	return s
}

func normalizeLang(s string) (string, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return "", false
	}
	primary := s
	if i := strings.IndexAny(s, "-_"); i > 0 {
		primary = s[:i]
	}
	if len(primary) != 2 {
		return "", false
	}
	if primary[0] < 'a' || primary[0] > 'z' || primary[1] < 'a' || primary[1] > 'z' {
		return "", false
	}
	return primary, true
}

func guessLang(text string) string {
	var cyr, lat int
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cyr++
		case unicode.Is(unicode.Latin, r):
			lat++
		}
	}
	if cyr > lat {
		return "ru"
	}
	if lat > 0 {
		return "en"
	}
	return "ru"
}

func otherLang(lang string) string {
	if lang == "en" {
		return "ru"
	}
	return "en"
}

func bodyHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

func splitRunes(text string, n int) []string {
	if n < 1 {
		n = 400
	}
	rs := []rune(text)
	if len(rs) <= n {
		return []string{text}
	}
	var parts []string
	for len(rs) > 0 {
		take := n
		if take > len(rs) {
			take = len(rs)
		}
		parts = append(parts, string(rs[:take]))
		rs = rs[take:]
	}
	return parts
}
