package mailer

import (
	"context"
	"errors"
	"net/textproto"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type scriptedSender struct {
	mu       sync.Mutex
	results  []error // consumed one per call; nil entry = success; exhausted = success
	calls    int
	delivery []Message
	block    chan struct{}
}

func (s *scriptedSender) Send(ctx context.Context, msg Message) error {
	if s.block != nil {
		select {
		case <-s.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	var err error
	if len(s.results) > 0 {
		err, s.results = s.results[0], s.results[1:]
	}
	if err == nil {
		s.delivery = append(s.delivery, msg)
	}
	return err
}

func (s *scriptedSender) snapshot() (calls int, delivered []Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, append([]Message(nil), s.delivery...)
}

func fastQueue(s Sender, o QueueOptions) *Queue {
	o.Backoff = []time.Duration{time.Millisecond}
	return NewQueue(s, o)
}

func closeQueue(t *testing.T, q *Queue) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := q.Close(ctx); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func TestQueueDeliversAndDrainsOnClose(t *testing.T) {
	s := &scriptedSender{}
	q := fastQueue(s, QueueOptions{Workers: 2})
	for i := 0; i < 20; i++ {
		if err := q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"}); err != nil {
			t.Fatal(err)
		}
	}
	closeQueue(t, q)
	if calls, delivered := s.snapshot(); calls != 20 || len(delivered) != 20 {
		t.Fatalf("calls=%d delivered=%d", calls, len(delivered))
	}
}

func TestQueueRetriesTransientErrors(t *testing.T) {
	transient := &textproto.Error{Code: 451, Msg: "try later"}
	s := &scriptedSender{results: []error{transient, errors.New("connection reset"), nil}}
	q := fastQueue(s, QueueOptions{Workers: 1, Attempts: 3})
	_ = q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"})
	closeQueue(t, q)
	if calls, delivered := s.snapshot(); calls != 3 || len(delivered) != 1 {
		t.Fatalf("calls=%d delivered=%d", calls, len(delivered))
	}
}

func TestQueueGivesUpAfterMaxAttempts(t *testing.T) {
	boom := errors.New("network down")
	s := &scriptedSender{results: []error{boom, boom, boom, boom, boom}}
	q := fastQueue(s, QueueOptions{Workers: 1, Attempts: 3})
	_ = q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"})
	closeQueue(t, q)
	if calls, delivered := s.snapshot(); calls != 3 || len(delivered) != 0 {
		t.Fatalf("calls=%d delivered=%d", calls, len(delivered))
	}
}

func TestQueueDoesNotRetryPermanentErrors(t *testing.T) {
	s := &scriptedSender{results: []error{&textproto.Error{Code: 550, Msg: "no such user"}, nil}}
	q := fastQueue(s, QueueOptions{Workers: 1, Attempts: 3})
	_ = q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"})
	closeQueue(t, q)
	if calls, _ := s.snapshot(); calls != 1 {
		t.Fatalf("permanent failure retried: calls=%d", calls)
	}
}

func TestQueueFullAndClosed(t *testing.T) {
	block := make(chan struct{})
	s := &scriptedSender{block: block}
	q := fastQueue(s, QueueOptions{Workers: 1, Buffer: 1})

	var full atomic.Bool
	for i := 0; i < 5; i++ {
		if err := q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"}); errors.Is(err, ErrQueueFull) {
			full.Store(true)
		}
	}
	if !full.Load() {
		t.Fatal("expected ErrQueueFull once the buffer is saturated")
	}
	close(block)
	closeQueue(t, q)
	if err := q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"}); !errors.Is(err, ErrQueueClosed) {
		t.Fatalf("enqueue after close: %v", err)
	}
}

func TestQueueCloseAbortsStuckDelivery(t *testing.T) {
	s := &scriptedSender{block: make(chan struct{})}
	q := fastQueue(s, QueueOptions{Workers: 1})
	_ = q.Enqueue(Message{To: "a@example.com", Subject: "s", Text: "t"})
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := q.Close(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("close err = %v", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("close did not return promptly")
	}
}
