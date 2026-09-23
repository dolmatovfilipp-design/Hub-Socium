package waitlist

import (
	"net"
	"net/http"
	"net/mail"
	"strings"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service handles public waitlist + invite validation (no Bearer).
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// JoinWaitlist POST /v1/waitlist — idempotent on duplicate email (200 vs 201).
func (s *Service) JoinWaitlist(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if !validEmail(email) {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "valid email required")
		return
	}

	ip := clientIP(r)
	ctx := r.Context()

	var existingID string
	err := s.pool.QueryRow(ctx, `
		SELECT id::text FROM waitlist_emails WHERE lower(email) = $1`, email).Scan(&existingID)
	if err == nil {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"email":   email,
			"created": false,
		})
		return
	}
	if err != nil && err != pgx.ErrNoRows {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "waitlist lookup failed")
		return
	}

	var id string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO waitlist_emails (email, ip)
		VALUES ($1, $2)
		ON CONFLICT ((lower(email))) DO NOTHING
		RETURNING id::text`, email, nullIfEmpty(ip)).Scan(&id)
	if err == pgx.ErrNoRows {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"email":   email,
			"created": false,
		})
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "waitlist insert failed")
		return
	}

	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"ok":      true,
		"email":   email,
		"created": true,
		"id":      id,
	})
}

// ValidateInvite POST /v1/invite/validate — checks code without consuming uses.
// Uses are reserved for a future redeem-on-register flow; Landing only needs ok → /register.
func (s *Service) ValidateInvite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invite code required")
		return
	}

	var (
		stored  string
		maxUses int
		uses    int
		active  bool
	)
	err := s.pool.QueryRow(r.Context(), `
		SELECT code, max_uses, uses, active
		FROM invite_codes
		WHERE upper(code) = upper($1)`, code).Scan(&stored, &maxUses, &uses, &active)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "invite code not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", "invite lookup failed")
		return
	}
	if !active {
		apiutil.Error(w, http.StatusGone, "invite_inactive", "invite code is inactive")
		return
	}
	if uses >= maxUses {
		apiutil.Error(w, http.StatusGone, "invite_exhausted", "invite code has no uses left")
		return
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"code": stored,
	})
}

func validEmail(email string) bool {
	if email == "" || strings.Contains(email, " ") {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil {
		return false
	}
	return strings.EqualFold(addr.Address, email) && strings.Contains(email, ".")
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
