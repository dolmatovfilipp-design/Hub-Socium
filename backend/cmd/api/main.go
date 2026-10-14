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
	"github.com/hub-socium/hub/backend/internal/assist"
	"github.com/hub-socium/hub/backend/internal/auth"
	"github.com/hub-socium/hub/backend/internal/business"
	"github.com/hub-socium/hub/backend/internal/channels"
	"github.com/hub-socium/hub/backend/internal/chat"
	"github.com/hub-socium/hub/backend/internal/clips"
	"github.com/hub-socium/hub/backend/internal/config"
	"github.com/hub-socium/hub/backend/internal/contacts"
	"github.com/hub-socium/hub/backend/internal/db"
	"github.com/hub-socium/hub/backend/internal/embedpg"
	"github.com/hub-socium/hub/backend/internal/explore"
	"github.com/hub-socium/hub/backend/internal/feed"
	"github.com/hub-socium/hub/backend/internal/guest"
	httpx "github.com/hub-socium/hub/backend/internal/http"
	"github.com/hub-socium/hub/backend/internal/marketads"
	"github.com/hub-socium/hub/backend/internal/media"
	"github.com/hub-socium/hub/backend/internal/mod"
	"github.com/hub-socium/hub/backend/internal/nearby"
	"github.com/hub-socium/hub/backend/internal/payments"
	"github.com/hub-socium/hub/backend/internal/posts"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/hub-socium/hub/backend/internal/sentryx"
	"github.com/hub-socium/hub/backend/internal/stories"
	"github.com/hub-socium/hub/backend/internal/users"
	"github.com/hub-socium/hub/backend/internal/voice"
	"github.com/hub-socium/hub/backend/internal/voicerooms"
	"github.com/hub-socium/hub/backend/internal/waitlist"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	migrateOnly := flag.Bool("migrate-only", false, "run migrations and exit")
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
		p, err := db.ConnectRetry(ctx, cfg.DatabaseURL, 2*time.Minute)
		if err != nil {
			slog.Error("database unavailable", "err", err)
			os.Exit(1)
		}
		pool = p
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

	authSvc := auth.NewService(pool, cfg.JWTSecret, cfg.AccessTTLMin, cfg.RefreshTTLDays, cfg.RequireInvite)
	usersSvc := users.NewService(pool)
	activitySvc := activity.NewService(pool)
	postsSvc := posts.NewService(pool, activitySvc)
	feedSvc := feed.NewService(pool)
	chatSvc := chat.NewService(pool)
	chatSvc.ConfigureSpeech(chat.SpeechConfig{
		STTURL:        cfg.STTURL,
		STTLanguage:   cfg.STTLanguage,
		STTModel:      cfg.STTModel,
		MediaDir:      cfg.MediaDir,
		TranslateURL:  cfg.TranslateURL,
		TranslateKey:  cfg.TranslateKey,
		OpenAIKey:     cfg.OpenAIAPIKey,
		OpenAIBase:    cfg.OpenAIBaseURL,
		YandexKey:     cfg.YandexGPTAPIKey,
		YandexFolder:  cfg.YandexGPTFolder,
		AllowFallback: cfg.TranslateFallback,
	})
	waitlistSvc := waitlist.NewService(pool)
	modSvc := mod.NewService(pool, cfg.ModToken)
	pushSvc := push.NewService(pool, cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	chatSvc.SetPush(pushSvc)
	if hub := chatSvc.WS(); hub != nil {
		hub.SetTokenParser(authSvc.ParseAccessToken)
	}
	usersSvc.SetPush(pushSvc)
	postsSvc.BindPush(pushSvc)
	storiesSvc := stories.NewService(pool)
	exploreSvc := explore.NewService(pool)
	clipsSvc := clips.NewService(pool)
	channelsSvc := channels.NewService(pool)
	voiceRoomsSvc := voicerooms.NewService(pool)
	marketAdsSvc := marketads.NewService(pool)
	nearbySvc := nearby.New(pool)
	contactsSvc := contacts.New(pool)
	guestSvc := guest.New(pool)
	var mediaSvc *media.Service
	if pool != nil {
		ms, err := media.NewService(pool, cfg.MediaDir)
		if err != nil {
			slog.Error("media store", "err", err)
			os.Exit(1)
		}
		mediaSvc = ms
	}
	voiceSvc, err := voice.NewService(pool, cfg, media.S3FromEnv(), filepath.Join(".data", "voice-stt"))
	if err != nil {
		// Missing SpeechKit keys must not stop the API. Only a local store
		// that cannot be created is fatal, same as the media directory.
		slog.Error("voice store", "err", err)
		os.Exit(1)
	}

	handler := httpx.NewRouter(httpx.Deps{
		Config:     cfg,
		Pool:       pool,
		Auth:       authSvc,
		Users:      usersSvc,
		Posts:      postsSvc,
		Feed:       feedSvc,
		Chat:       chatSvc,
		Activity:   activitySvc,
		Media:      mediaSvc,
		Waitlist:   waitlistSvc,
		Mod:        modSvc,
		Push:       pushSvc,
		Stories:    storiesSvc,
		Explore:    exploreSvc,
		Clips:      clipsSvc,
		Channels:   channelsSvc,
		VoiceRooms: voiceRoomsSvc,
		MarketAds:  marketAdsSvc,
		Business:   business.NewService(pool),
		Nearby:     nearbySvc,
		Contacts:   contactsSvc,
		Guest:      guestSvc,
		Assist:     assist.NewService(cfg),
		Payments:   payments.NewService(cfg),
		Voice:      voiceSvc,
	})

	runCtx, runCancel := context.WithCancel(context.Background())
	defer runCancel()
	if pool != nil {
		go db.Watch(runCtx, pool)
		postsSvc.StartScheduleWorker(runCtx)
		chatSvc.StartDMScheduleWorker(runCtx)
		chatSvc.StartTranscriptWorker(runCtx)
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
		filepath.Join("backend", "migrations"),
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
