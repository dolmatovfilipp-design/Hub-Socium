package mailer

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

var (
	ErrQueueFull   = errors.New("mailer: queue is full")
	ErrQueueClosed = errors.New("mailer: queue is closed")
)

// Sender delivers one message; *Mailer implements it.
type Sender interface {
	Send(ctx context.Context, msg Message) error
}

// QueueOptions tunes delivery. Zero values pick the defaults noted below.
type QueueOptions struct {
	Workers     int             // parallel deliveries (2)
	Buffer      int             // messages waiting before Enqueue fails (256)
	Attempts    int             // tries per message including the first (3)
	Backoff     []time.Duration // wait before retry n; the last entry repeats (2s, 10s)
	SendTimeout time.Duration   // per attempt (45s)
}

func (o QueueOptions) withDefaults() QueueOptions {
	if o.Workers <= 0 {
		o.Workers = 2
	}
	if o.Buffer <= 0 {
		o.Buffer = 256
	}
	if o.Attempts <= 0 {
		o.Attempts = 3
	}
	if len(o.Backoff) == 0 {
		o.Backoff = []time.Duration{2 * time.Second, 10 * time.Second}
	}
	if o.SendTimeout <= 0 {
		o.SendTimeout = 45 * time.Second
	}
	return o
}

// Queue hands messages to background workers so HTTP handlers never wait on
// SMTP. That keeps response time independent of whether an account exists,
// which matters for anti-enumeration on password reset.
type Queue struct {
	sender Sender
	opts   QueueOptions
	jobs   chan Message
	wg     sync.WaitGroup

	mu     sync.Mutex
	closed bool

	ctx    context.Context
	cancel context.CancelFunc
}

// NewQueue starts the workers.
func NewQueue(s Sender, opts QueueOptions) *Queue {
	o := opts.withDefaults()
	ctx, cancel := context.WithCancel(context.Background())
	q := &Queue{sender: s, opts: o, jobs: make(chan Message, o.Buffer), ctx: ctx, cancel: cancel}
	for i := 0; i < o.Workers; i++ {
		q.wg.Add(1)
		go q.worker()
	}
	return q
}

// Enqueue schedules msg without blocking.
func (q *Queue) Enqueue(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return ErrQueueClosed
	}
	select {
	case q.jobs <- msg:
		return nil
	default:
		return ErrQueueFull
	}
}

// Close stops accepting messages and waits for queued ones to be delivered.
// When ctx ends first, in-flight work is aborted and ctx.Err() is returned.
func (q *Queue) Close(ctx context.Context) error {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		close(q.jobs)
	}
	q.mu.Unlock()

	done := make(chan struct{})
	go func() {
		q.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		q.cancel()
		return nil
	case <-ctx.Done():
		q.cancel()
		return ctx.Err()
	}
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for msg := range q.jobs {
		q.deliver(msg)
	}
}

func (q *Queue) deliver(msg Message) {
	for attempt := 1; ; attempt++ {
		ctx, cancel := context.WithTimeout(q.ctx, q.opts.SendTimeout)
		err := q.sender.Send(ctx, msg)
		cancel()
		if err == nil {
			slog.Info("mail sent", "kind", msg.Kind, "to", MaskEmail(msg.To), "attempt", attempt)
			return
		}
		if IsPermanent(err) || attempt >= q.opts.Attempts || q.ctx.Err() != nil {
			slog.Error("mail delivery failed", "kind", msg.Kind, "to", MaskEmail(msg.To), "attempt", attempt, "err", err)
			return
		}
		slog.Warn("mail delivery failed, retrying", "kind", msg.Kind, "to", MaskEmail(msg.To), "attempt", attempt, "err", err)
		select {
		case <-time.After(q.backoff(attempt)):
		case <-q.ctx.Done():
			return
		}
	}
}

func (q *Queue) backoff(attempt int) time.Duration {
	i := attempt - 1
	if i >= len(q.opts.Backoff) {
		i = len(q.opts.Backoff) - 1
	}
	return q.opts.Backoff[i]
}
