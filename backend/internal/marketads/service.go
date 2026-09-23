package marketads

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

func (s *Service) ListAds(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	sql := `
		SELECT a.id::text, a.seller_id::text, a.title, a.description, a.price, a.city, a.category,
		       COALESCE(a.image_url,''), a.created_at, u.username, u.display_name,
		       COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM seller_reviews sr WHERE sr.seller_id=a.seller_id),0),
		       COALESCE((SELECT COUNT(*)::int FROM seller_reviews sr2 WHERE sr2.seller_id=a.seller_id),0)
		FROM market_ads a
		JOIN users u ON u.id = a.seller_id AND u.deleted_at IS NULL
		WHERE a.deleted_at IS NULL`
	args := []any{}
	n := 1
	if city != "" && !strings.EqualFold(city, "Вся Россия") {
		sql += ` AND lower(a.city)=lower($` + strconv.Itoa(n) + `)`
		args = append(args, city)
		n++
	}
	if q != "" {
		sql += ` AND (a.title ILIKE '%'||$` + strconv.Itoa(n) + `||'%' OR a.description ILIKE '%'||$` + strconv.Itoa(n) + `||'%')`
		args = append(args, q)
		n++
	}
	sql += ` ORDER BY a.created_at DESC LIMIT $` + strconv.Itoa(n)
	args = append(args, 40)
	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, seller, title, desc, cityV, cat, img, uname, dname string
		var price int
		var created time.Time
		var avg float64
		var cnt int
		if err := rows.Scan(&id, &seller, &title, &desc, &price, &cityV, &cat, &img, &created, &uname, &dname, &avg, &cnt); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		item := map[string]any{
			"id": id, "seller_id": seller, "title": title, "description": desc, "price": price,
			"city": cityV, "category": cat, "created_at": created.UTC().Format(time.RFC3339Nano),
			"seller": map[string]any{"id": seller, "username": uname, "display_name": dname},
			"seller_rating": avg, "seller_reviews": cnt,
		}
		if img != "" {
			item["image_url"] = img
		}
		items = append(items, item)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) CreateAd(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Title string `json:"title"`
		Description string `json:"description"`
		City string `json:"city"`
		Category string `json:"category"`
		ImageURL string `json:"image_url"`
		Price int `json:"price"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Category == "" {
		req.Category = "Разное"
	}
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 120 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "title 1..120")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO market_ads (id, seller_id, title, description, price, city, category, image_url)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8) RETURNING created_at`,
		id, uid, req.Title, strings.TrimSpace(req.Description), req.Price, strings.TrimSpace(req.City),
		strings.TrimSpace(req.Category), strings.TrimSpace(req.ImageURL)).Scan(&created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": id.String(), "seller_id": uid, "title": req.Title, "price": req.Price,
		"city": req.City, "category": req.Category, "created_at": created.UTC().Format(time.RFC3339Nano),
	})
}
