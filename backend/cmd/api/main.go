package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/auth"
	"github.com/hub-socium/hub/backend/internal/chat"
	"github.com/hub-socium/hub/backend/internal/config"
	"github.com/hub-socium/hub/backend/internal/db"
	"github.com/hub-socium/hub/backend/internal/embedpg"
	"github.com/hub-socium/hub/backend/internal/feed"
	"github.com/hub-socium/hub/backend/internal/media"
	httpx "github.com/hub-socium/hub/backend/internal/http"
	"github.com/hub-socium/hub/backend/internal/sentryx"
	"github.com/hub-socium/hub/backend/internal/posts"
	"github.com/hub-socium/hub/backend/internal/users"
	"github.com/hub-socium/hub/backend/internal/mod"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/hub-socium/hub/backend/internal/waitlist"
	"github.com/hub-socium/hub/backend/internal/stories"
	"github.com/hub-socium/hub/backend/internal/explore"
	"github.com/hub-socium/hub/backend/internal/clips"
	"github.com/hub-socium/hub/backend/internal/channels"
	"github.com/hub-socium/hub/backend/internal/voicerooms"
	"github.com/hub-socium/hub/backend/internal/marketads"
	"github.com/hub-socium/hub/backend/internal/meetups"
	"github.com/hub-socium/hub/backend/internal/nearby"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	_ = godotenv.Load()
	migrateOnly := flag.Bool("migrate-only", false, "run migrations and exit")
	seedOnly := flag.Bool("seed-only", false, "seed demo user and exit")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	if sentryx.Init() {
		defer sentryx.Flush()
	}

	var embedded *embedpg.Instance
	if embedpg.ShouldStart(cfg.DatabaseURL) {
		inst, err := embedpg.Start(filepath.Join(".data", "pg"))
		if err != nil {
			slog.Error("embedded postgres", "err", err)
			os.Exit(1)
		}
		embedded = inst
		cfg.DatabaseURL = inst.URL
		defer func() {
			if err := embedded.Stop(); err != nil {
				slog.Warn("embedded postgres stop", "err", err)
			}
		}()
	}

	ctx := context.Background()
	var pool *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		p, err := db.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			slog.Warn("database unavailable; /healthz works, /v1 returns 503", "err", err)
		} else {
			pool = p
		}
	} else {
		slog.Warn("DATABASE_URL empty; starting without DB")
	}

	migrationsDir := findMigrations()
	if pool != nil && migrationsDir != "" {
		if err := db.Migrate(ctx, pool, migrationsDir); err != nil {
			slog.Error("migrate", "err", err)
			os.Exit(1)
		}
		slog.Info("migrations applied", "dir", migrationsDir)
	}

	if *migrateOnly {
		if pool == nil {
			slog.Error("DATABASE_URL required for migrate")
			os.Exit(1)
		}
		return
	}

	// Auto-seed when embedded, SEED_DEMO=1, or -seed-only.
	wantSeed := *seedOnly || os.Getenv("SEED_DEMO") == "1" || embedded != nil
	if wantSeed {
		if pool == nil {
			slog.Error("DATABASE_URL required for seed")
			os.Exit(1)
		}
		if err := seedDemo(ctx, pool); err != nil {
			slog.Error("seed", "err", err)
			os.Exit(1)
		}
		slog.Info("demo user seeded", "username", "филипп", "password", "demo")
		if *seedOnly {
			return
		}
	}

	authSvc := auth.NewService(pool, cfg.JWTSecret, cfg.AccessTTLMin, cfg.RefreshTTLDays, cfg.RequireInvite)
	usersSvc := users.NewService(pool)
	activitySvc := activity.NewService(pool)
	postsSvc := posts.NewService(pool, activitySvc)
	feedSvc := feed.NewService(pool)
	chatSvc := chat.NewService(pool)
	waitlistSvc := waitlist.NewService(pool)
	modSvc := mod.NewService(pool, cfg.ModToken)
	pushSvc := push.NewService(pool, cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	chatSvc.SetPush(pushSvc)
	usersSvc.SetPush(pushSvc)
	postsSvc.BindPush(pushSvc)
	storiesSvc := stories.NewService(pool)
	exploreSvc := explore.NewService(pool)
	clipsSvc := clips.NewService(pool)
	channelsSvc := channels.NewService(pool)
	voiceRoomsSvc := voicerooms.NewService(pool)
	marketAdsSvc := marketads.NewService(pool)
	meetupsSvc := meetups.NewService(pool)
	nearbySvc := nearby.New(pool)
	var mediaSvc *media.Service
	if pool != nil {
		ms, err := media.NewService(pool, filepath.Join(".data", "media"))
		if err != nil {
			slog.Error("media store", "err", err)
			os.Exit(1)
		}
		mediaSvc = ms
	}

	handler := httpx.NewRouter(httpx.Deps{
		Config:   cfg,
		Pool:     pool,
		Auth:     authSvc,
		Users:    usersSvc,
		Posts:    postsSvc,
		Feed:     feedSvc,
		Chat:     chatSvc,
		Activity: activitySvc,
		Media:    mediaSvc,
		Waitlist: waitlistSvc,
		Mod:      modSvc,
		Push:     pushSvc,
		Stories:   storiesSvc,
		Explore:   exploreSvc,
		Clips:      clipsSvc,
		Channels:   channelsSvc,
		VoiceRooms: voiceRoomsSvc,
		MarketAds:  marketAdsSvc,
		Meetups:    meetupsSvc,
		Nearby:     nearbySvc,
	})

	runCtx, runCancel := context.WithCancel(context.Background())
	defer runCancel()
	if pool != nil {
		postsSvc.StartScheduleWorker(runCtx)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("hub api listening", "addr", cfg.HTTPAddr, "db", pool != nil, "embedded_pg", embedded != nil)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	if pool != nil {
		pool.Close()
	}
}

func findMigrations() string {
	candidates := []string{
		"migrations",
		filepath.Join("..", "migrations"),
		filepath.Join("..", "..", "migrations"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "..", "migrations"))
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}

func seedDemo(ctx context.Context, pool *pgxpool.Pool) error {
	hash, err := bcrypt.GenerateFromPassword([]byte("demo"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	var userID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, phone, username, password_hash, display_name, bio)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
		RETURNING id::text`,
		"philip@hub.app", "+79001234567", "филипп", string(hash), "Филипп", "Hub demo").Scan(&userID)
	if err != nil {
		return err
	}

	var peerID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, display_name, bio)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id::text`,
		"anna@hub.app", "anna_k", string(hash), "Анна", "Дизайн · путешествия").Scan(&peerID)
	if err != nil {
		return err
	}

	var peer2 string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, display_name, bio)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id::text`,
		"masha@hub.app", "masha", string(hash), "Мария", "Пишу о жизни в городе").Scan(&peer2)
	if err != nil {
		return err
	}

	var peer3 string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, display_name, bio)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id::text`,
		"ivan@hub.app", "ivan_spb", string(hash), "Иван Смирнов", "СПб · фото").Scan(&peer3)
	if err != nil {
		return err
	}

	var peer4 string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash, display_name, bio)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING id::text`,
		"oleg@hub.app", "oleg_msk", string(hash), "Олег Петров", "Москва · стартапы").Scan(&peer4)
	if err != nil {
		return err
	}

	// Profile facets for people search filters (idempotent upsert of birth_date/gender/city)
	_, _ = pool.Exec(ctx, `
		UPDATE users SET birth_date = $2::date, gender = $3, city = $4
		WHERE id = $1::uuid`, userID, "1992-05-14", "male", "Москва")
	_, _ = pool.Exec(ctx, `
		UPDATE users SET birth_date = $2::date, gender = $3, city = $4
		WHERE id = $1::uuid`, peerID, "1995-08-22", "female", "Санкт-Петербург")
	_, _ = pool.Exec(ctx, `
		UPDATE users SET birth_date = $2::date, gender = $3, city = $4
		WHERE id = $1::uuid`, peer2, "1998-03-03", "female", "Екатеринбург")
	_, _ = pool.Exec(ctx, `
		UPDATE users SET birth_date = $2::date, gender = $3, city = $4
		WHERE id = $1::uuid`, peer3, "1990-11-30", "male", "Санкт-Петербург")
	_, _ = pool.Exec(ctx, `
		UPDATE users SET birth_date = $2::date, gender = $3, city = $4
		WHERE id = $1::uuid`, peer4, "1988-01-09", "male", "Казань")

	// Extra follows so following=1 search has more than anna/masha
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, userID, peer3)
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, userID, peer4)

	// Welcome post if none yet for demo user.
	var n int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM posts WHERE author_id = $1::uuid AND deleted_at IS NULL`, userID).Scan(&n)
	var postID string
	if n == 0 {
		err = pool.QueryRow(ctx, `
			INSERT INTO posts (author_id, body)
			VALUES ($1::uuid, $2) RETURNING id::text`,
			userID, "Привет, Hub! Демо-пост — лента и API работают.").Scan(&postID)
		if err != nil {
			return err
		}
	} else {
		_ = pool.QueryRow(ctx, `
			SELECT id::text FROM posts WHERE author_id = $1::uuid AND deleted_at IS NULL
			ORDER BY created_at ASC LIMIT 1`, userID).Scan(&postID)
	}

	// Follow graph (anna/masha → филипп) for activity; филипп → peers so following-feed is non-empty
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, peerID, userID)
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, peer2, userID)
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, userID, peerID)
	_, _ = pool.Exec(ctx, `
		INSERT INTO follows (follower_id, followee_id)
		VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, userID, peer2)

	// Sample posts from peers (once) so demo feed has more than self posts
	var peerPosts int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM posts
		WHERE author_id IN ($1::uuid, $2::uuid) AND deleted_at IS NULL`, peerID, peer2).Scan(&peerPosts)
	if peerPosts == 0 {
		_, err = pool.Exec(ctx, `
			INSERT INTO posts (author_id, body) VALUES
			  ($1::uuid, 'Доброе утро из Петербурга ☕️'),
			  ($1::uuid, 'Новый макет в Figma — почти Threads, но наш Hub.'),
			  ($2::uuid, 'Кто-нибудь в Парке Горького сегодня?'),
			  ($2::uuid, 'Городской дневник: дождь и хорошая книга.')
		`, peerID, peer2)
		if err != nil {
			return err
		}
	}

	// Seed DMs once
	var convCount int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM conversation_members WHERE user_id = $1::uuid`, userID).Scan(&convCount)
	if convCount == 0 {
		if err := seedDM(ctx, pool, userID, peerID,
			[]dmMsg{
				{sender: peerID, body: "Привет! Как тебе Hub?"},
				{sender: userID, body: "Круто, как раз тестирую сообщения 👋"},
				{sender: peerID, body: "Отлично — напиши, если что-то сломается"},
			}); err != nil {
			return err
		}
		if err := seedDM(ctx, pool, userID, peer2,
			[]dmMsg{
				{sender: peer2, body: "Завтра кофе?"},
				{sender: userID, body: "Давай в 11 у Парка Горького"},
			}); err != nil {
			return err
		}
	}

	// Seed activities once
	var actCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM activities WHERE user_id = $1::uuid`, userID).Scan(&actCount)
	if actCount == 0 && postID != "" {
		_, err = pool.Exec(ctx, `
			INSERT INTO activities (user_id, actor_id, type, post_id, meta)
			VALUES
			  ($1::uuid, $2::uuid, 'follow', NULL, '{}'::jsonb),
			  ($1::uuid, $3::uuid, 'like', $4::uuid, '{}'::jsonb),
			  ($1::uuid, $2::uuid, 'reply', $4::uuid, '{"text":"Супер пост!"}'::jsonb),
			  ($1::uuid, $3::uuid, 'mention', $4::uuid, '{"text":"@филипп смотри"}'::jsonb)
		`, userID, peerID, peer2, postID)
		if err != nil {
			return err
		}
		// Also a like row so counters match
		_, _ = pool.Exec(ctx, `
			INSERT INTO post_likes (post_id, user_id) VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING`, postID, peer2)
		_, _ = pool.Exec(ctx, `
			INSERT INTO comments (post_id, author_id, body)
			VALUES ($1::uuid, $2::uuid, 'Супер пост!')`, postID, peerID)
	}

	return nil
}

type dmMsg struct {
	sender string
	body   string
}

func seedDM(ctx context.Context, pool *pgxpool.Pool, a, b string, msgs []dmMsg) error {
	var convID string
	err := pool.QueryRow(ctx, `INSERT INTO conversations DEFAULT VALUES RETURNING id::text`).Scan(&convID)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO conversation_members (conversation_id, user_id)
		VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)`, convID, a, b)
	if err != nil {
		return err
	}
	var last time.Time
	for i, m := range msgs {
		var created time.Time
		err := pool.QueryRow(ctx, `
			INSERT INTO messages (conversation_id, sender_id, body, created_at)
			VALUES ($1::uuid, $2::uuid, $3, now() - (($4::int) * interval '1 minute'))
			RETURNING created_at`, convID, m.sender, m.body, len(msgs)-i).Scan(&created)
		if err != nil {
			return err
		}
		last = created
	}
	_, _ = pool.Exec(ctx, `UPDATE conversations SET updated_at = $1 WHERE id = $2::uuid`, last, convID)
	_, _ = pool.Exec(ctx, `
		UPDATE conversation_members SET last_read_at = $1
		WHERE conversation_id = $2::uuid AND user_id = $3::uuid`, last, convID, a)
	return nil
}
