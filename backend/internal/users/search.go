package users

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

// Search handles GET /v1/users/search
// Query: q, name, age_min, age_max, gender, city, following, limit, cursor
func (s *Service) Search(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	gender := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("gender")))
	if gender == "any" || gender == "" {
		gender = ""
	}
	if gender != "" && gender != "male" && gender != "female" {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "gender must be male, female, or any")
		return
	}

	followingOnly := r.URL.Query().Get("following") == "1" ||
		strings.EqualFold(r.URL.Query().Get("following"), "true")

	limit := 30
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 50 {
		limit = 50
	}

	var ageMin, ageMax *int
	if raw := r.URL.Query().Get("age_min"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 150 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invalid age_min")
			return
		}
		ageMin = &n
	}
	if raw := r.URL.Query().Get("age_max"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 150 {
			apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "invalid age_max")
			return
		}
		ageMax = &n
	}
	if ageMin != nil && ageMax != nil && *ageMin > *ageMax {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "age_min > age_max")
		return
	}

	cursorUsername, cursorID, hasCursor := decodeSearchCursor(r.URL.Query().Get("cursor"))

	// Require at least one discovery signal so we don't dump the whole table.
	if q == "" && name == "" && city == "" && gender == "" && ageMin == nil && ageMax == nil && !followingOnly {
		apiutil.JSON(w, http.StatusOK, map[string]any{
			"items":       []any{},
			"next_cursor": nil,
		})
		return
	}

	sql := `
		SELECT u.id, u.username, u.display_name, COALESCE(u.avatar_url,''),
		       u.birth_date, u.gender, COALESCE(u.city,''),
		       EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = u.id) AS is_following
		FROM users u
		WHERE u.deleted_at IS NULL
		  AND u.id <> $1::uuid
		  AND NOT EXISTS (
		    SELECT 1 FROM blocks b
		    WHERE (b.blocker_id = $1::uuid AND b.blocked_id = u.id)
		       OR (b.blocker_id = u.id AND b.blocked_id = $1::uuid)
		  )`
	args := []any{uid}
	argN := 2

	if followingOnly {
		sql += fmt.Sprintf(`
		  AND EXISTS (
		    SELECT 1 FROM follows f2
		    WHERE f2.follower_id = $1::uuid AND f2.followee_id = u.id
		  )`)
	}

	if q != "" {
		pat := "%" + escapeILIKE(q) + "%"
		sql += fmt.Sprintf(`
		  AND (u.username ILIKE $%d ESCAPE '\' OR u.display_name ILIKE $%d ESCAPE '\')`, argN, argN)
		args = append(args, pat)
		argN++
	}
	if name != "" {
		pat := "%" + escapeILIKE(name) + "%"
		sql += fmt.Sprintf(` AND u.display_name ILIKE $%d ESCAPE '\'`, argN)
		args = append(args, pat)
		argN++
	}
	if city != "" {
		sql += fmt.Sprintf(` AND lower(u.city) = lower($%d)`, argN)
		args = append(args, city)
		argN++
	}
	if gender != "" {
		sql += fmt.Sprintf(` AND u.gender = $%d`, argN)
		args = append(args, gender)
		argN++
	}
	// Age from birth_date: age = date_part('year', age(birth_date))
	if ageMin != nil {
		sql += fmt.Sprintf(` AND u.birth_date IS NOT NULL AND date_part('year', age(u.birth_date)) >= $%d`, argN)
		args = append(args, *ageMin)
		argN++
	}
	if ageMax != nil {
		sql += fmt.Sprintf(` AND u.birth_date IS NOT NULL AND date_part('year', age(u.birth_date)) <= $%d`, argN)
		args = append(args, *ageMax)
		argN++
	}
	if hasCursor {
		sql += fmt.Sprintf(` AND (lower(u.username), u.id) > (lower($%d), $%d::uuid)`, argN, argN+1)
		args = append(args, cursorUsername, cursorID)
		argN += 2
	}

	sql += fmt.Sprintf(`
		ORDER BY lower(u.username) ASC, u.id ASC
		LIMIT $%d`, argN)
	args = append(args, limit+1)

	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id uuid.UUID
		var username, displayName, avatar, cityVal string
		var birthDate *time.Time
		var genderVal *string
		var isFollowing bool
		if err := rows.Scan(&id, &username, &displayName, &avatar, &birthDate, &genderVal, &cityVal, &isFollowing); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id":           id.String(),
			"username":     username,
			"display_name": displayName,
			"avatar_url":   avatar,
			"is_following": isFollowing,
		}
		if birthDate != nil {
			item["age"] = ageYears(*birthDate)
			item["birth_date"] = birthDate.Format("2006-01-02")
		}
		if genderVal != nil && *genderVal != "" {
			item["gender"] = *genderVal
		}
		if cityVal != "" {
			item["city"] = cityVal
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var next any
	if len(items) > limit {
		last := items[limit-1]
		items = items[:limit]
		next = encodeSearchCursor(last["username"].(string), last["id"].(string))
	}

	apiutil.JSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": next,
	})
}

func escapeILIKE(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func ageYears(birth time.Time) int {
	now := time.Now()
	years := now.Year() - birth.Year()
	if now.YearDay() < birth.YearDay() {
		years--
	}
	if years < 0 {
		return 0
	}
	return years
}

func encodeSearchCursor(username, id string) string {
	raw := username + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeSearchCursor(c string) (string, string, bool) {
	if c == "" {
		return "", "", false
	}
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return "", "", false
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	if _, err := uuid.Parse(parts[1]); err != nil {
		return "", "", false
	}
	return parts[0], parts[1], true
}
