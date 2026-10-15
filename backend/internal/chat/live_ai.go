package chat

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/jackc/pgx/v5"
)

const aiOffMessage = "AI не подключён. Задайте OPENAI_API_KEY или YANDEX_GPT_API_KEY и YANDEX_GPT_FOLDER"
const translateOffMessage = "Перевод не подключён. Задайте TRANSLATE_URL или ключ LLM (OPENAI_API_KEY / YANDEX_GPT_API_KEY+YANDEX_GPT_FOLDER)"

// SetCommerce wires YooKassa and the media store used by stickers and orders.
func (s *Service) SetCommerce(shopID, secret string, blobs *media.Service) {
	if s == nil {
		return
	}
	s.payShop = strings.TrimSpace(shopID)
	s.paySecret = strings.TrimSpace(secret)
	s.blobs = blobs
}

func (s *Service) liveAI() bool {
	if s == nil {
		return false
	}
	if strings.TrimSpace(s.speech.OpenAIKey) != "" {
		return true
	}
	return strings.TrimSpace(s.speech.YandexKey) != "" && strings.TrimSpace(s.speech.YandexFolder) != ""
}

func (s *Service) liveTranslate() bool {
	if s == nil {
		return false
	}
	return strings.TrimSpace(s.speech.TranslateURL) != "" || s.liveAI()
}

func (s *Service) paymentsOn() bool {
	return s != nil && s.payShop != "" && s.paySecret != ""
}

func (s *Service) completePrompt(ctx context.Context, prompt string) (string, error) {
	if strings.TrimSpace(s.speech.OpenAIKey) != "" {
		return s.openAIComplete(ctx, prompt)
	}
	if strings.TrimSpace(s.speech.YandexKey) != "" && strings.TrimSpace(s.speech.YandexFolder) != "" {
		return s.yandexComplete(ctx, prompt)
	}
	return "", errors.New("ai disabled")
}

func aiDisabled(w http.ResponseWriter, message string) {
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"disabled": true,
		"message":  message,
	})
}

func (s *Service) requireMember(w http.ResponseWriter, r *http.Request) (uid, convID string, ok bool) {
	uid, ok = apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return "", "", false
	}
	convID = chi.URLParam(r, "id")
	if !s.isMember(r, uid, convID) {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return "", "", false
	}
	return uid, convID, true
}

type chatLine struct {
	ID       string
	SenderID string
	Body     string
	MsgType  string
	Created  time.Time
}

func (s *Service) recentLines(ctx context.Context, convID string, limit int) ([]chatLine, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, sender_id::text, body, COALESCE(msg_type,'text'), created_at
		FROM messages
		WHERE conversation_id=$1::uuid AND deleted_at IS NULL
		  AND thread_root_id IS NULL
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY created_at DESC
		LIMIT $2`, convID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	raw := make([]chatLine, 0)
	for rows.Next() {
		var line chatLine
		if err := rows.Scan(&line.ID, &line.SenderID, &line.Body, &line.MsgType, &line.Created); err != nil {
			return nil, err
		}
		raw = append(raw, line)
	}
	for i, j := 0, len(raw)-1; i < j; i, j = i+1, j-1 {
		raw[i], raw[j] = raw[j], raw[i]
	}
	return raw, nil
}

func transcriptOf(lines []chatLine) string {
	var b strings.Builder
	for _, line := range lines {
		body := strings.TrimSpace(line.Body)
		if body == "" || line.MsgType == "call" {
			continue
		}
		if utf8.RuneCountInString(body) > 400 {
			body = string([]rune(body)[:400])
		}
		b.WriteString(line.Created.UTC().Format("15:04"))
		b.WriteString(" ")
		b.WriteString(line.SenderID[:8])
		b.WriteString(": ")
		b.WriteString(body)
		b.WriteByte('\n')
	}
	return b.String()
}

// CatchUp summarizes messages the member has not caught up with.
func (s *Service) CatchUp(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	if !s.liveAI() {
		aiDisabled(w, aiOffMessage)
		return
	}
	var lastRead *time.Time
	_ = s.pool.QueryRow(r.Context(), `
		SELECT last_read_at FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&lastRead)
	lines, err := s.recentLines(r.Context(), convID, 40)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать чат")
		return
	}
	missed := lines
	if lastRead != nil {
		filtered := make([]chatLine, 0, len(lines))
		for _, line := range lines {
			if line.Created.After(*lastRead) && line.SenderID != uid {
				filtered = append(filtered, line)
			}
		}
		if len(filtered) > 0 {
			missed = filtered
		}
	}
	script := transcriptOf(missed)
	if strings.TrimSpace(script) == "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"summary": "Новых сообщений нет.",
			"count":   0,
		})
		return
	}
	prompt := "Кратко перескажи, что человек пропустил в чате. Только факты из переписки, 3–6 коротких предложений на русском. Без приветствия.\n\n" + script
	text, err := s.completePrompt(r.Context(), prompt)
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "не удалось сделать пересказ")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"summary": strings.TrimSpace(text),
		"count":   len(missed),
	})
}

// ReplySuggestions returns up to three short replies for the latest context.
func (s *Service) ReplySuggestions(w http.ResponseWriter, r *http.Request) {
	_, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	if !s.liveAI() {
		aiDisabled(w, aiOffMessage)
		return
	}
	lines, err := s.recentLines(r.Context(), convID, 12)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать чат")
		return
	}
	script := transcriptOf(lines)
	if strings.TrimSpace(script) == "" {
		apiutil.JSON(w, http.StatusOK, map[string]any{"suggestions": []string{}})
		return
	}
	prompt := "Предложи 3 коротких ответа на последнее сообщение в чате. Каждая строка — один ответ до 80 символов, без нумерации и кавычек. Язык как в переписке.\n\n" + script
	text, err := s.completePrompt(r.Context(), prompt)
	if err != nil {
		apiutil.Error(w, http.StatusBadGateway, "upstream", "не удалось предложить ответы")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"suggestions": parseReplyLines(text)})
}

func parseReplyLines(raw string) []string {
	out := make([]string, 0, 3)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "-•*0123456789.) ")
		line = strings.Trim(line, `"'«»`)
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if utf8.RuneCountInString(line) > 80 {
			line = string([]rune(line)[:80])
		}
		out = append(out, line)
		if len(out) == 3 {
			break
		}
	}
	return out
}

// GetTranslatePref returns the member's auto-translate switch.
func (s *Service) GetTranslatePref(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	var enabled bool
	var lang string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(auto_translate,false), COALESCE(translate_lang,'')
		FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&enabled, &lang)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать настройки")
		return
	}
	out := map[string]any{
		"enabled":   enabled,
		"lang":      lang,
		"available": s.liveTranslate(),
	}
	if !s.liveTranslate() {
		out["message"] = translateOffMessage
	}
	apiutil.JSON(w, http.StatusOK, out)
}

// SetTranslatePref stores auto-translate for this chat only.
func (s *Service) SetTranslatePref(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	var req struct {
		Enabled bool   `json:"enabled"`
		Lang    string `json:"lang"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	lang := strings.TrimSpace(req.Lang)
	if lang == "" {
		lang = "ru"
	}
	norm, okLang := normalizeLang(lang)
	if !okLang {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "неизвестный язык")
		return
	}
	if req.Enabled && !s.liveTranslate() {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"disabled": true,
			"enabled":  false,
			"lang":     norm,
			"message":  translateOffMessage,
		})
		return
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members
		SET auto_translate=$3, translate_lang=$4
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid, req.Enabled, norm)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось сохранить")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"enabled": req.Enabled, "lang": norm, "available": s.liveTranslate()})
}

// TranslateRecent translates the latest messages from other people into the member's language.
func (s *Service) TranslateRecent(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	if !s.liveTranslate() {
		aiDisabled(w, translateOffMessage)
		return
	}
	var lang string
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(NULLIF(translate_lang,''), 'ru')
		FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&lang)
	target, okLang := normalizeLang(lang)
	if !okLang {
		target = "ru"
	}
	lines, err := s.recentLines(r.Context(), convID, 20)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "не удалось прочитать чат")
		return
	}
	items := make([]map[string]any, 0)
	for i := len(lines) - 1; i >= 0 && len(items) < 12; i-- {
		line := lines[i]
		if line.SenderID == uid {
			continue
		}
		source := strings.TrimSpace(line.Body)
		if line.MsgType != "" && line.MsgType != "text" {
			continue
		}
		if source == "" {
			continue
		}
		if utf8.RuneCountInString(source) > 4000 {
			source = string([]rune(source)[:4000])
		}
		hash := bodyHash(source)
		var cached string
		err := s.pool.QueryRow(r.Context(), `
			SELECT text FROM message_translations
			WHERE message_id=$1::uuid AND target_lang=$2 AND body_hash=$3`, line.ID, target, hash).Scan(&cached)
		if err == nil && strings.TrimSpace(cached) != "" {
			items = append(items, map[string]any{"message_id": line.ID, "text": cached})
			continue
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		out, detected, provider, trErr := s.translateLive(r.Context(), source, target)
		if trErr != nil || strings.TrimSpace(out) == "" {
			continue
		}
		_, _ = s.pool.Exec(r.Context(), `
			INSERT INTO message_translations (message_id, target_lang, body_hash, text, source_lang, provider)
			VALUES ($1::uuid, $2, $3, $4, $5, $6)
			ON CONFLICT (message_id, target_lang, body_hash) DO UPDATE SET
			  text=EXCLUDED.text, source_lang=EXCLUDED.source_lang, provider=EXCLUDED.provider`,
			line.ID, target, hash, out, detected, provider)
		items = append(items, map[string]any{"message_id": line.ID, "text": out})
	}
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"lang": target, "items": items})
}

func (s *Service) translateLive(ctx context.Context, text, target string) (string, string, string, error) {
	switch {
	case strings.TrimSpace(s.speech.TranslateURL) != "":
		return s.libreTranslate(ctx, text, target)
	case strings.TrimSpace(s.speech.OpenAIKey) != "":
		return s.llmTranslate(ctx, text, target, "openai")
	case strings.TrimSpace(s.speech.YandexKey) != "" && strings.TrimSpace(s.speech.YandexFolder) != "":
		return s.llmTranslate(ctx, text, target, "yandex")
	default:
		return "", "", "", errors.New("translate disabled")
	}
}
