package server

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"math"
	"mime"
	"net/http"
	"strconv"
)

const maxAvatarBytes = 2 << 20

func (s *server) putAvatar(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (media != "image/png" && media != "image/jpeg") {
		jsonError(w, http.StatusUnsupportedMediaType, "Выбери картинку PNG или JPEG")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAvatarBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "Картинка больше 2 МБ")
		} else {
			jsonError(w, http.StatusBadRequest, "Не получилось прочитать картинку")
		}
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		jsonError(w, http.StatusBadRequest, "Не получилось прочитать PNG или JPEG")
		return
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
		jsonError(w, http.StatusBadRequest, "Размер картинки — не больше 4096 × 4096 пикселей")
		return
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Картинка повреждена")
		return
	}
	var out bytes.Buffer
	if err := png.Encode(&out, squareAvatar(src)); err != nil {
		s.fail(w, "encode avatar", err)
		return
	}
	if err := s.cfg.Store.SetAvatar(r.Context(), userFrom(r.Context()).ID, out.Bytes()); err != nil {
		s.fail(w, "save avatar", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// squareAvatar crops the center and resamples with bilinear interpolation.
// RGBA values are premultiplied so transparent PNG edges keep their colors.
func squareAvatar(src image.Image) *image.RGBA {
	bounds := src.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	left, top := bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2
	dst := image.NewRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		sy := max(0, min(float64(side-1), (float64(y)+.5)*float64(side)/256-.5))
		y0 := int(sy)
		fy := sy - float64(y0)
		for x := 0; x < 256; x++ {
			sx := max(0, min(float64(side-1), (float64(x)+.5)*float64(side)/256-.5))
			x0 := int(sx)
			fx := sx - float64(x0)
			var channels [4]float64
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					wx, wy := 1-fx, 1-fy
					if dx == 1 {
						wx = fx
					}
					if dy == 1 {
						wy = fy
					}
					r, g, b, a := src.At(left+min(x0+dx, side-1), top+min(y0+dy, side-1)).RGBA()
					for i, v := range [4]uint32{r, g, b, a} {
						channels[i] += float64(v) * wx * wy / 257
					}
				}
			}
			dst.SetRGBA(x, y, color.RGBA{uint8(math.Round(channels[0])), uint8(math.Round(channels[1])), uint8(math.Round(channels[2])), uint8(math.Round(channels[3]))})
		}
	}
	return dst
}

func (s *server) deleteAvatar(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Store.DeleteAvatar(r.Context(), userFrom(r.Context()).ID); err != nil {
		s.fail(w, "delete avatar", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getAvatar(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("userID"), 10, 64)
	if err != nil || id < 1 {
		http.NotFound(w, r)
		return
	}
	data, updated, err := s.cfg.Store.Avatar(r.Context(), id)
	if err != nil || (r.URL.Query().Get("v") != "" && r.URL.Query().Get("v") != strconv.FormatInt(updated, 10)) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Write(data)
}
