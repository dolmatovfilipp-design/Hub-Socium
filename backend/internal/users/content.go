package users

import (
	"net/http"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// GetContentPrefs GET /v1/me/content-prefs
func (s *Service) GetContentPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var showAdult, parental bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(show_adult,false), COALESCE(parental_enabled,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&showAdult, &parental)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if parental {
		showAdult = false
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"show_adult":       showAdult,
		"parental_enabled": parental,
	})
}

// UpdateContentPrefs PUT /v1/me/content-prefs
// Parental control forces show_adult off.
func (s *Service) UpdateContentPrefs(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var curShow, curParental bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(show_adult,false), COALESCE(parental_enabled,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&curShow, &curParental)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	var req struct {
		ShowAdult       *bool `json:"show_adult"`
		ParentalEnabled *bool `json:"parental_enabled"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if req.ShowAdult != nil {
		curShow = *req.ShowAdult
	}
	if req.ParentalEnabled != nil {
		curParental = *req.ParentalEnabled
	}
	if curParental {
		curShow = false
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE users SET show_adult=$2, parental_enabled=$3
		WHERE id=$1::uuid AND deleted_at IS NULL`, uid, curShow, curParental)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"show_adult":       curShow,
		"parental_enabled": curParental,
	})
}
