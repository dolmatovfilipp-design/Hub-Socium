package users

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	push *push.Service
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) SetPush(p *push.Service) { s.push = p }

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
	var consentAt *time.Time
	var role string
	var birthDate *time.Time
	var gender *string
	var city string
	var isPrivate bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, COALESCE(bio,''), COALESCE(avatar_url,''), email, phone, consent_152_at, COALESCE(role,'user'),
		       birth_date, gender, COALESCE(city,''), COALESCE(is_private,false)
		FROM users WHERE id = $1 AND deleted_at IS NULL`, id).
		Scan(&uid, &username, &displayName, &bio, &avatar, &email, &phone, &consentAt, &role, &birthDate, &gender, &city, &isPrivate)
	if err != nil {
		return nil, err
	}
	return s.withCounters(r, uid, username, displayName, bio, avatar, email, phone, consentAt, role, birthDate, gender, city, isPrivate)
}

func (s *Service) fetchByUsername(r *http.Request, username string) (map[string]any, error) {
	var uid uuid.UUID
	var uname, displayName, bio, avatar string
	var email, phone *string
	var consentAt *time.Time
	var role string
	var birthDate *time.Time
	var gender *string
	var city string
	var isPrivate bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, COALESCE(bio,''), COALESCE(avatar_url,''), email, phone, consent_152_at, COALESCE(role,'user'),
		       birth_date, gender, COALESCE(city,''), COALESCE(is_private,false)
		FROM users WHERE username = $1 AND deleted_at IS NULL`, username).
		Scan(&uid, &uname, &displayName, &bio, &avatar, &email, &phone, &consentAt, &role, &birthDate, &gender, &city, &isPrivate)
	if err != nil {
		return nil, err
	}
	return s.withCounters(r, uid, uname, displayName, bio, avatar, email, phone, consentAt, role, birthDate, gender, city, isPrivate)
}

func (s *Service) withCounters(r *http.Request, uid uuid.UUID, username, displayName, bio, avatar string, email, phone *string, consentAt *time.Time, role string, birthDate *time.Time, gender *string, city string, isPrivate bool) (map[string]any, error) {
	var postsCount, followers, following int64
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM posts WHERE author_id=$1 AND deleted_at IS NULL AND COALESCE(status,'published') = 'published'`, uid).Scan(&postsCount)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM follows WHERE followee_id=$1`, uid).Scan(&followers)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM follows WHERE follower_id=$1`, uid).Scan(&following)
	isAdmin := role == "admin" || username == "филипп"
	if !isAdmin {
		var firstID string
		_ = s.pool.QueryRow(r.Context(), `
			SELECT id::text FROM users
			WHERE deleted_at IS NULL
			ORDER BY created_at ASC, id ASC
			LIMIT 1`).Scan(&firstID)
		isAdmin = firstID == uid.String()
	}
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
		"consent_152":   consentAt != nil,
		"is_admin":      isAdmin,
		"is_private":    isPrivate,
	}
	if birthDate != nil {
		out["birth_date"] = birthDate.Format("2006-01-02")
		out["age"] = ageYears(*birthDate)
	}
	if gender != nil && *gender != "" {
		out["gender"] = *gender
	}
	if city != "" {
		out["city"] = city
	}
	viewer, hasViewer := apiutil.UserIDFromContext(r.Context())
	canSeeFull := !isPrivate
	if hasViewer && viewer == uid.String() {
		canSeeFull = true
	}
	if hasViewer && viewer != uid.String() {
		var isFollowing, isBlocked, isMuted, isRequested bool
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2)`, viewer, uid).Scan(&isFollowing)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2)`, viewer, uid).Scan(&isBlocked)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM mutes WHERE muter_id=$1 AND muted_id=$2)`, viewer, uid).Scan(&isMuted)
		_ = s.pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM follow_requests WHERE from_user_id=$1 AND to_user_id=$2 AND status='pending')`, viewer, uid).Scan(&isRequested)
		out["is_following"] = isFollowing
		out["is_blocked"] = isBlocked
		out["is_muted"] = isMuted
		out["follow_requested"] = isRequested
		if isFollowing {
			canSeeFull = true
		}
	}
	out["can_view"] = canSeeFull
	if isPrivate && !canSeeFull {
		// Public limited view: keep avatar + counters + display name; hide bio details optional — keep bio short ok
		out["posts_locked"] = true
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
		BirthDate   *string `json:"birth_date"` // YYYY-MM-DD or "" to clear
		Gender      *string `json:"gender"`     // male|female|"" to clear
		City        *string `json:"city"`
		IsPrivate   *bool   `json:"is_private"`
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

	birthDate := cur["birth_date"]
	genderVal, _ := cur["gender"].(string)
	cityVal, _ := cur["city"].(string)
	var birthPtr *time.Time
	if bd, ok := birthDate.(string); ok && bd != "" {
		if t, err := time.Parse("2006-01-02", bd); err == nil {
			birthPtr = &t
		}
	}

	if req.BirthDate != nil {
		v := strings.TrimSpace(*req.BirthDate)
		if v == "" {
			birthPtr = nil
		} else {
			t, err := time.Parse("2006-01-02", v)
			if err != nil {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "birth_date must be YYYY-MM-DD")
				return
			}
			if t.After(time.Now().UTC()) {
				apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "birth_date cannot be in the future")
				return
			}
			birthPtr = &t
		}
	}
	if req.Gender != nil {
		g := strings.ToLower(strings.TrimSpace(*req.Gender))
		if g == "" || g == "any" {
			genderVal = ""
		} else if g == "male" || g == "female" {
			genderVal = g
		} else {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "gender must be male, female, or empty")
			return
		}
	}
	if req.City != nil {
		cityVal = strings.TrimSpace(*req.City)
		if utf8.RuneCountInString(cityVal) > 80 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "city max 80 characters")
			return
		}
	}

	var genderArg any
	if genderVal == "" {
		genderArg = nil
	} else {
		genderArg = genderVal
	}
	var cityArg any
	if cityVal == "" {
		cityArg = nil
	} else {
		cityArg = cityVal
	}

	isPrivate := false
	if v, ok := cur["is_private"].(bool); ok {
		isPrivate = v
	}
	if req.IsPrivate != nil {
		isPrivate = *req.IsPrivate
	}

	_, err = s.pool.Exec(r.Context(), `
		UPDATE users
		SET display_name = $2, username = $3, bio = $4, avatar_url = $5,
		    birth_date = $6, gender = $7, city = $8, is_private = $9
		WHERE id = $1 AND deleted_at IS NULL`, uid, displayName, username, bio, avatar, birthPtr, genderArg, cityArg, isPrivate)
	if err != nil {
		if strings.Contains(err.Error(), "users_username_key") || strings.Contains(err.Error(), "duplicate key") {
			apiutil.Error(w, http.StatusConflict, "conflict", "username already taken")
			return
		}
		if strings.Contains(err.Error(), "users_gender_check") {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invalid gender")
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
