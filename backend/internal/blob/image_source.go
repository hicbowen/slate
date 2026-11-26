package blob

import (
	"bytes"
	"image/png"

	"slate/internal/api"
)

const MaxImageSourceBytes = 1 << 20

// ValidImageSource checks the normalized crop before it becomes an editable blob.
func ValidImageSource(data []byte) bool {
	if len(data) == 0 || len(data) > MaxImageSourceBytes {
		return false
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != api.FrameWidth || config.Height != api.FrameHeight {
		return false
	}
	_, err = png.Decode(bytes.NewReader(data))
	return err == nil
}
