package users

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func (s *Service) enrichProfileCard(r *http.Request, out map[string]any, userID string, isSelf bool) {
	var about, services string
	var links []byte
	var showCity, showBirth bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(about,''), COALESCE(services,''), COALESCE(links,'[]'::jsonb),
		       COALESCE(show_city,true), COALESCE(show_birth_date,false)
		FROM users WHERE id=$1::uuid`, userID).Scan(&about, &services, &links, &showCity, &showBirth)
	if err != nil {
		return
	}
	out["show_city"] = showCity
	out["show_birth_date"] = showBirth
	if isSelf || about != "" {
		out["about"] = about
	}
	if isSelf || services != "" {
		out["services"] = services
	}
	var linkArr any
	_ = json.Unmarshal(links, &linkArr)
	if linkArr == nil {
		linkArr = []any{}
	}
	out["links"] = linkArr
	if !isSelf && !showCity {
		delete(out, "city")
	}
	if !isSelf && !showBirth {
		delete(out, "birth_date")
		delete(out, "age")
	}
	// seller rating summary
	var avg float64
	var cnt int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(ROUND(AVG(rating)::numeric,1),0), COUNT(*)::int FROM seller_reviews WHERE seller_id=$1::uuid`, userID).
		Scan(&avg, &cnt)
	if cnt > 0 {
		out["seller_rating"] = avg
		out["seller_reviews"] = cnt
	}
}

// PatchProfileCard PATCH /v1/users/me/card
func (s *Service) PatchProfileCard(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		About         *string          `json:"about"`
		Services      *string          `json:"services"`
		Links         *json.RawMessage `json:"links"`
		ShowCity      *bool            `json:"show_city"`
		ShowBirthDate *bool            `json:"show_birth_date"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	about, services := "", ""
	links := []byte("[]")
	showCity, showBirth := true, false
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(about,''), COALESCE(services,''), COALESCE(links,'[]'::jsonb),
		       COALESCE(show_city,true), COALESCE(show_birth_date,false)
		FROM users WHERE id=$1::uuid`, uid).Scan(&about, &services, &links, &showCity, &showBirth)
	if req.About != nil {
		about = strings.TrimSpace(*req.About)
		if utf8.RuneCountInString(about) > 1000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "about max 1000")
			return
		}
	}
	if req.Services != nil {
		services = strings.TrimSpace(*req.Services)
		if utf8.RuneCountInString(services) > 1000 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "services max 1000")
			return
		}
	}
	if req.Links != nil {
		links = []byte(*req.Links)
		var arr []any
		if err := json.Unmarshal(links, &arr); err != nil || len(arr) > 10 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "links must be array max 10")
			return
		}
	}
	if req.ShowCity != nil {
		showCity = *req.ShowCity
	}
	if req.ShowBirthDate != nil {
		showBirth = *req.ShowBirthDate
	}
	_, err := s.pool.Exec(r.Context(), `
		UPDATE users SET about=$2, services=$3, links=$4::jsonb, show_city=$5, show_birth_date=$6
		WHERE id=$1::uuid`, uid, about, services, string(links), showCity, showBirth)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"ok": true, "about": about, "services": services, "links": json.RawMessage(links),
		"show_city": showCity, "show_birth_date": showBirth,
	})
}
