package render

import (
	"bytes"
	"encoding/json"
	"flag"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"slate/internal/api"
)

var update = flag.Bool("update", false, "rewrite testdata/frames/*.png")

var renderedAt = time.Date(2026, 10, 26, 2, 30, 0, 0, time.UTC)

func ptr[T any](v T) *T { return &v }

// Golden frames are PNGs so changes can be reviewed as pictures; run
// `go test ./internal/render -update` and inspect the diff after layout changes.
func TestFramesMatchGolden(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	day := CalendarDay{LunarDate: "农历九月十七", GanzhiYear: "丙午年", GanzhiMonth: "戊戌月", GanzhiDay: "癸酉日",
		NextSolarTerm: "立冬", NextSolarTermDays: ptr(12), Yi: []string{"嫁娶", "裁衣", "冠笄"}, Ji: []string{"开市", "栽种"}}
	issued := time.Date(2026, 10, 26, 1, 20, 0, 0, time.UTC)
	cases := map[string]struct {
		cfg  api.DynamicConfig
		data any
	}{
		"daily_calendar": {api.DynamicConfig{Type: api.DynamicTypeDailyCalendar, TZ: "Asia/Shanghai"},
			DailyCalendarData{Year: 2026, Month: 10, Day: 26, WeekdayCN: "星期一", CalendarDay: day}},
		"month_calendar": {api.DynamicConfig{Type: api.DynamicTypeMonthCalendar, TZ: "Asia/Shanghai"},
			MonthCalendarData{Months: map[string]map[string]CalendarDay{"2026-10": {"2026-10-01": {LunarDate: "农历八月廿一"}, "2026-10-08": {SolarTerm: "寒露"}, "2026-10-18": {LunarDate: "农历九月初九", Festival: "重阳节"}}}}},
		"history_today": {api.DynamicConfig{Type: api.DynamicTypeHistoryToday, TZ: "Asia/Shanghai"},
			HistoryTodayData{DateLabel: "10月26日", Items: []HistoryTodayItem{{"1863", "英格兰足球总会在伦敦成立，现代足球规则由此统一"}, {"前221", "秦统一六国"}, {"1955", "奥地利宣布永久中立，此后每年这一天为国庆日"}}}},
		"weather": {api.DynamicConfig{Type: api.DynamicTypeWeather, TZ: "Asia/Shanghai", LocationLabel: "杭州"},
			WeatherData{TempC: "23", FeelsLikeC: "24", Humidity: "68", WindDisplay: "东北风3级", Code: 101,
				Forecast: []WeatherDay{{"今日", "多云", "17", "24", 101}, {"明日", "小雨", "15", "20", 305}, {"后天", "晴", "14", "22", 100}}}},
		"weather_alert": {api.DynamicConfig{Type: api.DynamicTypeWeatherAlert},
			WeatherAlertData{Items: []WeatherAlertItem{{Title: "浙江省杭州市气象台发布暴雨橙色预警信号", IssuedAt: &issued}, {Title: "中央气象台发布台风蓝色预警"}}}},
		"earthquake_report": {api.DynamicConfig{Type: api.DynamicTypeEarthquakeReport},
			EarthquakeData{UpdatedAt: renderedAt, Items: []EarthquakeItem{{OccurredAt: "2026-10-26 09:12:33", Longitude: "102.3", Latitude: "28.1", DepthKm: "10", Magnitude: "4.6", Location: "四川凉山州会理市"}, {OccurredAt: "2026-10-25 22:01:02", DepthKm: "8", Magnitude: "3.1", Location: "新疆喀什地区伽师县"}}}},
		"hot_list": {api.DynamicConfig{Type: api.DynamicTypeHotList, Source: "weibo"},
			HotListData{Items: []HotListItem{{Rank: 1, Title: "第一条热搜标题比较长会被省略号截断显示在墨水屏上"}, {Rank: 2, Title: "第二条"}, {Rank: 3, Title: "第三条"}, {Rank: 4, Title: "第四条"}}}},
		"dashboard": {api.DynamicConfig{Type: api.DynamicTypeDashboard, Template: &api.DashboardTemplateRef{Kind: "system", ID: "ai_quota_monitor"}},
			map[string]any{"service_label": "Claude Code", "plan_label": "Max 20x", "status_label": "正常", "primary_window_label": "5h窗口", "primary_used_percent": 68,
				"secondary_window_label": "周限额", "secondary_used_percent": 23, "primary_reset_at_label": "14:00", "secondary_reset_at_label": "周四 09:00", "updated_label": "10-26 10:30"}},
		"font_test": {api.DynamicConfig{Type: api.DynamicTypeFontTest, FontID: "fusion_pixel_12"}, nil},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			data, _ := json.Marshal(tc.data)
			frame, color, err := r.RenderFrames(Input{Type: tc.cfg.Type, Config: tc.cfg, Data: data, RenderedAt: renderedAt})
			if err != nil {
				t.Fatal(err)
			}
			if len(frame) != api.FrameBytes || len(color) != api.ColorFrameBytes {
				t.Fatalf("unexpected frame sizes: mono %d, color %d", len(frame), len(color))
			}
			assertGolden(t, name, framePNG(frame))
			switch name {
			case "daily_calendar", "month_calendar", "weather", "hot_list":
				assertGolden(t, name+"_bwry", colorFramePNG(color))
			}
		})
	}

	variants := map[string]struct {
		cfg  api.DynamicConfig
		data any
	}{
		"weather_alert_levels": {api.DynamicConfig{Type: api.DynamicTypeWeatherAlert}, WeatherAlertData{
			Items: []WeatherAlertItem{
				{Title: "浙江省杭州市气象台发布暴雨红色预警信号", IssuedAt: &issued},
				{Title: "杭州市气象台发布高温橙色预警信号"},
				{Title: "杭州市气象台发布雷电黄色预警信号"},
				{Title: "中央气象台发布大风蓝色预警"},
			},
		}},
		"dashboard_quota": {api.DynamicConfig{Type: api.DynamicTypeDashboard, Template: &api.DashboardTemplateRef{Kind: "system", ID: "ai_quota_monitor"}},
			map[string]any{"service_label": "Codex", "plan_label": "Pro", "status_label": "已达限额",
				"primary_window_label": "5小时", "primary_used_percent": 87, "secondary_window_label": "每周", "secondary_used_percent": 100,
				"primary_reset_at_label": "14:00", "secondary_reset_at_label": "周四 09:00", "updated_label": "10-26 10:30"}},
		"dashboard_usage": {api.DynamicConfig{Type: api.DynamicTypeDashboard, Template: &api.DashboardTemplateRef{Kind: "system", ID: "ai_usage_stats"}},
			map[string]any{"today_cost_usd": 155.77, "today_request_count": 1602, "today_token_count": 172500000,
				"today_cache_hit_rate_percent": 93.2, "total_cost_usd": 1860.19, "total_request_count": 20305,
				"total_token_count": 2102300000, "total_cache_hit_rate_percent": 94, "average_latency_ms": 17270,
				"today_cost_per_million_tokens_usd": 0.9, "total_cost_per_million_tokens_usd": 0.88, "last_updated_time_label": "16:30",
				"platform_breakdown": []map[string]any{
					{"platform_name": "OpenAI", "today_cost_usd": 146.29, "today_request_count": 1602, "today_token_count": 172500000},
					{"platform_name": "Claude", "today_cost_usd": 9.47, "today_request_count": 0, "today_token_count": 0},
				}}},
		"dashboard_custom_colors": {api.DynamicConfig{Type: api.DynamicTypeDashboard, Template: &api.DashboardTemplateRef{Kind: "custom",
			Template: &api.DashboardTemplate{Version: 1, Blocks: []api.DashboardBlock{
				{Type: "rect", X: 20, Y: 30, W: 360, H: 36, Fill: "yellow", StrokeColor: "red"},
				{Type: "text", X: 30, Y: 36, W: 340, H: 20, Value: "运行概览"},
				{Type: "metric", X: 20, Y: 86, W: 145, H: 68, Label: "请求", Value: "128k", Color: "red", Sparkline: json.RawMessage(`[1,4,2,7]`)},
				{Type: "sparkline", X: 200, Y: 96, W: 175, H: 45, Color: "yellow", Values: json.RawMessage(`[2,5,3,7,8]`)},
				{Type: "line", X1: 20, Y1: 174, X2: 380, Y2: 174, Color: "red", Style: "dashed"},
				{Type: "progress", X: 20, Y: 194, W: 360, H: 32, Label: "目标", Percentage: json.RawMessage(`72`), ValueText: "72%", Color: "yellow"},
			}}}}, map[string]any{"present": true}},
		"countdown":     {api.DynamicConfig{Type: api.DynamicTypeCountdown, Goal: "开学", TargetDate: "2026-10-29"}, CountdownData{RemainingDays: 3}},
		"countdown_due": {api.DynamicConfig{Type: api.DynamicTypeCountdown, Goal: "开学", TargetDate: "2026-10-26"}, CountdownData{}},
	}
	for name, tc := range variants {
		t.Run(name, func(t *testing.T) {
			data, _ := json.Marshal(tc.data)
			_, color, err := r.RenderFrames(Input{Type: tc.cfg.Type, Config: tc.cfg, Data: data, RenderedAt: renderedAt})
			if err != nil {
				t.Fatal(err)
			}
			assertGolden(t, name+"_bwry", colorFramePNG(color))
		})
	}
}

func TestCountdownLayoutsMatchGolden(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, goal, date string
		layout           api.CountdownLayout
		days             int64
	}{
		{"editorial", "开学", "2027-09-01", api.CountdownLayoutEditorial, 28},
		{"poster", "开学", "2027-09-01", api.CountdownLayoutPoster, 28},
		{"split", "开学", "2027-09-01", api.CountdownLayoutSplit, 28},
		{"editorial_due", "开学", "2027-09-01", api.CountdownLayoutEditorial, 0},
		{"split_long", "全国青少年科学实验与项目成果展示暨创新实践活动", "9999-12-31", api.CountdownLayoutSplit, 2912357},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := api.DynamicConfig{Type: api.DynamicTypeCountdown, Goal: tc.goal, TargetDate: tc.date, CountdownLayout: tc.layout}
			data, _ := json.Marshal(CountdownData{RemainingDays: tc.days})
			mono, color, err := r.RenderFrames(Input{Type: cfg.Type, Config: cfg, Data: data, RenderedAt: renderedAt})
			if err != nil {
				t.Fatal(err)
			}
			assertGolden(t, "countdown_"+tc.name, framePNG(mono))
			assertGolden(t, "countdown_"+tc.name+"_bwry", colorFramePNG(color))
		})
	}
}

func TestNotesAndCountUpMatchGolden(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatal(err)
	}
	note := api.DynamicConfig{
		Type: api.DynamicTypeMessageBoard, Message: "今晚六点回来吃饭\n给你留了番茄牛腩", MessageAuthor: "妈妈",
		MessageExpiresAt: renderedAt.Add(time.Hour).Format(time.RFC3339), MessageFallback: "明天见",
	}
	for _, tc := range []struct {
		name  string
		input Input
	}{
		{"message_board", Input{Type: note.Type, Config: note, RenderedAt: renderedAt}},
		{"message_board_expired", Input{Type: note.Type, Config: note, RenderedAt: renderedAt.Add(time.Hour)}},
		{"message_board_long", Input{Type: note.Type, Config: api.DynamicConfig{
			Message:       "冰箱里有昨天买的小番茄和草莓，晚上做饭可以拿出来洗一下。\n书房桌上放了周六出门要带的东西。\n记得把阳台的衣服收回来。\n我今天晚些时候到家，给我留一盏小灯就好。",
			MessageAuthor: "妈妈",
		}}},
		{"countup_editorial", countUpGolden(api.CountdownLayoutEditorial, 365)},
		{"countup_poster", countUpGolden(api.CountdownLayoutPoster, 365)},
		{"countup_split", countUpGolden(api.CountdownLayoutSplit, 365)},
		{"countup_pending", countUpGolden(api.CountdownLayoutEditorial, 0)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mono, color, err := r.RenderFrames(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			assertGolden(t, tc.name, framePNG(mono))
			assertGolden(t, tc.name+"_bwry", colorFramePNG(color))
		})
	}
}

func countUpGolden(layout api.CountdownLayout, day int64) Input {
	cfg := api.DynamicConfig{
		Type: api.DynamicTypeCountdown, Goal: "搬进新家", TargetDate: "2025-10-27",
		CountdownMode: api.CountdownModeUp, CountdownLayout: layout, Milestones: []int{365},
	}
	data, _ := json.Marshal(CountdownData{DayNumber: day})
	return Input{Type: cfg.Type, Config: cfg, Data: data, RenderedAt: renderedAt}
}

func assertGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := filepath.Join("testdata", "frames", name+".png")
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("missing golden; run with -update: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("frame differs from %s; run with -update and review the image", path)
	}
}

func colorFramePNG(frame []byte) []byte {
	img := image.NewPaletted(image.Rect(0, 0, api.FrameWidth, api.FrameHeight), color.Palette{
		color.RGBA{20, 17, 13, 255}, color.RGBA{245, 243, 237, 255},
		color.RGBA{217, 165, 0, 255}, color.RGBA{185, 43, 39, 255},
	})
	for i := range img.Pix {
		img.Pix[i] = frame[i>>2] >> (6 - (i&3)*2) & 3
	}
	var buf bytes.Buffer
	_ = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	return buf.Bytes()
}

func TestPackedColorWireOrder(t *testing.T) {
	c := NewCanvas(8, 1)
	for x, color := range []uint8{Black, White, Yellow, Red, Red, Yellow, White, Black} {
		c.Set(x, 0, color)
	}
	if got := c.PackedColor(); !bytes.Equal(got, []byte{0x1b, 0xe4}) {
		t.Fatalf("BWRY wire order: %x", got)
	}
	if got := c.Packed(); !bytes.Equal(got, []byte{0x42}) {
		t.Fatalf("monochrome rendition: %x", got)
	}
}

func framePNG(frame []byte) []byte {
	img := image.NewGray(image.Rect(0, 0, api.FrameWidth, api.FrameHeight))
	for i := 0; i < api.FrameWidth*api.FrameHeight; i++ {
		if frame[i>>3]&(0x80>>(i&7)) != 0 {
			img.Pix[i] = 255
		}
	}
	var buf bytes.Buffer
	_ = (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	return buf.Bytes()
}

func TestResolveTemplateFormats(t *testing.T) {
	data := map[string]any{"cost": 12.5, "n": 1234567.0, "tokens": 15300.0, "pct": 66.66, "ms": 1520.0, "list": []any{1.0, 2.0}, "rows": []any{map[string]any{"name": "a"}}}
	for tpl, want := range map[string]string{
		"{cost|usd2}":     "$12.50",
		"{n|int}":         "1,234,567",
		"{tokens|tokens}": "15.3K",
		"{pct|percent}":   "66.7%",
		"{ms|duration}":   "1.52s",
		"{list}":          "1 2",
		"{rows.0.name}!":  "a!",
		"{missing|usd2}x": "x",
		"{cost}":          "12.5",
	} {
		if got := ResolveTemplate(tpl, data); got != want {
			t.Errorf("%s: got %q, want %q", tpl, got, want)
		}
	}
}

func TestSummarizeAlert(t *testing.T) {
	s := SummarizeAlert("广西壮族自治区气象台发布暴雨橙色预警信号")
	if s.Kind != "暴雨" || s.LevelShort != "橙" || !s.Filled || s.SourceLabel != "广西" {
		t.Fatalf("unexpected summary %+v", s)
	}
}
