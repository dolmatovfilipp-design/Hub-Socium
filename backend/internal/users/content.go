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
	var showAdult, parental, hideStories, ageNote, hasPin bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(show_adult,false), COALESCE(parental_enabled,false),
		       COALESCE(hide_stories,false), COALESCE(age_gate_note,false),
		       COALESCE(parental_pin_hash,'') <> ''
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&showAdult, &parental, &hideStories, &ageNote, &hasPin)
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
		"hide_stories":     hideStories,
		"age_gate_note":    ageNote,
		"has_pin":          hasPin,
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
	var curShow, curParental, curHide, curNote bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(show_adult,false), COALESCE(parental_enabled,false),
		       COALESCE(hide_stories,false), COALESCE(age_gate_note,false)
		FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&curShow, &curParental, &curHide, &curNote)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	var req struct {
		ShowAdult       *bool `json:"show_adult"`
		ParentalEnabled *bool `json:"parental_enabled"`
		HideStories     *bool `json:"hide_stories"`
		AgeGateNote     *bool `json:"age_gate_note"`
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
	if req.HideStories != nil {
		curHide = *req.HideStories
	}
	if req.AgeGateNote != nil {
		curNote = *req.AgeGateNote
	}
	if curParental {
		curShow = false
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE users SET show_adult=$2, parental_enabled=$3, hide_stories=$4, age_gate_note=$5
		WHERE id=$1::uuid AND deleted_at IS NULL`, uid, curShow, curParental, curHide, curNote)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"show_adult":       curShow,
		"parental_enabled": curParental,
		"hide_stories":     curHide,
		"age_gate_note":    curNote,
	})
}
