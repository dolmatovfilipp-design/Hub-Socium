package httpx

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/apiutil"
	"github.com/hub-socium/hub/backend/internal/auth"
	"github.com/hub-socium/hub/backend/internal/chat"
	"github.com/hub-socium/hub/backend/internal/config"
	"github.com/hub-socium/hub/backend/internal/feed"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/hub-socium/hub/backend/internal/posts"
	"github.com/hub-socium/hub/backend/internal/users"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Deps wires handlers.
type Deps struct {
	Config   config.Config
	Pool     *pgxpool.Pool // may be nil
	Auth     *auth.Service
	Users    *users.Service
	Posts    *posts.Service
	Feed     *feed.Service
	Chat     *chat.Service
	Activity *activity.Service
	Media    *media.Service
}

// NewRouter builds the chi mux.
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(RequestID)
	r.Use(Recoverer)
	r.Use(Logger)
	r.Use(chimw.RealIP)
	origins := d.Config.CORSOrigins
	allowAll := false
	for _, o := range origins {
		if o == "*" {
			allowAll = true
			break
		}
	}
	if allowAll {
		// Reflect request Origin so credentialed browser calls work in dev.
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				origin := r.Header.Get("Origin")
				if origin == "" {
					origin = "*"
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Request-ID")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
				w.Header().Set("Vary", "Origin")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
	} else {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   origins,
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
			ExposedHeaders:   []string{"X-Request-ID"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	r.Get("/healthz", Healthz(d.Pool))

	authMW := d.Auth.Middleware
	requireDB := RequireDB(d.Pool)

	r.Route("/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.With(requireDB).Post("/register", d.Auth.Register)
			r.With(requireDB).Post("/login", d.Auth.Login)
			r.With(requireDB).Post("/refresh", d.Auth.Refresh)
			r.With(requireDB).Post("/logout", d.Auth.Logout)
		})

		r.With(requireDB, authMW).Get("/users/me", d.Users.Me)
		r.With(requireDB, authMW).Patch("/users/me", d.Users.UpdateMe)
		r.With(requireDB).Get("/users/{username}", d.Users.GetByUsername)

		r.With(requireDB, authMW).Post("/posts", d.Posts.Create)
		r.With(requireDB).Get("/posts/{id}", d.Posts.Get)
		r.With(requireDB, authMW).Post("/posts/{id}/like", d.Posts.Like)
		r.With(requireDB, authMW).Delete("/posts/{id}/like", d.Posts.Unlike)
		r.With(requireDB, authMW).Post("/posts/{id}/comments", d.Posts.AddComment)
		r.With(requireDB).Get("/posts/{id}/comments", d.Posts.ListComments)

		r.With(requireDB, authMW).Get("/feed", d.Feed.Following)

		r.With(requireDB, authMW).Get("/conversations", d.Chat.ListConversations)
		r.With(requireDB, authMW).Post("/conversations", d.Chat.CreateConversation)
		r.With(requireDB, authMW).Get("/conversations/{id}/messages", d.Chat.ListMessages)
		r.With(requireDB, authMW).Post("/conversations/{id}/messages", d.Chat.SendMessage)
		r.With(requireDB, authMW).Post("/conversations/{id}/read", d.Chat.MarkRead)

		r.With(requireDB, authMW).Get("/activity", d.Activity.List)
		r.With(requireDB, authMW).Post("/activity/read", d.Activity.MarkRead)

		if d.Media != nil {
			r.With(requireDB, authMW).Post("/media/upload", d.Media.Upload)
			r.With(requireDB).Get("/media/{id}", d.Media.Get)
		}
		r.With(authMW).Post("/media/presign", MediaPresign)
	})

	return r
}

func Healthz(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := map[string]any{"status": "ok"}
		if pool == nil {
			status["db"] = "disconnected"
			apiutil.JSON(w, http.StatusOK, status)
			return
		}
		if err := pool.Ping(r.Context()); err != nil {
			status["status"] = "degraded"
			status["db"] = "error"
			apiutil.JSON(w, http.StatusOK, status)
			return
		}
		status["db"] = "ok"
		apiutil.JSON(w, http.StatusOK, status)
	}
}

func RequireDB(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if pool == nil {
				apiutil.Error(w, http.StatusServiceUnavailable, "db_unavailable", "database is not connected; use make run-embedded or set DATABASE_URL")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func MediaPresign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ContentType string `json:"content_type"`
		ByteSize    int64  `json:"byte_size"`
	}
	_ = apiutil.DecodeJSON(r, &req)
	if req.ContentType == "" {
		req.ContentType = "application/octet-stream"
	}
	key := "uploads/stub/" + uuid.NewString()
	apiutil.JSON(w, http.StatusOK, map[string]any{
		"upload_url":   "https://s3.stub.local/" + key + "?X-Amz-Signature=stub",
		"public_url":   "https://cdn.stub.local/" + key,
		"object_key":   key,
		"expires_in":   900,
		"content_type": req.ContentType,
		"byte_size":    req.ByteSize,
	})
}
