package notifprefs

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Prefs mirrors notification_prefs row (defaults = all enabled, no quiet).
type Prefs struct {
	Likes               bool
	Comments            bool
	Follows             bool
	Messages            bool
	Mentions            bool
	QuietStart          *int
	QuietEnd            *int
	QuietAllowFavorites bool
}

func Load(ctx context.Context, pool *pgxpool.Pool, userID string) Prefs {
	p := Prefs{Likes: true, Comments: true, Follows: true, Messages: true, Mentions: true, QuietAllowFavorites: true}
	if pool == nil || userID == "" {
		return p
	}
	var likes, comments, follows, messages, mentions bool
	var qs, qe *int
	var qFav bool
	err := pool.QueryRow(ctx, `
		SELECT likes, comments, follows, messages, mentions, quiet_start, quiet_end,
		       COALESCE(quiet_allow_favorites, true)
		FROM notification_prefs WHERE user_id=$1::uuid`, userID).
		Scan(&likes, &comments, &follows, &messages, &mentions, &qs, &qe, &qFav)
	if err != nil {
		return p
	}
	return Prefs{
		Likes: likes, Comments: comments, Follows: follows,
		Messages: messages, Mentions: mentions,
		QuietStart: qs, QuietEnd: qe, QuietAllowFavorites: qFav,
	}
}

// Category maps activity/push type → pref column. Empty = unmapped (always allow).
func Category(typ string) string {
	switch typ {
	case "like":
		return "likes"
	case "reply", "comment":
		return "comments"
	case "follow", "follow_request":
		return "follows"
	case "mention":
		return "mentions"
	case "message", "messages":
		return "messages"
	default:
		return ""
	}
}

func (p Prefs) TypeEnabled(typ string) bool {
	switch Category(typ) {
	case "likes":
		return p.Likes
	case "comments":
		return p.Comments
	case "follows":
		return p.Follows
	case "mentions":
		return p.Mentions
	case "messages":
		return p.Messages
	default:
		return true
	}
}

// InQuietHours uses Europe/Moscow wall clock. Quiet wraps midnight when start > end (e.g. 22→8).
func (p Prefs) InQuietHours(now time.Time) bool {
	if p.QuietStart == nil || p.QuietEnd == nil {
		return false
	}
	start, end := *p.QuietStart, *p.QuietEnd
	if start < 0 || start > 23 || end < 0 || end > 23 || start == end {
		return false
	}
	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		loc = time.FixedZone("MSK", 3*3600)
	}
	hour := now.In(loc).Hour()
	if start < end {
		return hour >= start && hour < end
	}
	// wraps midnight: e.g. 22–8 → quiet if hour>=22 OR hour<8
	return hour >= start || hour < end
}

// AllowActivity: per-type mute skips Activity insert/list. Quiet hours do NOT hide Activity.
func AllowActivity(ctx context.Context, pool *pgxpool.Pool, userID, typ string) bool {
	return Load(ctx, pool, userID).TypeEnabled(typ)
}

// AllowPush: muted type OR quiet hours → skip Web Push.
func AllowPush(ctx context.Context, pool *pgxpool.Pool, userID, typ string) bool {
	return AllowPushEx(ctx, pool, userID, typ, "", "")
}

// AllowPushEx: when quiet hours active and QuietAllowFavorites, messages from
// conversations marked folder=important still get through.
func AllowPushEx(ctx context.Context, pool *pgxpool.Pool, userID, typ, fromUserID, convID string) bool {
	p := Load(ctx, pool, userID)
	if !p.TypeEnabled(typ) {
		slog.Info("push skip: muted type", "user_id", userID, "type", typ)
		return false
	}
	if p.InQuietHours(time.Now()) {
		if p.QuietAllowFavorites && (Category(typ) == "messages" || typ == "") {
			if isFavoriteConv(ctx, pool, userID, convID, fromUserID) {
				slog.Info("push allow: quiet but favorite", "user_id", userID, "conv", convID)
				return true
			}
		}
		slog.Info("push skip: quiet hours", "user_id", userID, "type", typ)
		return false
	}
	return true
}

func isFavoriteConv(ctx context.Context, pool *pgxpool.Pool, userID, convID, fromUserID string) bool {
	if pool == nil || userID == "" {
		return false
	}
	if convID != "" {
		var fav bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM conversation_members
			  WHERE user_id=$1::uuid AND conversation_id=$2::uuid AND COALESCE(folder,'inbox')='important'
			)`, userID, convID).Scan(&fav)
		if fav {
			return true
		}
	}
	if fromUserID != "" {
		var cf bool
		_ = pool.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM close_friends WHERE owner_id=$1::uuid AND friend_id=$2::uuid
			)`, userID, fromUserID).Scan(&cf)
		return cf
	}
	return false
}

// MutedCategoriesSQL returns SQL fragment types to exclude for Activity list (empty if none muted).
func MutedTypeList(p Prefs) []string {
	var muted []string
	if !p.Likes {
		muted = append(muted, "like")
	}
	if !p.Comments {
		muted = append(muted, "reply", "comment")
	}
	if !p.Follows {
		muted = append(muted, "follow", "follow_request")
	}
	if !p.Mentions {
		muted = append(muted, "mention")
	}
	return muted
}
