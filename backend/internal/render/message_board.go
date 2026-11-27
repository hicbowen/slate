package render

import (
	"time"

	"slate/internal/api"
)

func (d drawer) messageBoard(cfg api.DynamicConfig, renderedAt time.Time) {
	const left, right = 29, 371
	message, author := cfg.Message, cfg.MessageAuthor
	if expires, err := time.Parse(time.RFC3339, cfg.MessageExpiresAt); err == nil && !renderedAt.Before(expires) {
		message, author = or(cfg.MessageFallback, "暂无新留言"), ""
	}

	accent := Black
	if d.color {
		accent = Yellow
	}
	d.c.FillRect(left, 50, 28, 4, accent)
	f := d.fonts.Sans16
	fb := d.fonts.fallback(f)
	const width = right - left
	const top, bottom = 67, 240

	// Double the glyphs for short notes. Switch to the native font when the
	// complete note needs more room.
	lines := wrapText(f, fb, message, width/2, 5, false)
	if len(lines) <= 4 {
		const gap = 6
		height := len(lines)*(2*f.LineHeight+gap) - gap
		y := top + (bottom-top-height)/2
		for _, line := range lines {
			src := NewCanvas(width/2, f.LineHeight)
			drawer{c: src}.line(f, fb, line, 0, 0, Black)
			for i, pixel := range src.px {
				if pixel == Black {
					d.c.FillRect(left+2*(i%src.W), y+2*(i/src.W), 2, 2, Black)
				}
			}
			y += 2*f.LineHeight + gap
		}
	} else {
		const gap = 4
		maxLines := (bottom - top + gap) / (f.LineHeight + gap)
		lines = wrapText(f, fb, message, width, maxLines, true)
		height := len(lines)*(f.LineHeight+gap) - gap
		d.text(f, message, left, top+(bottom-top-height)/2,
			textOpts{maxWidth: width, maxLines: maxLines, lineGap: gap, ellipsis: true})
	}

	d.c.HLine(left, 246, width, Black)
	if author != "" {
		d.text(f, "— "+author, right, 258, textOpts{align: alignRight, maxWidth: width, ellipsis: true})
	}
}
