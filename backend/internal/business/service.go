package business

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type mediaIn struct {
	URL  string `json:"url"`
	Kind string `json:"kind"`
}

type specIn struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type productIn struct {
	Title       string    `json:"title"`
	Price       int       `json:"price"`
	OldPrice    *int      `json:"old_price"`
	ShortText   string    `json:"short_text"`
	Description string    `json:"description"`
	Category    string    `json:"category"`
	City        string    `json:"city"`
	Stock       *int      `json:"stock"`
	Status      string    `json:"status"`
	Media       []mediaIn `json:"media"`
	Specs       []specIn  `json:"specs"`
}

const ratingSQL = `GREATEST(0,
	COALESCE((SELECT COUNT(*)::int FROM product_likes l WHERE l.product_id = p.id), 0)
	+ COALESCE((SELECT COUNT(*)::int FROM product_reviews r WHERE r.product_id = p.id AND r.sentiment = 'positive'), 0)
	- COALESCE((SELECT COUNT(*)::int FROM product_reviews r WHERE r.product_id = p.id AND r.sentiment = 'negative'), 0)
)`

const sellerRatingSQL = `GREATEST(0,
	COALESCE((SELECT COUNT(*)::int FROM product_likes l JOIN products pp ON pp.id = l.product_id WHERE pp.seller_id = u.id AND pp.deleted_at IS NULL), 0)
	+ COALESCE((SELECT COUNT(*)::int FROM product_reviews r JOIN products pp ON pp.id = r.product_id WHERE pp.seller_id = u.id AND pp.deleted_at IS NULL AND r.sentiment = 'positive'), 0)
	- COALESCE((SELECT COUNT(*)::int FROM product_reviews r JOIN products pp ON pp.id = r.product_id WHERE pp.seller_id = u.id AND pp.deleted_at IS NULL AND r.sentiment = 'negative'), 0)
)`

func (s *Service) Profile(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var enabled bool
	err := s.pool.QueryRow(r.Context(), `SELECT COALESCE(business_mode,false) FROM users WHERE id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&enabled)
	if err != nil {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"business_mode": enabled})
}

func (s *Service) SetMode(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `UPDATE users SET business_mode=$2 WHERE id=$1::uuid AND deleted_at IS NULL`, uid, req.Enabled)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "business_mode": req.Enabled})
}

func (s *Service) List(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	q := r.URL.Query()
	sql := `
		SELECT p.id::text, p.seller_id::text, p.title, p.price, p.old_price, p.short_text, p.description,
		       p.category, p.city, p.stock, p.status, p.views, p.created_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,''),
		       ` + ratingSQL + `,
		       ` + sellerRatingSQL + `,
		       COALESCE((SELECT COUNT(*)::int FROM product_reviews rv WHERE rv.product_id = p.id), 0),
		       COALESCE((SELECT COUNT(*)::int FROM product_likes lk WHERE lk.product_id = p.id), 0),
		       EXISTS(SELECT 1 FROM product_likes me WHERE me.product_id = p.id AND me.user_id = $1::uuid)
		FROM products p
		JOIN users u ON u.id = p.seller_id AND u.deleted_at IS NULL
		WHERE p.deleted_at IS NULL`
	args := []any{uid}
	n := 2
	if q.Get("mine") == "1" {
		sql += ` AND p.seller_id = $1::uuid`
	} else {
		sql += ` AND p.status = 'active'`
	}
	if cat := strings.TrimSpace(q.Get("category")); cat != "" && cat != "Все" {
		sql += ` AND p.category = $` + strconv.Itoa(n)
		args = append(args, cat)
		n++
	}
	if city := strings.TrimSpace(q.Get("city")); city != "" && !strings.EqualFold(city, "Вся Россия") {
		sql += ` AND lower(p.city) = lower($` + strconv.Itoa(n) + `)`
		args = append(args, city)
		n++
	}
	if v := strings.TrimSpace(q.Get("price_min")); v != "" {
		if min, err := strconv.Atoi(v); err == nil {
			sql += ` AND p.price >= $` + strconv.Itoa(n)
			args = append(args, min)
			n++
		}
	}
	if v := strings.TrimSpace(q.Get("price_max")); v != "" {
		if max, err := strconv.Atoi(v); err == nil {
			sql += ` AND p.price <= $` + strconv.Itoa(n)
			args = append(args, max)
			n++
		}
	}
	if v := strings.TrimSpace(q.Get("rating_min")); v != "" {
		if min, err := strconv.Atoi(v); err == nil && min > 0 {
			sql += ` AND ` + ratingSQL + ` >= $` + strconv.Itoa(n)
			args = append(args, min)
			n++
		}
	}
	if text := strings.TrimSpace(q.Get("q")); text != "" {
		sql += ` AND (p.title ILIKE '%'||$` + strconv.Itoa(n) + `||'%' OR p.short_text ILIKE '%'||$` + strconv.Itoa(n) + `||'%' OR p.description ILIKE '%'||$` + strconv.Itoa(n) + `||'%')`
		args = append(args, text)
		n++
	}
	switch q.Get("sort") {
	case "cheap":
		sql += ` ORDER BY p.price ASC, p.created_at DESC`
	case "expensive":
		sql += ` ORDER BY p.price DESC, p.created_at DESC`
	case "rating":
		sql += ` ORDER BY ` + ratingSQL + ` DESC, p.created_at DESC`
	default:
		sql += ` ORDER BY p.created_at DESC`
	}
	sql += ` LIMIT $` + strconv.Itoa(n)
	args = append(args, 40)
	rows, err := s.pool.Query(r.Context(), sql, args...)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items, err := scanProducts(rows)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := s.attachChildren(r.Context(), items); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func scanProducts(rows pgx.Rows) ([]map[string]any, error) {
	items := []map[string]any{}
	for rows.Next() {
		var id, seller, title, shortText, desc, cat, city, status, username, display, avatar string
		var price, stock, views, rating, sellerRating, reviews, likes int
		var oldPrice *int
		var created time.Time
		var liked bool
		if err := rows.Scan(&id, &seller, &title, &price, &oldPrice, &shortText, &desc, &cat, &city, &stock, &status, &views, &created, &username, &display, &avatar, &rating, &sellerRating, &reviews, &likes, &liked); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id": id, "seller_id": seller, "title": title, "price": price,
			"short_text": shortText, "description": desc, "category": cat, "city": city,
			"stock": stock, "status": status, "views": views,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"rating":     rating, "review_count": reviews, "like_count": likes, "liked": liked,
			"seller": map[string]any{
				"id": seller, "username": username, "display_name": display,
				"avatar_url": avatar, "rating": sellerRating,
			},
			"media": []any{}, "specs": []any{},
		}
		if oldPrice != nil {
			item["old_price"] = *oldPrice
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) attachChildren(ctx context.Context, items []map[string]any) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	byID := map[string]map[string]any{}
	for _, item := range items {
		id := item["id"].(string)
		ids = append(ids, id)
		byID[id] = item
	}
	media, err := s.pool.Query(ctx, `
		SELECT product_id::text, url, kind, position
		FROM product_media WHERE product_id = ANY($1::uuid[])
		ORDER BY position, url`, ids)
	if err != nil {
		return err
	}
	defer media.Close()
	for media.Next() {
		var pid, url, kind string
		var pos int
		if err := media.Scan(&pid, &url, &kind, &pos); err != nil {
			return err
		}
		item := byID[pid]
		item["media"] = append(item["media"].([]any), map[string]any{"url": url, "kind": kind, "position": pos})
	}
	specs, err := s.pool.Query(ctx, `
		SELECT product_id::text, spec_key, spec_value, position
		FROM product_specs WHERE product_id = ANY($1::uuid[])
		ORDER BY position, spec_key`, ids)
	if err != nil {
		return err
	}
	defer specs.Close()
	for specs.Next() {
		var pid, key, val string
		var pos int
		if err := specs.Scan(&pid, &key, &val, &pos); err != nil {
			return err
		}
		item := byID[pid]
		item["specs"] = append(item["specs"].([]any), map[string]any{"key": key, "value": val, "position": pos})
	}
	return nil
}

func (s *Service) Get(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE products SET views = views + 1
		WHERE id=$1::uuid AND deleted_at IS NULL AND seller_id <> $2::uuid`, id, uid)
	item, err := s.one(r.Context(), uid, id)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, item)
}

func (s *Service) one(ctx context.Context, uid, id string) (map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.seller_id::text, p.title, p.price, p.old_price, p.short_text, p.description,
		       p.category, p.city, p.stock, p.status, p.views, p.created_at,
		       u.username, u.display_name, COALESCE(u.avatar_url,''),
		       `+ratingSQL+`, `+sellerRatingSQL+`,
		       COALESCE((SELECT COUNT(*)::int FROM product_reviews rv WHERE rv.product_id = p.id), 0),
		       COALESCE((SELECT COUNT(*)::int FROM product_likes lk WHERE lk.product_id = p.id), 0),
		       EXISTS(SELECT 1 FROM product_likes me WHERE me.product_id = p.id AND me.user_id = $1::uuid)
		FROM products p
		JOIN users u ON u.id = p.seller_id AND u.deleted_at IS NULL
		WHERE p.id = $2::uuid AND p.deleted_at IS NULL`, uid, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanProducts(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, pgx.ErrNoRows
	}
	if err := s.attachChildren(ctx, items); err != nil {
		return nil, err
	}
	return items[0], nil
}

func (s *Service) Create(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	if !s.businessOn(r.Context(), uid) {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Включите режим бизнеса в настройках")
		return
	}
	var req productIn
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if err := normalizeProduct(&req); err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	id := uuid.New()
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `
		INSERT INTO products (id, seller_id, title, price, old_price, short_text, description, category, city, stock, status)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		id, uid, req.Title, req.Price, req.OldPrice, req.ShortText, req.Description, req.Category, req.City, *req.Stock, req.Status)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := writeChildren(r.Context(), tx, id.String(), req); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	item, err := s.one(r.Context(), uid, id.String())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, item)
}

func (s *Service) Update(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	var owner string
	err := s.pool.QueryRow(r.Context(), `SELECT seller_id::text FROM products WHERE id=$1::uuid AND deleted_at IS NULL`, id).Scan(&owner)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if owner != uid {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "only the seller can edit")
		return
	}
	var req productIn
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	if err := normalizeProduct(&req); err != nil {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `
		UPDATE products SET title=$2, price=$3, old_price=$4, short_text=$5, description=$6,
		       category=$7, city=$8, stock=$9, status=$10, updated_at=now()
		WHERE id=$1::uuid`, id, req.Title, req.Price, req.OldPrice, req.ShortText, req.Description, req.Category, req.City, *req.Stock, req.Status)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM product_media WHERE product_id=$1::uuid`, id); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM product_specs WHERE product_id=$1::uuid`, id); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := writeChildren(r.Context(), tx, id, req); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	item, err := s.one(r.Context(), uid, id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, item)
}

func (s *Service) Delete(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE products SET deleted_at=now() WHERE id=$1::uuid AND seller_id=$2::uuid AND deleted_at IS NULL`, id, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) Like(w http.ResponseWriter, r *http.Request) {
	s.setLike(w, r, true)
}

func (s *Service) Unlike(w http.ResponseWriter, r *http.Request) {
	s.setLike(w, r, false)
}

func (s *Service) setLike(w http.ResponseWriter, r *http.Request, on bool) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	var exists bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1::uuid AND deleted_at IS NULL)`, id).Scan(&exists)
	if !exists {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	var err error
	if on {
		_, err = s.pool.Exec(r.Context(), `
			INSERT INTO product_likes (product_id, user_id) VALUES ($1::uuid,$2::uuid)
			ON CONFLICT DO NOTHING`, id, uid)
	} else {
		_, err = s.pool.Exec(r.Context(), `DELETE FROM product_likes WHERE product_id=$1::uuid AND user_id=$2::uuid`, id, uid)
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	item, err := s.one(r.Context(), uid, id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "liked": item["liked"], "like_count": item["like_count"], "rating": item["rating"]})
}

func (s *Service) ListReviews(w http.ResponseWriter, r *http.Request) {
	if _, ok := apiutil.UserIDFromContext(r.Context()); !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	rows, err := s.pool.Query(r.Context(), `
		SELECT rv.id::text, rv.body, rv.sentiment, rv.created_at,
		       u.id::text, u.username, u.display_name, COALESCE(u.avatar_url,'')
		FROM product_reviews rv
		JOIN users u ON u.id = rv.author_id
		WHERE rv.product_id=$1::uuid
		ORDER BY rv.created_at DESC LIMIT 50`, id)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var rid, body, sentiment, uid, username, display, avatar string
		var created time.Time
		if err := rows.Scan(&rid, &body, &sentiment, &created, &uid, &username, &display, &avatar); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": rid, "body": body, "sentiment": sentiment,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"author":     map[string]any{"id": uid, "username": username, "display_name": display, "avatar_url": avatar},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) AddReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	var seller string
	err := s.pool.QueryRow(r.Context(), `SELECT seller_id::text FROM products WHERE id=$1::uuid AND deleted_at IS NULL`, id).Scan(&seller)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if seller == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нельзя оставить отзыв на свой товар")
		return
	}
	var req struct {
		Body      string `json:"body"`
		Sentiment string `json:"sentiment"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" || utf8.RuneCountInString(req.Body) > 2000 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "отзыв 1..2000")
		return
	}
	switch req.Sentiment {
	case "", "positive", "negative":
	default:
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "sentiment: positive|negative")
		return
	}
	var rid string
	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO product_reviews (product_id, author_id, body, sentiment)
		VALUES ($1::uuid,$2::uuid,$3,$4) RETURNING id::text, created_at`, id, uid, req.Body, req.Sentiment).Scan(&rid, &created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{"id": rid, "body": req.Body, "sentiment": req.Sentiment, "created_at": created.UTC().Format(time.RFC3339Nano)})
}

func (s *Service) Buy(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	id := chi.URLParam(r, "id")
	var seller, title string
	var price, stock int
	err := s.pool.QueryRow(r.Context(), `
		SELECT seller_id::text, title, price, stock FROM products
		WHERE id=$1::uuid AND deleted_at IS NULL AND status='active'`, id).Scan(&seller, &title, &price, &stock)
	if err == pgx.ErrNoRows {
		apiutil.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if seller == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Это ваш товар")
		return
	}
	if stock <= 0 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "Нет в наличии")
		return
	}
	var blocked bool
	_ = s.pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM blocks
			WHERE (blocker_id=$1::uuid AND blocked_id=$2::uuid) OR (blocker_id=$2::uuid AND blocked_id=$1::uuid)
		)`, uid, seller).Scan(&blocked)
	if blocked {
		apiutil.Error(w, http.StatusForbidden, "forbidden", "Нельзя написать этому продавцу")
		return
	}
	convID, err := s.openChat(r.Context(), uid, seller, title, price)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	var orderID string
	var created time.Time
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO product_orders (product_id, buyer_id, seller_id, conversation_id, status)
		VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'requested')
		RETURNING id::text, created_at`, id, uid, seller, convID).Scan(&orderID, &created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusCreated, map[string]any{
		"id": orderID, "status": "requested", "conversation_id": convID,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) openChat(ctx context.Context, buyer, seller, title string, price int) (string, error) {
	var convID string
	err := s.pool.QueryRow(ctx, `
		SELECT c.id::text
		FROM conversations c
		JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1::uuid
		JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2::uuid
		WHERE (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
		LIMIT 1`, buyer, seller).Scan(&convID)
	if err == pgx.ErrNoRows {
		nid := uuid.New()
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return "", err
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `INSERT INTO conversations (id) VALUES ($1)`, nid); err != nil {
			return "", err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO conversation_members (conversation_id, user_id, inbox_state) VALUES ($1,$2,'inbox'), ($1,$3,'inbox')`,
			nid, buyer, seller); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		convID = nid.String()
	} else if err != nil {
		return "", err
	}
	body := "Хочу купить: " + title + " · " + strconv.Itoa(price) + " ₽"
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO messages (id, conversation_id, sender_id, body) VALUES ($1,$2::uuid,$3::uuid,$4)`,
		uuid.New(), convID, buyer, body); err != nil {
		return "", err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1::uuid`, convID)
	return convID, nil
}

func (s *Service) Cabinet(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	enabled := s.businessOn(r.Context(), uid)
	var views, likes, reviews int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(views),0)::int,
		       COALESCE((SELECT COUNT(*)::int FROM product_likes l JOIN products p ON p.id=l.product_id WHERE p.seller_id=$1::uuid AND p.deleted_at IS NULL),0),
		       COALESCE((SELECT COUNT(*)::int FROM product_reviews rv JOIN products p ON p.id=rv.product_id WHERE p.seller_id=$1::uuid AND p.deleted_at IS NULL),0)
		FROM products WHERE seller_id=$1::uuid AND deleted_at IS NULL`, uid).Scan(&views, &likes, &reviews)
	rows, err := s.pool.Query(r.Context(), `
		SELECT o.id::text, o.status, o.created_at, COALESCE(o.conversation_id::text,''),
		       p.id::text, p.title, p.price, u.username, u.display_name
		FROM product_orders o
		JOIN products p ON p.id = o.product_id
		JOIN users u ON u.id = o.buyer_id
		WHERE o.seller_id=$1::uuid
		ORDER BY o.created_at DESC LIMIT 50`, uid)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	orders := []map[string]any{}
	for rows.Next() {
		var id, status, conv, pid, title, username, display string
		var price int
		var created time.Time
		if err := rows.Scan(&id, &status, &created, &conv, &pid, &title, &price, &username, &display); err != nil {
			apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		orders = append(orders, map[string]any{
			"id": id, "status": status, "created_at": created.UTC().Format(time.RFC3339Nano),
			"conversation_id": conv, "product_id": pid, "title": title, "price": price,
			"buyer": map[string]any{"username": username, "display_name": display},
		})
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"business_mode": enabled,
		"stats":         map[string]any{"views": views, "likes": likes, "reviews": reviews},
		"orders":        orders,
	})
}

func (s *Service) SetOrderStatus(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	switch req.Status {
	case "requested", "accepted", "done", "cancelled":
	default:
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "status: requested|accepted|done|cancelled")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE product_orders SET status=$3 WHERE id=$1::uuid AND seller_id=$2::uuid`, chi.URLParam(r, "id"), uid, req.Status)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		apiutil.Error(w, http.StatusNotFound, "not_found", "order not found")
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"ok": true, "status": req.Status})
}

func (s *Service) businessOn(ctx context.Context, uid string) bool {
	var on bool
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(business_mode,false) FROM users WHERE id=$1::uuid`, uid).Scan(&on)
	return on
}

func normalizeProduct(req *productIn) error {
	req.Title = strings.TrimSpace(req.Title)
	req.ShortText = strings.TrimSpace(req.ShortText)
	req.Description = strings.TrimSpace(req.Description)
	req.Category = strings.TrimSpace(req.Category)
	req.City = strings.TrimSpace(req.City)
	req.Status = strings.TrimSpace(req.Status)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > 120 {
		return errStr("название 1..120")
	}
	if req.Price < 0 {
		return errStr("цена не может быть отрицательной")
	}
	if req.OldPrice != nil && *req.OldPrice < 0 {
		return errStr("старая цена не может быть отрицательной")
	}
	if utf8.RuneCountInString(req.ShortText) > 280 {
		return errStr("короткое описание до 280 символов")
	}
	if utf8.RuneCountInString(req.Description) > 8000 {
		return errStr("описание слишком длинное")
	}
	if req.Category == "" {
		req.Category = "Разное"
	}
	if req.Stock == nil {
		one := 1
		req.Stock = &one
	}
	if *req.Stock < 0 {
		return errStr("остаток не может быть отрицательным")
	}
	switch req.Status {
	case "", "active", "hidden", "sold", "draft":
		if req.Status == "" {
			req.Status = "active"
		}
	default:
		return errStr("статус: active|hidden|sold|draft")
	}
	if len(req.Media) > 8 {
		return errStr("не больше 8 файлов")
	}
	for i := range req.Media {
		req.Media[i].URL = strings.TrimSpace(req.Media[i].URL)
		if req.Media[i].URL == "" {
			return errStr("пустая ссылка на файл")
		}
		if req.Media[i].Kind != "video" {
			req.Media[i].Kind = "photo"
		}
	}
	if len(req.Specs) > 30 {
		return errStr("не больше 30 характеристик")
	}
	clean := req.Specs[:0]
	for _, sp := range req.Specs {
		sp.Key = strings.TrimSpace(sp.Key)
		sp.Value = strings.TrimSpace(sp.Value)
		if sp.Key == "" && sp.Value == "" {
			continue
		}
		if sp.Key == "" || sp.Value == "" || utf8.RuneCountInString(sp.Key) > 80 || utf8.RuneCountInString(sp.Value) > 120 {
			return errStr("характеристика: ключ и значение")
		}
		clean = append(clean, sp)
	}
	req.Specs = clean
	return nil
}

func writeChildren(ctx context.Context, tx pgx.Tx, productID string, req productIn) error {
	for i, m := range req.Media {
		if _, err := tx.Exec(ctx, `
			INSERT INTO product_media (product_id, url, kind, position) VALUES ($1::uuid,$2,$3,$4)`,
			productID, m.URL, m.Kind, i); err != nil {
			return err
		}
	}
	for i, sp := range req.Specs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO product_specs (product_id, spec_key, spec_value, position) VALUES ($1::uuid,$2,$3,$4)`,
			productID, sp.Key, sp.Value, i); err != nil {
			return err
		}
	}
	return nil
}

type strErr string

func (e strErr) Error() string { return string(e) }

func errStr(s string) error { return strErr(s) }
