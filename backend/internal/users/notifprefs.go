package users

import (
	"net/http"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func (s *Service) GetNotifPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var likes, comments, follows, messages, mentions, qFav bool
	var digest int
	var qStart, qEnd *int
	err := s.pool.QueryRow(r.Context(), `
		SELECT likes, comments, follows, messages, mentions, digest_hours, quiet_start, quiet_end,
		       COALESCE(quiet_allow_favorites, true)
		FROM notification_prefs WHERE user_id=$1::uuid`, uid).
		Scan(&likes, &comments, &follows, &messages, &mentions, &digest, &qStart, &qEnd, &qFav)
	if err != nil {
		likes, comments, follows, messages, mentions, qFav = true, true, true, true, true, true
		digest = 0
	}
	out := map[string]any{
		"likes": likes, "comments": comments, "follows": follows, "messages": messages, "mentions": mentions,
		"digest_hours": digest, "quiet_start": qStart, "quiet_end": qEnd,
		"quiet_allow_favorites": qFav,
	}
	apiutil.JSON(w, http.StatusOK, out)
}

func (s *Service) UpdateNotifPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Likes               *bool `json:"likes"`
		Comments            *bool `json:"comments"`
		Follows             *bool `json:"follows"`
		Messages            *bool `json:"messages"`
		Mentions            *bool `json:"mentions"`
		DigestHours         *int  `json:"digest_hours"`
		QuietStart          *int  `json:"quiet_start"`
		QuietEnd            *int  `json:"quiet_end"`
		QuietAllowFavorites *bool `json:"quiet_allow_favorites"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	likes, comments, follows, messages, mentions, qFav := true, true, true, true, true, true
	digest := 0
	var qs, qe *int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT likes, comments, follows, messages, mentions, digest_hours, quiet_start, quiet_end,
		       COALESCE(quiet_allow_favorites, true)
		FROM notification_prefs WHERE user_id=$1::uuid`, uid).
		Scan(&likes, &comments, &follows, &messages, &mentions, &digest, &qs, &qe, &qFav)
	if req.Likes != nil {
		likes = *req.Likes
	}
	if req.Comments != nil {
		comments = *req.Comments
	}
	if req.Follows != nil {
		follows = *req.Follows
	}
	if req.Messages != nil {
		messages = *req.Messages
	}
	if req.Mentions != nil {
		mentions = *req.Mentions
	}
	if req.DigestHours != nil {
		digest = *req.DigestHours
		if digest < 0 || digest > 168 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "digest_hours 0..168")
			return
		}
	}
	if req.QuietStart != nil {
		qs = req.QuietStart
	}
	if req.QuietEnd != nil {
		qe = req.QuietEnd
	}
	if req.QuietAllowFavorites != nil {
		qFav = *req.QuietAllowFavorites
	}
	_, err := s.pool.Exec(r.Context(), `
		INSERT INTO notification_prefs (user_id, likes, comments, follows, messages, mentions, digest_hours, quiet_start, quiet_end, quiet_allow_favorites, updated_at)
		VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
		ON CONFLICT (user_id) DO UPDATE SET
		  likes=$2, comments=$3, follows=$4, messages=$5, mentions=$6,
		  digest_hours=$7, quiet_start=$8, quiet_end=$9, quiet_allow_favorites=$10, updated_at=now()`,
		uid, likes, comments, follows, messages, mentions, digest, qs, qe, qFav)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "likes": likes, "comments": comments, "follows": follows, "messages": messages,
		"mentions": mentions, "digest_hours": digest, "quiet_start": qs, "quiet_end": qe,
		"quiet_allow_favorites": qFav,
	})
}
