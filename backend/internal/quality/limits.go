package quality

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New-account windows and caps (S16). Documented in docs/RATE-LIMITS.md.
const (
	NewAccountHours     = 24
	NewAccountMaxFollow = 20
	NewAccountMaxDM     = 10
	FollowPerHour       = 60
	DMCreatePerHour     = 30
	PostPerHour         = 30
	GlobalIPPerMin      = 120
)

func AccountAge(ctx context.Context, pool *pgxpool.Pool, userID string) (time.Duration, error) {
	var created time.Time
	err := pool.QueryRow(ctx, `SELECT created_at FROM users WHERE id=$1::uuid`, userID).Scan(&created)
	if err != nil {
		return 0, err
	}
	return time.Since(created), nil
}

func IsNewAccount(age time.Duration) bool {
	return age < NewAccountHours*time.Hour
}

func CountFollowsSince(ctx context.Context, pool *pgxpool.Pool, userID string, since time.Time) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM follows WHERE follower_id=$1::uuid AND created_at >= $2`, userID, since).Scan(&n)
	return n, err
}

func CountDMCreatesSince(ctx context.Context, pool *pgxpool.Pool, userID string, since time.Time) (int, error) {
	var n int
	// conversations where user is member and conversation created recently
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM conversations c
		JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1::uuid
		WHERE c.created_at >= $2`, userID, since).Scan(&n)
	return n, err
}

func CountPostsSince(ctx context.Context, pool *pgxpool.Pool, userID string, since time.Time) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM posts WHERE author_id=$1::uuid AND created_at >= $2 AND deleted_at IS NULL`, userID, since).Scan(&n)
	return n, err
}
