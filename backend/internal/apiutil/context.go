package apiutil

import "context"

type ctxKey int

const (
	ctxRequestID ctxKey = iota
	ctxUserID
	ctxUsername
)

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxRequestID, id)
}

func RequestIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxRequestID).(string)
	return v, ok && v != ""
}

func WithUser(ctx context.Context, userID, username string) context.Context {
	ctx = context.WithValue(ctx, ctxUserID, userID)
	ctx = context.WithValue(ctx, ctxUsername, username)
	return ctx
}

func UserIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxUserID).(string)
	return v, ok && v != ""
}

func UsernameFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(ctxUsername).(string)
	return v, ok && v != ""
}
