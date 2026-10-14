package accountgate

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EmailVerified is true only after the server accepted an email code.
func EmailVerified(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, error) {
	var verified bool
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(email_verified, false)
		FROM users
		WHERE id = $1::uuid AND deleted_at IS NULL`, userID).Scan(&verified)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return verified, nil
}
