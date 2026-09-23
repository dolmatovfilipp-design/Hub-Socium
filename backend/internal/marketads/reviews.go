package marketads

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/apiutil"
)

func (s *Service) CreateReview(w http.ResponseWriter, r *http.Request) {
	uid, ok := apiutil.UserIDFromContext(r.Context())
	if !ok {
		apiutil.Error(w, http.StatusUnauthorized, "unauthorized", "missing user")
		return
	}
	sellerID := chi.URLParam(r, "id")
	if sellerID == uid {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "cannot review yourself")
		return
	}
	var req struct {
		Rating int    `json:"rating"`
		Body   string `json:"body"`
	}
	if err := apiutil.DecodeJSON(r, &req); err != nil {
		apiutil.Error(w, http.StatusBadRequest, "bad_request", "invalid json")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Rating < 1 || req.Rating > 5 {
		apiutil.Error(w, http.StatusUnprocessableEntity, "validation_error", "rating 1..5")
		return
	}
	id := uuid.New()
	var created time.Time
	err := s.pool.QueryRow(r.Context(), `
		INSERT INTO seller_reviews (id, seller_id, reviewer_id, rating, body)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5)
		ON CONFLICT (seller_id, reviewer_id) DO UPDATE SET rating=EXCLUDED.rating, body=EXCLUDED.body, created_at=now()
		RETURNING id, created_at`, id, sellerID, uid, req.Rating, req.Body).Scan(&id, &created)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"id": id.String(), "seller_id": sellerID, "rating": req.Rating, "body": req.Body,
		"created_at": created.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Service) ListReviews(w http.ResponseWriter, r *http.Request) {
	sellerID := chi.URLParam(r, "id")
	rows, err := s.pool.Query(r.Context(), `
		SELECT sr.id::text, sr.rating, sr.body, sr.created_at, u.id::text, u.username, u.display_name
		FROM seller_reviews sr JOIN users u ON u.id = sr.reviewer_id
		WHERE sr.seller_id=$1::uuid ORDER BY sr.created_at DESC LIMIT 50`, sellerID)
	if err != nil {
		apiutil.Error(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	var sum float64
	for rows.Next() {
		var id, body, rid, uname, dname string
		var rating int
		var created time.Time
		if rows.Scan(&id, &rating, &body, &created, &rid, &uname, &dname) != nil {
			continue
		}
		sum += float64(rating)
		items = append(items, map[string]any{
			"id": id, "rating": rating, "body": body,
			"created_at": created.UTC().Format(time.RFC3339Nano),
			"reviewer": map[string]any{"id": rid, "username": uname, "display_name": dname},
		})
	}
	avg := 0.0
	if n := len(items); n > 0 {
		avg = sum / float64(n)
	}
	apiutil.JSON(w, http.StatusOK, map[string]any{"items": items, "average": avg, "count": len(items)})
}
