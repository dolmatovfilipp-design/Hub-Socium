package meetups

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	sql := `
		SELECT m.id::text, m.host_id::text, m.title, m.description, m.city, m.place, m.starts_at, m.created_at,
		       m.conversation_id, u.username, u.display_name,
		       (SELECT COUNT(*)::int FROM meetup_rsvps r WHERE r.meetup_id=m.id AND r.status='going'),
		       EXISTS(SELECT 1 FROM meetup_rsvps r2 WHERE r2.meetup_id=m.id AND r2.user_id=$1::uuid AND r2.status='going')
		FROM meetups m JOIN users u ON u.id=m.host_id
		WHERE m.deleted_at IS NULL AND m.starts_at > now() - interval '1 day'`
	args := []any{uid}
	n := 2
	if city != "" {
		sql += ` AND lower(m.city)=lower($` + strconv.Itoa(n) + `)`
		args = append(args, city)
		n++
	}
	sql += ` ORDER BY m.starts_at ASC LIMIT 50`
	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, host, title, desc, cityV, place, uname, dname string
		var starts, created time.Time
		var going int
		var igo bool
		var convID *uuid.UUID
		if err := rows.Scan(&id, &host, &title, &desc, &cityV, &place, &starts, &created, &convID, &uname, &dname, &going, &igo); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id, "host_id": host, "title": title, "description": desc, "city": cityV, "place": place,
			"starts_at": starts.UTC().Format(time.RFC3339Nano), "created_at": created.UTC().Format(time.RFC3339Nano),
			"going": going, "i_go": igo, "host": map[string]any{"id": host, "username": uname, "display_name": dname},
		}
		if convID != nil {
			item["conversation_id"] = convID.String()
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		City        string `json:"city"`
		Place       string `json:"place"`
		StartsAt    string `json:"starts_at"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 120 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1..120")
		return
	}
	starts, err := time.Parse(time.RFC3339, req.StartsAt)
	if err != nil {
		starts, err = time.Parse(time.RFC3339Nano, req.StartsAt)
	}
	if err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "starts_at RFC3339")
		return
	}
	id := uuid.New()
	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO meetups (id, host_id, title, description, city, place, starts_at)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7) RETURNING created_at`,
		id, uid, req.Title, strings.TrimSpace(req.Description), strings.TrimSpace(req.City),
		strings.TrimSpace(req.Place), starts).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_, _ = s.pool.Exec(r.Context(), `INSERT INTO meetup_rsvps (meetup_id, user_id, status) VALUES ($1,$2::uuid,'going')`, id, uid)
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "host_id": uid, "title": req.Title, "city": req.City, "place": req.Place,
		"starts_at": starts.UTC().Format(time.RFC3339Nano), "created_at": created.UTC().Format(time.RFC3339Nano),
		"going": 1, "i_go": true,
	})
}
