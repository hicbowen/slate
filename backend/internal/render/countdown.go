package render

import (
	"strconv"

	"slate/internal/api"
)

type CountdownData struct {
	RemainingDays int64 `json:"remainingDays"`
}

func (d drawer) countdown(cfg api.DynamicConfig, data CountdownData) {
	f := d.fonts
	center := frameW / 2
	d.c.StrokeRect(12, 30, 376, 262, Black)
	d.text(f.Sans16, "倒数日", 24, 42, textOpts{})
	d.text(f.Metric12, cfg.TargetDate, 376, 44, textOpts{align: alignRight})
	d.strongText(f.Sans16, cfg.Goal, center, 81, textOpts{align: alignCenter, maxWidth: 320, ellipsis: true})
	d.c.HLine(136, 116, 128, Black)
	d.text(f.DisplayLarge, strconv.FormatInt(data.RemainingDays, 10), center, 140,
		textOpts{align: alignCenter, maxWidth: 340, color: Red})
	d.text(f.Sans16, "天", center, 220, textOpts{align: alignCenter})
	d.text(f.Sans16, "目标日 · "+cfg.TargetDate, center, 256, textOpts{align: alignCenter})
}
