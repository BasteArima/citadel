package speech

// Duration returns the length of an MP3 stream in seconds by walking its frames.
// ID3 tags and junk between frames are skipped.
func Duration(b []byte) float64 {
	sec := 0.0
	i := skipID3(b)
	for i+4 <= len(b) {
		if b[i] != 0xFF || b[i+1]&0xE0 != 0xE0 {
			i++
			continue
		}
		size, samples, rate := frame(b[i : i+4])
		if size == 0 {
			i++
			continue
		}
		sec += float64(samples) / float64(rate)
		i += size
	}
	return sec
}

func skipID3(b []byte) int {
	if len(b) < 10 || string(b[:3]) != "ID3" {
		return 0
	}
	n := int(b[6]&0x7F)<<21 | int(b[7]&0x7F)<<14 | int(b[8]&0x7F)<<7 | int(b[9]&0x7F)
	return 10 + n
}

var (
	// kbit/s by bitrate index: MPEG-1 Layer III and MPEG-2/2.5 Layer III
	bitrates1 = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
	bitrates2 = [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}
	rates     = map[byte][3]int{3: {44100, 48000, 32000}, 2: {22050, 24000, 16000}, 0: {11025, 12000, 8000}}
)

// frame reads a Layer III frame header: its size in bytes, samples and sample rate.
// Anything else returns size 0.
func frame(h []byte) (size, samples, rate int) {
	version := (h[1] >> 3) & 3 // 3 — MPEG-1, 2 — MPEG-2, 0 — MPEG-2.5
	layer := (h[1] >> 1) & 3   // 1 — Layer III
	if version == 1 || layer != 1 {
		return 0, 0, 0
	}
	bi, ri, pad := h[2]>>4, (h[2]>>2)&3, int(h[2]>>1)&1
	if ri == 3 {
		return 0, 0, 0
	}
	rate = rates[version][ri]
	kbps := bitrates2[bi]
	samples = 576
	if version == 3 {
		kbps = bitrates1[bi]
		samples = 1152
	}
	if kbps == 0 {
		return 0, 0, 0
	}
	size = samples/8*kbps*1000/rate + pad
	return size, samples, rate
}
