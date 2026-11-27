package blob

import (
	"bytes"
	"image/png"
	"net/http"

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

// Originals are only returned as authenticated Web blobs. Check the raster
// signature without decoding an unbounded number of pixels on the server.
func ValidImageOriginal(data []byte) bool {
	if len(data) == 0 || len(data) > api.ImageOriginalMaxBytes {
		return false
	}
	switch http.DetectContentType(data) {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp":
		return true
	default:
		return false
	}
}
