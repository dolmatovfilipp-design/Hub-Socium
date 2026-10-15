package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// ChatBackground is the stored wallpaper for an account or one conversation.
// Kind "wallpaper" points at a manifest id (and optional /wallpapers file).
// Kind "custom" points at an uploaded /v1/media object. Kind "none" is flat black.
// Ids are not a fixed catalog: any manifest entry the client ships is valid.
type ChatBackground struct {
	Kind string `json:"kind"`
	ID   string `json:"id,omitempty"`
	URL  string `json:"url,omitempty"`
	Blur int    `json:"blur"`
	Dim  int    `json:"dim"`
}

const (
	bgBlurMax = 24
	bgDimMax  = 75
)

var (
	errBackgroundKind = errors.New("chat_background.kind: none|wallpaper|custom")
	errBackgroundID   = errors.New("chat_background id is not allowed")
	errBackgroundURL  = errors.New("chat_background url is not allowed")

	backgroundIDRe    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,64}$`)
	wallpaperURLRe    = regexp.MustCompile(`^/wallpapers/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$`)
	mediaURLRe        = regexp.MustCompile(`^/v1/media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	allowedAccents    = map[string]bool{"graphite": true, "blue": true, "violet": true, "pink": true, "orange": true, "green": true}
	allowedFontScales = map[string]bool{"sm": true, "md": true, "lg": true}
	allowedThemes     = map[string]bool{
		"default": true, "ocean": true, "sunset": true, "forest": true, "violet": true,
		"cream": true, "sand": true, "peach": true, "honey": true, "terracotta": true,
		"rose": true, "latte": true, "amber": true, "warm-gray": true, "ivory": true,
	}
)

func clampInt(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// NormalizeBackground clamps blur/dim and accepts any safe wallpaper id.
// Callers omit the pointer on partial updates; a value is validated here.
func NormalizeBackground(in ChatBackground) (ChatBackground, error) {
	out := ChatBackground{
		Kind: in.Kind,
		Blur: clampInt(in.Blur, 0, bgBlurMax),
		Dim:  clampInt(in.Dim, 0, bgDimMax),
	}
	switch in.Kind {
	case "none", "":
		out.Kind = "none"
		out.Blur = 0
		out.Dim = 0
		return out, nil
	case "wallpaper":
		id := in.ID
		if id == "" && wallpaperURLRe.MatchString(in.URL) {
			id = wallpaperStem(in.URL)
		}
		if !backgroundIDRe.MatchString(id) {
			return ChatBackground{}, errBackgroundID
		}
		out.ID = id
		if in.URL != "" {
			if !wallpaperURLRe.MatchString(in.URL) {
				return ChatBackground{}, errBackgroundURL
			}
			out.URL = in.URL
		}
		return out, nil
	case "custom":
		if !mediaURLRe.MatchString(in.URL) {
			return ChatBackground{}, errBackgroundURL
		}
		out.URL = in.URL
		return out, nil
	default:
		return ChatBackground{}, errBackgroundKind
	}
}

func wallpaperStem(url string) string {
	i := len(url) - 1
	for i >= 0 && url[i] != '/' {
		i--
	}
	base := url[i+1:]
	dot := -1
	for j := len(base) - 1; j >= 0; j-- {
		if base[j] == '.' {
			dot = j
			break
		}
	}
	if dot > 0 {
		return base[:dot]
	}
	return base
}

func normalizeAccent(v string) (string, error) {
	if v == "" || !allowedAccents[v] {
		return "", errors.New("unknown accent")
	}
	return v, nil
}

func normalizeFontScale(v string) (string, error) {
	if v == "" || !allowedFontScales[v] {
		return "", errors.New("font_scale: sm|md|lg")
	}
	return v, nil
}

func normalizeAppearance(v string) (string, error) {
	if v != "dark" && v != "light" && v != "system" {
		return "", errors.New("appearance: dark|light|system")
	}
	return v, nil
}

func normalizeThemeID(v string) (string, error) {
	if v == "" || !allowedThemes[v] {
		return "", errors.New("unknown theme")
	}
	return v, nil
}

func themeCatalog() []map[string]any {
	return []map[string]any{
		{"id": "default", "name": "Классика", "gradient": []string{"#000000", "#1c1c1e"}},
		{"id": "ocean", "name": "Океан", "gradient": []string{"#0a1628", "#1a4a6e"}},
		{"id": "sunset", "name": "Закат", "gradient": []string{"#1a0a0a", "#6e2a1a"}},
		{"id": "forest", "name": "Лес", "gradient": []string{"#0a1a0e", "#1a4a2e"}},
		{"id": "violet", "name": "Фиолет", "gradient": []string{"#120a1a", "#3a1a6e"}},
		{"id": "cream", "name": "Кремовый", "gradient": []string{"#fff7e6", "#ead7b7"}},
		{"id": "sand", "name": "Песочный", "gradient": []string{"#e7d3b5", "#b8956a"}},
		{"id": "peach", "name": "Персиковый", "gradient": []string{"#ffd1b8", "#e9967a"}},
		{"id": "honey", "name": "Медовый", "gradient": []string{"#ffe08a", "#d59b2b"}},
		{"id": "terracotta", "name": "Терракотовый", "gradient": []string{"#d98268", "#8f4536"}},
		{"id": "rose", "name": "Розовый", "gradient": []string{"#f2b6c6", "#b96782"}},
		{"id": "latte", "name": "Латте", "gradient": []string{"#d8b08c", "#8c6748"}},
		{"id": "amber", "name": "Янтарный", "gradient": []string{"#f6c453", "#b56b12"}},
		{"id": "warm-gray", "name": "Тёплый серый", "gradient": []string{"#d9d1ca", "#8f8781"}},
		{"id": "ivory", "name": "Слоновая кость", "gradient": []string{"#fffff0", "#d8d2b4"}},
	}
}

type storedPrefs struct {
	ThemeID    string
	Appearance string
	Accent     string
	FontScale  string
	Background ChatBackground
}

func defaultPrefs() storedPrefs {
	return storedPrefs{
		ThemeID:    "default",
		Appearance: "dark",
		Accent:     "graphite",
		FontScale:  "md",
		Background: ChatBackground{Kind: "none"},
	}
}

func (s *Service) readPrefs(ctx context.Context, uid string) storedPrefs {
	prefs := defaultPrefs()
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT theme_id, appearance, accent, font_scale, chat_background
		FROM user_chat_prefs WHERE user_id=$1::uuid`, uid).Scan(
		&prefs.ThemeID, &prefs.Appearance, &prefs.Accent, &prefs.FontScale, &raw)
	if err != nil {
		return defaultPrefs()
	}
	if len(raw) > 0 {
		var bg ChatBackground
		if json.Unmarshal(raw, &bg) == nil {
			if normalized, nerr := NormalizeBackground(bg); nerr == nil {
				prefs.Background = normalized
			}
		}
	}
	if prefs.Accent == "" {
		prefs.Accent = "graphite"
	}
	if prefs.FontScale == "" {
		prefs.FontScale = "md"
	}
	if prefs.Appearance == "" {
		prefs.Appearance = "dark"
	}
	if prefs.ThemeID == "" {
		prefs.ThemeID = "default"
	}
	return prefs
}

func (prefs storedPrefs) json() map[string]any {
	return map[string]any{
		"ok":              true,
		"theme_id":        prefs.ThemeID,
		"appearance":      prefs.Appearance,
		"accent":          prefs.Accent,
		"font_scale":      prefs.FontScale,
		"chat_background": prefs.Background,
		"themes":          themeCatalog(),
	}
}

func (s *Service) writePrefs(ctx context.Context, uid string, theme, appearance, accent, font *string, bg *ChatBackground) error {
	var bgVal any
	if bg != nil {
		raw, err := json.Marshal(bg)
		if err != nil {
			return err
		}
		bgVal = string(raw)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_chat_prefs (user_id, theme_id, appearance, accent, font_scale, chat_background, updated_at)
		VALUES (
			$1::uuid,
			COALESCE($2, 'default'),
			COALESCE($3, 'dark'),
			COALESCE($4, 'graphite'),
			COALESCE($5, 'md'),
			COALESCE($6::jsonb, '{"kind":"none"}'::jsonb),
			now()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			theme_id = COALESCE($2, user_chat_prefs.theme_id),
			appearance = COALESCE($3, user_chat_prefs.appearance),
			accent = COALESCE($4, user_chat_prefs.accent),
			font_scale = COALESCE($5, user_chat_prefs.font_scale),
			chat_background = COALESCE($6::jsonb, user_chat_prefs.chat_background),
			updated_at = now()`,
		uid, theme, appearance, accent, font, bgVal)
	return err
}

// GetChatPrefs GET /v1/me/chat-prefs
func (s *Service) GetChatPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	apiutil.JSON(w, http.StatusOK, s.readPrefs(r.Context(), uid).json())
}

// UpdateChatPrefs PUT /v1/me/chat-prefs
// Omitted fields stay as they are, so older clients that only send theme_id
// and appearance do not wipe accent, font size, or the chat background.
func (s *Service) UpdateChatPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		ThemeID        *string         `json:"theme_id"`
		Appearance     *string         `json:"appearance"`
		Accent         *string         `json:"accent"`
		FontScale      *string         `json:"font_scale"`
		ChatBackground *ChatBackground `json:"chat_background"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.ThemeID != nil {
		v, err := normalizeThemeID(*req.ThemeID)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		req.ThemeID = &v
	}
	if req.Appearance != nil {
		v, err := normalizeAppearance(*req.Appearance)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		req.Appearance = &v
	}
	if req.Accent != nil {
		v, err := normalizeAccent(*req.Accent)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		req.Accent = &v
	}
	if req.FontScale != nil {
		v, err := normalizeFontScale(*req.FontScale)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		req.FontScale = &v
	}
	if req.ChatBackground != nil {
		v, err := NormalizeBackground(*req.ChatBackground)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		req.ChatBackground = &v
	}
	if err := s.writePrefs(r.Context(), uid, req.ThemeID, req.Appearance, req.Accent, req.FontScale, req.ChatBackground); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, s.readPrefs(r.Context(), uid).json())
}

// GetConversationBackground GET /v1/conversations/{id}/background
// inherit=true means the conversation uses the account-wide background.
func (s *Service) GetConversationBackground(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	var raw []byte
	err := s.pool.QueryRow(r.Context(), `
		SELECT chat_background FROM conversation_members
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid).Scan(&raw)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	if len(raw) == 0 {
		apiutil.JSON(w, http.StatusOK, map[string]any{"inherit": true})
		return
	}
	var bg ChatBackground
	if json.Unmarshal(raw, &bg) != nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"inherit": true})
		return
	}
	normalized, err := NormalizeBackground(bg)
	if err != nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"inherit": true})
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"inherit": false, "chat_background": normalized})
}

// PutConversationBackground PUT /v1/conversations/{id}/background
// {"inherit": true} clears the override. Otherwise send chat_background.
func (s *Service) PutConversationBackground(w http.ResponseWriter, r *http.Request) {
	uid, convID, ok := s.requireMember(w, r)
	if !ok {
		return
	}
	var req struct {
		Inherit        *bool           `json:"inherit"`
		ChatBackground *ChatBackground `json:"chat_background"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	var bgVal any
	if req.Inherit != nil && *req.Inherit {
		bgVal = nil
	} else if req.ChatBackground != nil {
		normalized, err := NormalizeBackground(*req.ChatBackground)
		if err != nil {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
			return
		}
		raw, err := json.Marshal(normalized)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		bgVal = string(raw)
	} else {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "inherit or chat_background required")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE conversation_members SET chat_background=$3::jsonb
		WHERE conversation_id=$1::uuid AND user_id=$2::uuid`, convID, uid, bgVal)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "conversation not found")
		return
	}
	if bgVal == nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "inherit": true})
		return
	}
	var stored ChatBackground
	_ = json.Unmarshal([]byte(bgVal.(string)), &stored)
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "inherit": false, "chat_background": stored})
}
