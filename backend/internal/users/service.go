package users

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	u, err := s.fetchByID(r, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, u)
}

func (s *Service) GetByUsername(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	var (
		u   map[string]any
		err error
	)
	if _, parseErr := uuid.Parse(username); parseErr == nil {
		u, err = s.fetchByID(r, username)
	} else {
		u, err = s.fetchByUsername(r, username)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, u)
}

func (s *Service) fetchByID(r *http.Request, id string) (map[string]any, error) {
	var uid uuid.UUID
	var username, displayName, bio, avatar string
	var email, phone *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, COALESCE(bio,''), COALESCE(avatar_url,''), email, phone
		FROM users WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&uid, &username, &displayName, &bio, &avatar, &email, &phone)
	if err != nil {
		return nil, err
	}
	return s.withCounters(r, uid, username, displayName, bio, avatar, email, phone)
}

func (s *Service) fetchByUsername(r *http.Request, username string) (map[string]any, error) {
	var uid uuid.UUID
	var uname, displayName, bio, avatar string
	var email, phone *string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, COALESCE(bio,''), COALESCE(avatar_url,''), email, phone
		FROM users WHERE username = $1 AND deleted_at IS NULL`, username).
		Scan(&uid, &uname, &displayName, &bio, &avatar, &email, &phone)
	if err != nil {
		return nil, err
	}
	return s.withCounters(r, uid, uname, displayName, bio, avatar, email, phone)
}

func (s *Service) withCounters(r *http.Request, uid uuid.UUID, username, displayName, bio, avatar string, email, phone *string) (map[string]any, error) {
	var postsCount, followers, following int64
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM posts WHERE author_id=$1 AND deleted_at IS NULL`, uid).Scan(&postsCount)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM follows WHERE followee_id=$1`, uid).Scan(&followers)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM follows WHERE follower_id=$1`, uid).Scan(&following)
	out := map[string]any{
		"id":            uid.String(),
		"username":      username,
		"display_name":  displayName,
		"bio":           bio,
		"avatar_url":    avatar,
		"email":         email,
		"phone":         phone,
		"posts_count":   postsCount,
		"followers":     followers,
		"following":     following,
	}
	return out, nil
}

func (s *Service) UpdateMe(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		Username    *string `json:"username"`
		Bio         *string `json:"bio"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}

	cur, err := s.fetchByID(r, uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	displayName := cur["display_name"].(string)
	username := cur["username"].(string)
	bio := cur["bio"].(string)
	avatar := cur["avatar_url"].(string)

	if req.DisplayName != nil {
		displayName = strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "display_name required")
			return
		}
		if utf8.RuneCountInString(displayName) > 80 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "display_name max 80 characters")
			return
		}
	}
	if req.Username != nil {
		username = strings.TrimSpace(*req.Username)
		if username == "" {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "username required")
			return
		}
		if utf8.RuneCountInString(username) > 32 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "username max 32 characters")
			return
		}
	}
	if req.Bio != nil {
		bio = strings.TrimSpace(*req.Bio)
		if utf8.RuneCountInString(bio) > 300 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "bio max 300 characters")
			return
		}
	}
	if req.AvatarURL != nil {
		avatar = strings.TrimSpace(*req.AvatarURL)
		// Prefer short /v1/media/{id} paths. Tiny data: URLs allowed as fallback (<100KB).
		const maxDataAvatar = 100 * 1024
		if strings.HasPrefix(avatar, "data:") {
			if len(avatar) > maxDataAvatar {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "data avatar too long (max 100KB) — use POST /v1/media/upload")
				return
			}
			if !strings.HasPrefix(avatar, "data:image/") {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "avatar_url data URL must be image/*")
				return
			}
		} else if avatar != "" {
			if len(avatar) > 2048 {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "avatar_url too long")
				return
			}
			if !strings.HasPrefix(avatar, "http://") && !strings.HasPrefix(avatar, "https://") &&
				!strings.HasPrefix(avatar, "/") {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "avatar_url must be /v1/media/{id}, http(s), or small data:image")
				return
			}
		}
	}

	_, err = s.pool.Exec(r.Context(), `
		UPDATE users
		SET display_name = $2, username = $3, bio = $4, avatar_url = $5
		WHERE id = $1 AND deleted_at IS NULL`, uid, displayName, username, bio, avatar)
	if err != nil {
		if strings.Contains(err.Error(), "users_username_key") || strings.Contains(err.Error(), "duplicate key") {
			apiutil.Error(w, http.StatusConflict, "conflict", "username already taken")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	u, err := s.fetchByID(r, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, u)
}
