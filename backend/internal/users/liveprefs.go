package users

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"golang.org/x/crypto/bcrypt"
)

func (s *Service) GetMessagePrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var policy, words string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(message_policy,'requests'), COALESCE(hidden_words,'')
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&policy, &words)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"message_policy": policy,
		"hidden_words":   words,
	})
}

func (s *Service) UpdateMessagePrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var curPolicy, curWords string
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(message_policy,'requests'), COALESCE(hidden_words,'')
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&curPolicy, &curWords)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	var req struct {
		MessagePolicy *string `json:"message_policy"`
		HiddenWords   *string `json:"hidden_words"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.MessagePolicy != nil {
		switch *req.MessagePolicy {
		case "everyone", "requests", "following", "none":
			curPolicy = *req.MessagePolicy
		default:
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "message_policy: everyone|requests|following|none")
			return
		}
	}
	if req.HiddenWords != nil {
		if utf8.RuneCountInString(*req.HiddenWords) > 2000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "hidden_words too long")
			return
		}
		curWords = *req.HiddenWords
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE users SET message_policy=$2, hidden_words=$3 WHERE id=$1::uuid`, uid, curPolicy, curWords)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "message_policy": curPolicy, "hidden_words": curWords,
	})
}

func (s *Service) ListFeedSignals(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT kind, COALESCE(target_user_id::text,''), COALESCE(post_id::text,'')
		FROM feed_signals WHERE user_id=$1::uuid`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var kind, userID, postID string
		if err := rows.Scan(&kind, &userID, &postID); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{"kind": kind}
		if userID != "" {
			item["user_id"] = userID
		}
		if postID != "" {
			item["post_id"] = postID
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) PutFeedSignal(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Kind   string `json:"kind"`
		UserID string `json:"user_id"`
		PostID string `json:"post_id"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	switch req.Kind {
	case "interest", "hide_author", "restrict":
		if req.UserID == "" || req.UserID == uid {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "user_id required")
			return
		}
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO feed_signals (user_id, kind, target_user_id)
			VALUES ($1::uuid, $2, $3::uuid)
			ON CONFLICT (user_id, kind, target_user_id) WHERE target_user_id IS NOT NULL DO NOTHING`,
			uid, req.Kind, req.UserID)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	case "hide_post":
		if req.PostID == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "post_id required")
			return
		}
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO feed_signals (user_id, kind, post_id)
			VALUES ($1::uuid, 'hide_post', $2::uuid)
			ON CONFLICT (user_id, kind, post_id) WHERE post_id IS NOT NULL DO NOTHING`,
			uid, req.PostID)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	default:
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "kind: interest|hide_author|restrict|hide_post")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) DeleteFeedSignal(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	kind := r.URL.Query().Get("kind")
	userID := r.URL.Query().Get("user_id")
	postID := r.URL.Query().Get("post_id")
	var err error
	if kind == "hide_post" && postID != "" {
		_, err = s.pool.Exec(r.Context(), `
			DELETE FROM feed_signals WHERE user_id=$1::uuid AND kind='hide_post' AND post_id=$2::uuid`, uid, postID)
	} else if userID != "" {
		_, err = s.pool.Exec(r.Context(), `
			DELETE FROM feed_signals WHERE user_id=$1::uuid AND kind=$2 AND target_user_id=$3::uuid`, uid, kind, userID)
	} else {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "kind and user_id or post_id required")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) UpdateParental(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var hash string
	var enabled, note, showAdult bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(parental_pin_hash,''), COALESCE(parental_enabled,false),
		       COALESCE(age_gate_note,false), COALESCE(show_adult,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&hash, &enabled, &note, &showAdult)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	var req struct {
		Enabled     *bool   `json:"enabled"`
		Pin         string  `json:"pin"`
		NewPin      string  `json:"new_pin"`
		AgeGateNote *bool   `json:"age_gate_note"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if hash != "" && bcrypt.CompareHashAndPassword([]byte(hash), []byte(strings.TrimSpace(req.Pin))) != nil {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Неверный PIN")
		return
	}
	if req.NewPin != "" {
		if !pinOK(req.NewPin) {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "PIN из 4–8 цифр")
			return
		}
		sum, err := bcrypt.GenerateFromPassword([]byte(strings.TrimSpace(req.NewPin)), bcrypt.DefaultCost)
		if err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", "pin")
			return
		}
		hash = string(sum)
	}
	if req.Enabled != nil {
		if *req.Enabled && hash == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Сначала задайте PIN")
			return
		}
		enabled = *req.Enabled
	}
	if req.AgeGateNote != nil {
		note = *req.AgeGateNote
	}
	if enabled {
		showAdult = false
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE users SET parental_pin_hash=$2, parental_enabled=$3, age_gate_note=$4, show_adult=$5
		WHERE id=$1::uuid`, uid, hash, enabled, note, showAdult)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "parental_enabled": enabled, "age_gate_note": note,
		"show_adult": showAdult, "has_pin": hash != "",
	})
}

func pinOK(pin string) bool {
	pin = strings.TrimSpace(pin)
	if len(pin) < 4 || len(pin) > 8 {
		return false
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (s *Service) ListMusic(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, title, artist, url, created_at
		FROM music_tracks WHERE user_id=$1::uuid ORDER BY created_at DESC LIMIT 100`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, title, artist, rawURL string
		var created time.Time
		if err := rows.Scan(&id, &title, &artist, &rawURL, &created); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "title": title, "artist": artist, "url": rawURL,
			"created_at": created.UTC().Format(time.RFC3339),
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) CreateMusic(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title  string `json:"title"`
		Artist string `json:"artist"`
		URL    string `json:"url"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.URL = strings.TrimSpace(req.URL)
	req.Artist = strings.TrimSpace(req.Artist)
	if req.Title == "" || req.URL == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нужны название и ссылка")
		return
	}
	if !strings.HasPrefix(req.URL, "https://") && !strings.HasPrefix(req.URL, "http://") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Ссылка должна начинаться с http(s)")
		return
	}
	var id, created string
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO music_tracks (user_id, title, artist, url)
		VALUES ($1::uuid, $2, $3, $4)
		RETURNING id::text, created_at::text`, uid, req.Title, req.Artist, req.URL).Scan(&id, &created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id, "title": req.Title, "artist": req.Artist, "url": req.URL, "created_at": created,
	})
}

func (s *Service) DeleteMusic(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		DELETE FROM music_tracks WHERE id=$1::uuid AND user_id=$2::uuid`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "track not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
