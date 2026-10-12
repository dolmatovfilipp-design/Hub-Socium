package contentgate

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NormalizeAge maps composer values to posts.age_rating: all | 12 | 18.
func NormalizeAge(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "all", "0", "обычный", "normal":
		return "all", true
	case "12", "12+", "teen":
		return "12", true
	case "18", "18+", "adult":
		return "18", true
	default:
		return "", false
	}
}

// Visible is the viewer rule. Callers always allow the author through first.
// parental hides 12+ and 18+. show_adult is required for 18+.
func Visible(rating string, showAdult, parental bool) bool {
	switch rating {
	case "18":
		return showAdult && !parental
	case "12":
		return !parental
	default:
		return true
	}
}

// Load reads the viewer's content gates. Missing row = defaults (no adult, no parental).
func Load(ctx context.Context, pool *pgxpool.Pool, userID string) (showAdult, parental bool) {
	if pool == nil || userID == "" {
		return false, false
	}
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(show_adult,false), COALESCE(parental_enabled,false)
		FROM users WHERE id=$1::uuid`, userID).Scan(&showAdult, &parental)
	return showAdult, parental
}

// FilterSQL hides posts the viewer should not see. Own posts stay visible.
// viewerExpr is a SQL expression for the viewer id, e.g. "$1::uuid".
// showArg and parentalArg are 1-based placeholder indexes for the two bools.
func FilterSQL(alias, viewerExpr string, showArg, parentalArg int) string {
	return fmt.Sprintf(` AND (
    %s.author_id = %s
    OR (
      CASE COALESCE(%s.age_rating,'all')
        WHEN '18' THEN $%d::bool AND NOT $%d::bool
        WHEN '12' THEN NOT $%d::bool
        ELSE TRUE
      END
    )
  )`, alias, viewerExpr, alias, showArg, parentalArg, parentalArg)
}
