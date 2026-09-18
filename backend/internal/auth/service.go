package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	pool           *pgxpool.Pool
	jwtSecret      []byte
	accessTTL      time.Duration
	refreshTTL     time.Duration
}

func NewService(pool *pgxpool.Pool, jwtSecret string, accessMin, refreshDays int) *Service {
	return &Service{
		pool:       pool,
		jwtSecret:  []byte(jwtSecret),
		accessTTL:  time.Duration(accessMin) * time.Minute,
		refreshTTL: time.Duration(refreshDays) * 24 * time.Hour,
	}
}

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type tokenResponse struct {
	AccessToken  string         `json:"access_token"`
	ExpiresIn    int64          `json:"expires_in"`
	RefreshToken string         `json:"refresh_token,omitempty"`
	TokenType    string         `json:"token_type"`
	User         map[string]any `json:"user,omitempty"`
}

func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
			return
		}
		raw := strings.TrimPrefix(h, "Bearer ")
		claims, err := s.parseAccess(raw)
		if err != nil {
			apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "invalid token")
			return
		}
		ctx := apiutil.WithUser(r.Context(), claims.Subject, claims.Username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string  `json:"username"`
		DisplayName string  `json:"display_name"`
		Email       *string `json:"email"`
		Phone       *string `json:"phone"`
		Password    string  `json:"password"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Password) < 4 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "username and password (>=4) required")
		return
	}
	if (req.Email == nil || *req.Email == "") && (req.Phone == nil || *req.Phone == "") {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "email or phone required")
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Username
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "hash failed")
		return
	}
	id := uuid.New()
	ctx := r.Context()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, username, password_hash, display_name)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		id, nullStr(req.Email), nullStr(req.Phone), req.Username, string(hash), req.DisplayName)
	if err != nil {
		if isUniqueViolation(err) {
			apiutil.Error(w, http.StatusConflict, "conflict", "username or contact already taken")
			return
		}
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	user := map[string]any{
		"id": id.String(), "username": req.Username, "display_name": req.DisplayName,
		"email": req.Email, "phone": req.Phone, "bio": "", "avatar_url": "",
	}
	tok, err := s.issueTokens(ctx, id.String(), req.Username)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "token issue failed")
		return
	}
	tok.User = user
	apiutil.JSON(w, http.StatusCreated, tok)
}

func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Login = strings.TrimSpace(req.Login)
	if req.Login == "" || req.Password == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "login and password required")
		return
	}
	ctx := r.Context()
	var id uuid.UUID
	var username, displayName, hash string
	var email, phone, bio, avatar *string
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, display_name, password_hash, email, phone, bio, avatar_url
		FROM users
		WHERE deleted_at IS NULL
		  AND (username = $1 OR email = $1 OR phone = $1)
		LIMIT 1`, req.Login).Scan(&id, &username, &displayName, &hash, &email, &phone, &bio, &avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	tok, err := s.issueTokens(ctx, id.String(), username)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "token issue failed")
		return
	}
	tok.User = map[string]any{
		"id": id.String(), "username": username, "display_name": displayName,
		"email": email, "phone": phone, "bio": deref(bio), "avatar_url": deref(avatar),
	}
	apiutil.JSON(w, http.StatusOK, tok)
}

func (s *Service) Refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	if req.RefreshToken == "" {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "refresh_token required")
		return
	}
	th := hashToken(req.RefreshToken)
	ctx := r.Context()
	var userID uuid.UUID
	var username string
	var expiresAt time.Time
	var revoked *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT rt.user_id, u.username, rt.expires_at, rt.revoked_at
		FROM refresh_tokens rt
		JOIN users u ON u.id = rt.user_id AND u.deleted_at IS NULL
		WHERE rt.token_hash = $1`, th).Scan(&userID, &username, &expiresAt, &revoked)
	if errors.Is(err, pgx.ErrNoRows) || (revoked != nil) || time.Now().After(expiresAt) {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "invalid refresh token")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	// rotate: revoke old
	_, _ = s.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, th)
	tok, err := s.issueTokens(ctx, userID.String(), username)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "token issue failed")
		return
	}
	apiutil.JSON(w, http.StatusOK, tok)
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	if req.RefreshToken != "" {
		_, _ = s.pool.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, hashToken(req.RefreshToken))
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) issueTokens(ctx context.Context, userID, username string) (*tokenResponse, error) {
	now := time.Now()
	claims := Claims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTTL)),
			ID:        uuid.NewString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	access, err := t.SignedString(s.jwtSecret)
	if err != nil {
		return nil, err
	}
	refreshRaw, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1,$2,$3)`, userID, hashToken(refreshRaw), now.Add(s.refreshTTL))
	if err != nil {
		return nil, err
	}
	return &tokenResponse{
		AccessToken:  access,
		ExpiresIn:    int64(s.accessTTL.Seconds()),
		RefreshToken: refreshRaw,
		TokenType:    "Bearer",
	}, nil
}

func (s *Service) parseAccess(raw string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected alg")
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("invalid")
	}
	return claims, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func nullStr(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func isUniqueViolation(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint"))
}
