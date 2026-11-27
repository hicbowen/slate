package render

import (
	"slices"
	"strconv"
	"strings"

	"slate/internal/api"
)

type CountdownData struct {
	RemainingDays int64 `json:"remainingDays"`
	DayNumber     int64 `json:"dayNumber,omitempty"`
}

func (d drawer) countdown(cfg api.DynamicConfig, data CountdownData) {
	f := d.fonts
	date := strings.ReplaceAll(cfg.TargetDate, "-", ".")
	count := data.RemainingDays
	unit, accent, unitColor := "天", Black, Black
	prefix, dateLabel := "", "目标日期"
	layout := cfg.CountdownLayout
	if d.color {
		accent = Yellow
	}
	countUp := cfg.CountdownMode == api.CountdownModeUp
	if countUp {
		count, prefix, dateLabel = data.DayNumber, "第", "起始日期"
		if layout == "" {
			layout = api.CountdownLayoutEditorial
		}
		if count == 0 {
			prefix, unit = "", "未开始"
		}
	} else if count == 0 {
		unit = "已到期"
		if d.color {
			unitColor = Red
		}
	}
	days := strconv.FormatInt(count, 10)
	milestone := countUp && count > 0 && slices.Contains(cfg.Milestones, int(count))

	switch layout {
	case api.CountdownLayoutEditorial:
		d.c.FillRect(24, 49, 4, 18, accent)
		d.strongText(f.Sans16, cfg.Goal, 38, 49, textOpts{maxWidth: 337, maxLines: 2, ellipsis: true})
		d.countdownValue(days, prefix, unit, 24, 205, 352, 90, alignLeft, unitColor)
		d.c.HLine(24, 236, 352, Black)
		d.text(f.Sans16, dateLabel, 24, 251, textOpts{})
		d.textCenteredY(f.Metric12, date, 97, 259, textOpts{})
		if milestone {
			d.countdownMilestone(294, 248)
		}
	case api.CountdownLayoutPoster:
		heading := cfg.Goal
		if !countUp && count != 0 {
			heading = "距离" + heading + "还有"
		}
		d.strongText(f.Sans16, heading, frameW/2, 51, textOpts{align: alignCenter, maxWidth: 350, maxLines: 2, ellipsis: true})
		d.countdownValue(days, prefix, unit, frameW/2, 210, 352, 108, alignCenter, unitColor)
		d.text(f.Metric12, date, frameW/2, 236, textOpts{align: alignCenter})
		if milestone {
			d.countdownMilestone(frameW/2-40, 257)
		} else {
			d.c.FillRect(frameW/2-24, 264, 48, 4, accent)
		}
	case api.CountdownLayoutSplit:
		d.c.VLine(196, 54, 208, Black)
		d.strongText(f.Sans16, cfg.Goal, 24, 112, textOpts{maxWidth: 152, maxLines: 2, ellipsis: true})
		d.text(f.Sans16, dateLabel, 24, 186, textOpts{})
		d.text(f.Metric12, date, 24, 210, textOpts{})
		d.countdownValue(days, prefix, "", 296, 167, 158, 78, alignCenter, unitColor)
		d.c.FillRect(296-11, 189, 22, 3, accent)
		d.text(f.Sans16, unit, 296, 204, textOpts{align: alignCenter, color: unitColor})
		if milestone {
			d.countdownMilestone(24, 238)
		}
	default:
		d.countdownLegacy(cfg, data)
	}
}

func (d drawer) countdownMilestone(x, y int) {
	const w, h = 80, 22
	if d.color {
		d.c.FillRect(x, y, w, h, Yellow)
	} else {
		d.c.StrokeRect(x, y, w, h, Black)
	}
	d.textInBox(d.fonts.Sans16, "里程碑", x, y, w, h, Black)
}

// countdownValue scales the bitmap digits to fit and aligns the text and number together.
func (d drawer) countdownValue(days, prefix, unit string, x, bottom, maxWidth, maxHeight int, a align, unitColor uint8) {
	font := d.fonts.DisplayLarge
	box, ok := pixelBounds(font, nil, days)
	if !ok {
		return
	}
	src := NewCanvas(box.right-box.left, box.bottom-box.top)
	drawer{c: src}.line(font, nil, days, -box.left, -box.top, Black)

	prefixWidth, unitWidth := 0, 0
	if prefix != "" {
		prefixWidth = d.width(d.fonts.Sans16, prefix) + 10
	}
	if unit != "" {
		unitWidth = 10 + d.width(d.fonts.Sans16, unit)
	}
	scale := min(float64(maxWidth-prefixWidth-unitWidth)/float64(src.W), float64(maxHeight)/float64(src.H))
	w, h := max(1, round(float64(src.W)*scale)), max(1, round(float64(src.H)*scale))
	left := alignedX(x, prefixWidth+w+unitWidth, a)
	if prefix != "" {
		d.textCenteredY(d.fonts.Sans16, prefix, left, float64(bottom-9), textOpts{})
		left += prefixWidth
	}
	for y := range h {
		srcRow := ((2*y + 1) * src.H / (2 * h)) * src.W
		for x := range w {
			if src.px[srcRow+(2*x+1)*src.W/(2*w)] == Black {
				d.c.Set(left+x, bottom-h+y, Black)
			}
		}
	}
	if unit != "" {
		d.textCenteredY(d.fonts.Sans16, unit, left+w+10, float64(bottom-9), textOpts{color: unitColor})
	}
}

func (d drawer) countdownLegacy(cfg api.DynamicConfig, data CountdownData) {
	f := d.fonts
	center := frameW / 2
	d.c.StrokeRect(12, 30, 376, 262, Black)
	d.text(f.Sans16, "倒数日", 24, 42, textOpts{})
	d.text(f.Metric12, cfg.TargetDate, 376, 44, textOpts{align: alignRight})
	d.strongText(f.Sans16, cfg.Goal, center, 81, textOpts{align: alignCenter, maxWidth: 320, ellipsis: true})
	label := "天"
	if d.color {
		accent := Yellow
		if data.RemainingDays == 0 {
			accent, label = Red, "已到目标日"
		}
		d.c.FillRect(136, 114, 128, 4, accent)
	} else {
		d.c.HLine(136, 116, 128, Black)
	}
	d.text(f.DisplayLarge, strconv.FormatInt(data.RemainingDays, 10), center, 140,
		textOpts{align: alignCenter, maxWidth: 340})
	d.text(f.Sans16, label, center, 220, textOpts{align: alignCenter})
	d.text(f.Sans16, "目标日 · "+cfg.TargetDate, center, 256, textOpts{align: alignCenter})
}
