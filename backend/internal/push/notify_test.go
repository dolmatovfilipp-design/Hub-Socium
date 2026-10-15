package push

import (
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotifySkipsMuteAndQuiet(t *testing.T) {
	dsn := os.Getenv("HUB_TEST_DSN")
	if dsn == "" {
		dsn = "postgres://hub:hub@127.0.0.1:54329/hub?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip(err.Error())
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skip(err.Error())
	}

	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var recipient, sender, conv string
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, email)
		VALUES ($1, 'x', 'Получатель', $2) RETURNING id::text`,
		"push_to_"+suffix, "push_to_"+suffix+"@example.com").Scan(&recipient)
	if err != nil {
		t.Fatal(err)
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, display_name, email)
		VALUES ($1, 'x', 'Отправитель', $2) RETURNING id::text`,
		"push_from_"+suffix, "push_from_"+suffix+"@example.com").Scan(&sender)
	if err != nil {
		t.Fatal(err)
	}
	err = pool.QueryRow(ctx, `INSERT INTO conversations DEFAULT VALUES RETURNING id::text`).Scan(&conv)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1::uuid[])`, []string{recipient, sender})
		_, _ = pool.Exec(context.Background(), `DELETE FROM conversations WHERE id = $1::uuid`, conv)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)`,
		conv, recipient, sender); err != nil {
		t.Fatal(err)
	}
	endpoint := "https://push.invalid/" + suffix
	if _, err := pool.Exec(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1::uuid, $2, 'p256', 'auth')`, recipient, endpoint); err != nil {
		t.Fatal(err)
	}

	sends := 0
	svc := NewService(pool, "BPub", "BPriv", "mailto:help@gethub.online")
	svc.send = func(context.Context, []byte, *webpush.Subscription, *webpush.Options) (*http.Response, error) {
		sends++
		return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	msg := Payload{
		Title: "Отправитель", Body: "привет", URL: "/app/messages/" + conv,
		Type: "message", FromUserID: sender, ConversationID: conv,
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO conversation_mutes (user_id, conversation_id) VALUES ($1::uuid, $2::uuid)`, recipient, conv); err != nil {
		t.Fatal(err)
	}
	sends = 0
	svc.NotifyUser(ctx, recipient, msg)
	if sends != 0 {
		t.Fatal("muted chat must not push")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM conversation_mutes WHERE user_id=$1::uuid`, recipient); err != nil {
		t.Fatal(err)
	}

	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		loc = time.FixedZone("MSK", 3*3600)
	}
	hour := time.Now().In(loc).Hour()
	end := (hour + 2) % 24
	if end == hour {
		end = (hour + 1) % 24
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO notification_prefs (user_id, quiet_start, quiet_end, quiet_allow_favorites, paused)
		VALUES ($1::uuid, $2, $3, true, false)`, recipient, hour, end); err != nil {
		t.Fatal(err)
	}
	sends = 0
	svc.NotifyUser(ctx, recipient, msg)
	svc.NotifyUser(ctx, recipient, Payload{
		Title: "Вас упомянули", Body: "привет", Type: "mention",
		FromUserID: sender, ConversationID: conv,
	})
	svc.NotifyUser(ctx, recipient, Payload{
		Title: "Отправитель", Body: "Входящий звонок", Type: "call",
		FromUserID: sender, ConversationID: conv,
	})
	if sends != 0 {
		t.Fatal("quiet hours must hold messages, mentions, and calls")
	}

	if _, err := pool.Exec(ctx, `
		UPDATE notification_prefs SET quiet_start=NULL, quiet_end=NULL, paused=true WHERE user_id=$1::uuid`, recipient); err != nil {
		t.Fatal(err)
	}
	sends = 0
	svc.NotifyUser(ctx, recipient, msg)
	if sends != 0 {
		t.Fatal("pause must hold pushes")
	}

	if _, err := pool.Exec(ctx, `
		UPDATE notification_prefs SET paused=false WHERE user_id=$1::uuid`, recipient); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO mutes (muter_id, muted_id) VALUES ($1::uuid, $2::uuid)`, recipient, sender); err != nil {
		t.Fatal(err)
	}
	sends = 0
	svc.NotifyUser(ctx, recipient, Payload{
		Title: "Отправитель", Body: "Входящий звонок", Type: "call",
		FromUserID: sender, ConversationID: conv,
	})
	if sends != 0 {
		t.Fatal("muted person must not ring")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM mutes WHERE muter_id=$1::uuid`, recipient); err != nil {
		t.Fatal(err)
	}

	sends = 0
	svc.NotifyUser(ctx, recipient, msg)
	svc.NotifyUser(ctx, recipient, Payload{
		Title: "Вас упомянули", Body: "текст", Type: "mention",
		FromUserID: sender, ConversationID: conv,
	})
	svc.NotifyUser(ctx, recipient, Payload{
		Title: "Отправитель", Body: "Входящий звонок", Type: "call",
		FromUserID: sender, ConversationID: conv,
	})
	if sends != 3 {
		t.Fatalf("open account should get message, mention, and call, got %d", sends)
	}
}
