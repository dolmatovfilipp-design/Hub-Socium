package contacts

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

var nonDigit = regexp.MustCompile(`[^\d+]`)

// NormalizePhone → E.164-ish digits for RU (+7…)
func NormalizePhone(raw string) string {
	s := strings.TrimSpace(raw)
	s = nonDigit.ReplaceAllString(s, "")
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "8") && len(s) == 11 {
		s = "7" + s[1:]
	}
	if strings.HasPrefix(s, "+") {
		s = strings.TrimPrefix(s, "+")
	}
	// keep digits only
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	s = b.String()
	if len(s) < 10 || len(s) > 15 {
		return ""
	}
	return s
}

func HashPhone(normalized string) string {
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("hub:phone:v1:" + normalized))
	return hex.EncodeToString(sum[:])
}

// Match POST /v1/contacts/match — body { phones?: [], hashes?: [] }
// Returns Hub users whose phone_hash matches. NO invites / NO SMS.
func (s *Service) Match(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Phones []string `json:"phones"`
		Hashes []string `json:"hashes"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	hashSet := map[string]struct{}{}
	for _, h := range req.Hashes {
		h = strings.ToLower(strings.TrimSpace(h))
		if len(h) == 64 {
			hashSet[h] = struct{}{}
		}
	}
	for _, p := range req.Phones {
		n := NormalizePhone(p)
		if n == "" {
			continue
		}
		hashSet[HashPhone(n)] = struct{}{}
	}
	if len(hashSet) == 0 {
		apiutil.JSON(w, http.StatusOK, map[string]any{"items": []any{}, "matched": 0, "note": "Нет номеров для сравнения."})
		return
	}
	if len(hashSet) > 500 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "max 500 phones")
		return
	}
	hashes := make([]string, 0, len(hashSet))
	for h := range hashSet {
		hashes = append(hashes, h)
	}

	var phone *string
	_ = s.pool.QueryRow(r.Context(), `SELECT phone FROM users WHERE id=$1::uuid`, uid).Scan(&phone)
	if phone != nil {
		n := NormalizePhone(*phone)
		if n != "" {
			_, _ = s.pool.Exec(r.Context(), `UPDATE users SET phone_hash=$2 WHERE id=$1::uuid`, uid, HashPhone(n))
		}
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, username, display_name, COALESCE(avatar_url,''), COALESCE(is_verified,false)
		FROM users
		WHERE deleted_at IS NULL AND phone_hash = ANY($1::text[]) AND id <> $2::uuid
		LIMIT 100`, hashes, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, uname, dname, avatar string
		var verified bool
		if rows.Scan(&id, &uname, &dname, &avatar, &verified) == nil {
			items = append(items, map[string]any{
				"id": id, "username": uname, "display_name": dname,
				"avatar_url": avatar, "is_verified": verified,
			})
		}
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items": items, "matched": len(items),
		"note": "Только те, кто уже в Hub. Рассылки нет.",
	})
}

// SyncMyPhoneHash helper for register/update — call from users when phone changes.
func SyncPhoneHash(pool *pgxpool.Pool, r *http.Request, userID, phone string) {
	n := NormalizePhone(phone)
	if n == "" {
		_, _ = pool.Exec(r.Context(), `UPDATE users SET phone_hash=NULL WHERE id=$1::uuid`, userID)
		return
	}
	_, _ = pool.Exec(r.Context(), `UPDATE users SET phone_hash=$2 WHERE id=$1::uuid`, userID, HashPhone(n))
}
