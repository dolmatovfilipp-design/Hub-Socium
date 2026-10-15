package chat

import "testing"

func TestParseReplyLines(t *testing.T) {
	got := parseReplyLines("1. Да, могу\n- Хорошо, завтра\n«Третий ответ длиннее восьмидесяти символов, его нужно обрезать прямо здесь чтобы не раздувать кнопку»\nчетвёртый")
	if len(got) != 3 {
		t.Fatalf("want 3 lines, got %#v", got)
	}
	if got[0] != "Да, могу" || got[1] != "Хорошо, завтра" {
		t.Fatalf("lines: %#v", got)
	}
	if len([]rune(got[2])) > 80 {
		t.Fatalf("third line too long: %s", got[2])
	}
}

func TestLiveAIOff(t *testing.T) {
	s := NewService(nil)
	if s.liveAI() || s.liveTranslate() || s.paymentsOn() {
		t.Fatal("fresh service must report providers off")
	}
}
