package dynamic

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"slate/internal/api"
)

func TestNormalizeConfigDefaults(t *testing.T) {
	cases := map[string]string{
		`{"type":"hot_list"}`: `{"type":"hot_list","refreshIntervalSec":600,"source":"weibo"}`,
		`{"type":"weather_alert","province":"广西","audioEnabled":true}`: `{"type":"weather_alert","audioEnabled":true,"audioVoice":"冰糖","refreshIntervalSec":600,"province":"广西壮族自治区"}`,
		`{"type":"font_test"}`:                              `{"type":"font_test","fontId":"fusion_pixel_12"}`,
		`{"type":"daily_calendar","tz":"Asia/Shanghai"}`:    `{"type":"daily_calendar","tz":"Asia/Shanghai","audioVoice":"冰糖"}`,
		`{"type":"dashboard","template":{"kind":"system"}}`: `{"type":"dashboard","refreshIntervalSec":600,"template":{"kind":"system","id":"ai_quota_monitor"}}`,
	}
	for in, want := range cases {
		cfg, err := NormalizeConfig(json.RawMessage(in))
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		got, _ := json.Marshal(cfg)
		if string(got) != want {
			t.Errorf("%s:\n got %s\nwant %s", in, got, want)
		}
	}
}

func TestNormalizeConfigRejects(t *testing.T) {
	for _, in := range []string{
		`{"type":"nope"}`,
		`{"type":"weather","tz":"Asia/Shanghai"}`,
		`{"type":"daily_calendar","tz":"Mars/Base"}`,
		`{"type":"hot_list","source":"unknown"}`,
		`{"type":"hot_list","refreshIntervalSec":30}`,
		`{"type":"hot_list","extra":1}`,
		`{"type":"dashboard","template":{"kind":"custom","template":{"blocks":[{"type":"text","x":390,"y":30,"w":20,"h":10,"value":"x"}]}}}`,
	} {
		if _, err := NormalizeConfig(json.RawMessage(in)); err == nil {
			t.Errorf("%s: accepted", in)
		}
	}
}

func TestCustomTemplateFillsBlockDefaults(t *testing.T) {
	cfg, err := NormalizeConfig(json.RawMessage(`{"type":"dashboard","template":{"kind":"custom","template":{"blocks":[{"type":"rect","x":20,"y":30,"w":10,"h":10},{"type":"line","x1":0,"y1":40,"x2":399,"y2":40}]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	blocks := cfg.Template.Template.Blocks
	if blocks[0].Stroke == nil || !*blocks[0].Stroke || blocks[0].Fill != "none" || blocks[1].Style != "solid" {
		t.Fatalf("defaults not applied: %+v", blocks)
	}
}

func TestProgressColorThresholds(t *testing.T) {
	prefix := `{"type":"dashboard","template":{"kind":"custom","template":{"blocks":[{"type":"progress","x":20,"y":50,"w":300,"h":22,"label":"限额","percentage":87,`
	suffix := `}]}}}`
	cfg, err := NormalizeConfig(json.RawMessage(prefix + `"warningAt":80,"criticalAt":100` + suffix))
	if err != nil {
		t.Fatal(err)
	}
	block := cfg.Template.Template.Blocks[0]
	if block.WarningAt == nil || *block.WarningAt != 80 || block.CriticalAt == nil || *block.CriticalAt != 100 {
		t.Fatalf("thresholds lost: %+v", block)
	}
	for _, thresholds := range []string{`"warningAt":0`, `"criticalAt":101`, `"warningAt":90,"criticalAt":80`} {
		if _, err := NormalizeConfig(json.RawMessage(prefix + thresholds + suffix)); err == nil {
			t.Errorf("invalid thresholds accepted: %s", thresholds)
		}
	}
}

func TestCustomDashboardBlockColors(t *testing.T) {
	for _, block := range []api.DashboardBlock{
		{Type: "metric", X: 20, Y: 30, W: 90, H: 42, Label: "服务", Value: "Slate", Color: "red"},
		{Type: "progress", X: 20, Y: 30, W: 300, H: 30, Label: "状态", Color: "yellow"},
		{Type: "sparkline", X: 20, Y: 30, W: 80, H: 42, Values: json.RawMessage(`[1,2]`), Color: "red"},
		{Type: "line", X1: 20, Y1: 30, X2: 80, Y2: 30, Color: "yellow"},
		{Type: "rect", X: 20, Y: 30, W: 90, H: 42, Fill: "yellow", StrokeColor: "red"},
	} {
		t.Run(block.Type, func(t *testing.T) {
			got := block
			if err := normalizeBlock(&got); err != nil {
				t.Fatal(err)
			}
			if got.Color != block.Color || got.StrokeColor != block.StrokeColor || got.Fill != block.Fill {
				t.Fatalf("colors lost: %+v", got)
			}
			if block.Type == "rect" {
				block.StrokeColor = "blue"
			} else {
				block.Color = "blue"
			}
			if err := normalizeBlock(&block); err == nil {
				t.Fatal("invalid color accepted")
			}
		})
	}
}

func TestScheduleCalendarWakesAfterLocalMidnight(t *testing.T) {
	now := time.Date(2026, 10, 26, 15, 0, 0, 0, time.UTC) // 23:00 in Shanghai
	next, due := schedule(api.DynamicConfig{Type: api.DynamicTypeDailyCalendar, TZ: "Asia/Shanghai"}, now)
	if want := time.Date(2026, 10, 26, 16, 1, 0, 0, time.UTC); !next.Equal(want) {
		t.Fatalf("next %v, want %v", next, want)
	}
	if want := time.Date(2026, 10, 26, 16, 0, 0, 0, time.UTC); !due.Equal(want) {
		t.Fatalf("due %v, want %v", due, want)
	}
	if next, _ := schedule(api.DynamicConfig{Type: api.DynamicTypeFontTest}, now); next != nil {
		t.Fatalf("font test should never refresh")
	}
}

func TestErrorBackoffCapsAtOneHour(t *testing.T) {
	now := time.Now()
	if got := errorBackoff(1, now).Sub(now); got != time.Minute {
		t.Fatalf("first failure waits %v", got)
	}
	if got := errorBackoff(20, now).Sub(now); got != time.Hour {
		t.Fatalf("backoff not capped: %v", got)
	}
}

func TestStatusBarText(t *testing.T) {
	at := time.Date(2026, 10, 26, 2, 0, 0, 0, time.UTC)
	typ := string(api.DynamicTypeMonthCalendar)
	if got := StatusBarText(nil, &typ, json.RawMessage(`{"type":"month_calendar","tz":"Asia/Shanghai"}`), nil, &at); got != "2026年10月" {
		t.Fatalf("got %q", got)
	}
	typ = string(api.DynamicTypeHotList)
	if got := StatusBarText(nil, &typ, json.RawMessage(`{"type":"hot_list","source":"zhihu"}`), nil, nil); got != "知乎热榜热榜" {
		t.Fatalf("got %q", got)
	}
}

func TestSpeechText(t *testing.T) {
	data, _ := json.Marshal(map[string]any{"items": []map[string]any{{"title": "浙江省杭州市气象台发布暴雨橙色预警信号"}}})
	got := speechText(api.DynamicConfig{Type: api.DynamicTypeWeatherAlert}, data, time.Now())
	if got != "全国气象预警，播报最新一条。浙江杭州发布暴雨橙色预警" {
		t.Fatalf("got %q", got)
	}
	if got := speechText(api.DynamicConfig{Type: api.DynamicTypeHotList}, nil, time.Now()); got != "" {
		t.Fatalf("hot lists have no speech, got %q", got)
	}
}

func TestDecodeFirstObject(t *testing.T) {
	var v struct{ A int }
	if !decodeFirstObject("noise {not json} then {\"A\": 3} tail", &v) || v.A != 3 {
		t.Fatalf("got %+v", v)
	}
}

func TestCalendarDayFindsSolarTerms(t *testing.T) {
	d := calendarDay(2026, 11, 7)
	if d.SolarTerm != "立冬" || *d.NextSolarTermDays != 0 {
		t.Fatalf("unexpected term %+v", d)
	}
	d = calendarDay(2026, 10, 26)
	if d.NextSolarTerm != "立冬" || *d.NextSolarTermDays != 12 || !strings.HasPrefix(d.LunarDate, "农历") {
		t.Fatalf("unexpected day %+v", d)
	}
}
