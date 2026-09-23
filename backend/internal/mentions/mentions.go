package mentions

import (
	"context"
	"regexp"
	"strings"

	"github.com/hub-socium/hub/backend/internal/activity"
	"github.com/hub-socium/hub/backend/internal/push"
	"github.com/jackc/pgx/v5/pgxpool"
)

var mentionRe = regexp.MustCompile(`(^|[\s([{«"«„])@([A-Za-zА-Яа-яЁё0-9_]{1,32})`)

// ExtractUsernames returns unique @usernames from text (without @).
func ExtractUsernames(text string) []string {
	matches := mentionRe.FindAllStringSubmatch(text, -1)
	seen := map[string]bool{}
	out := make([]string, 0)
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		u := strings.TrimSpace(m[2])
		key := strings.ToLower(u)
		if u == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, u)
	}
	return out
}

// ResolveAndNotify inserts mention rows + activity + optional push for post or message.
func ResolveAndNotify(
	ctx context.Context,
	pool *pgxpool.Pool,
	act *activity.Service,
	pushSvc *push.Service,
	actorID string,
	text string,
	postID *string,
	messageID *string,
) {
	names := ExtractUsernames(text)
	if len(names) == 0 {
		return
	}
	for _, name := range names {
		var mentionedID string
		err := pool.QueryRow(ctx, `
			SELECT id::text FROM users
			WHERE lower(username) = lower($1) AND deleted_at IS NULL`, name).Scan(&mentionedID)
		if err != nil || mentionedID == "" || mentionedID == actorID {
			continue
		}
		_, _ = pool.Exec(ctx, `
			INSERT INTO mentions (mentioned_id, actor_id, post_id, message_id)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
			mentionedID, actorID, postID, messageID)

		meta := map[string]any{"username": name}
		snippet := text
		if len([]rune(snippet)) > 120 {
			snippet = string([]rune(snippet)[:120])
		}
		meta["text"] = snippet
		if act != nil {
			_ = act.Insert(ctx, mentionedID, actorID, "mention", postID, meta)
		}
		if pushSvc != nil {
			var actorName string
			_ = pool.QueryRow(ctx, `
				SELECT COALESCE(NULLIF(display_name,''), username) FROM users WHERE id = $1::uuid`, actorID).Scan(&actorName)
			url := "/app/activity"
			if postID != nil && *postID != "" {
				url = "/app/p/" + *postID
			}
			pushSvc.NotifyUser(ctx, mentionedID, push.Payload{
				Title: "Вас упомянули",
				Body:  actorName + " упомянул(а) вас",
				URL:   url,
				Type:  "mention",
			})
		}
	}
}
