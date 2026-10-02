package users

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
)

const referralInviteMessage = "Привет, я пользуюсь приложением Hub, присоединяйся ко мне"

// MyReferral GET /v1/me/referral — personal invite code + share copy.
func (s *Service) MyReferral(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	ctx := r.Context()
	var username string
	err := s.pool.QueryRow(ctx, `
		SELECT username FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&username)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var code string
	err = s.pool.QueryRow(ctx, `
		SELECT code FROM invite_codes WHERE owner_user_id = $1::uuid LIMIT 1`, uid).Scan(&code)
	if err != nil && err != pgx.ErrNoRows {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err == pgx.ErrNoRows || code == "" {
		compact := strings.ReplaceAll(uid, "-", "")
		if len(compact) > 8 {
			compact = compact[:8]
		}
		code = "R" + strings.ToUpper(compact)
		_, err = s.pool.Exec(ctx, `
			INSERT INTO invite_codes (code, max_uses, uses, active, owner_user_id)
			VALUES ($1, 10000, 0, true, $2::uuid)
			ON CONFLICT (code) DO UPDATE
			  SET owner_user_id = COALESCE(invite_codes.owner_user_id, EXCLUDED.owner_user_id),
			      active = true`, code, uid)
		if err != nil {
			// unique owner race — re-read
			_ = s.pool.QueryRow(ctx, `
				SELECT code FROM invite_codes WHERE owner_user_id = $1::uuid LIMIT 1`, uid).Scan(&code)
			if code == "" {
				apiutil.Error(w, http.StatusInternalServerError, "internal", fmt.Sprintf("referral create: %v", err))
				return
			}
		}
	}

	path := fmt.Sprintf("/invite?code=%s&ref=%s", code, username)
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"code":    code,
		"ref":     username,
		"path":    path,
		"message": referralInviteMessage,
	})
}
