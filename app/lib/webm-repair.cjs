// Chromium's MediaRecorder for live audio puts the EBML header several KB into
// the stream rather than at byte 0 (typically ~1838 B for WebM/Opus). Decoders
// downstream — Deepgram, faster-whisper, ffmpeg — refuse the file when they
// see noise before the magic bytes.
//
// Strategy: scan the first 64 KB for the EBML magic `1A 45 DF A3`. Anything
// before that is leading garbage; slice it off. If we don't find the magic at
// all (very corrupted buffer), return null so the caller can decide whether to
// abort or send the raw bytes anyway.

const MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const SCAN_WINDOW = 65536;

function fixWebmBuffer(buf) {
    if (!buf || typeof buf.length !== 'number' || buf.length < 4) return null;
    const limit = Math.min(buf.length - 4, SCAN_WINDOW);
    for (let i = 0; i <= limit; i++) {
        if (
            buf[i] === MAGIC[0] &&
            buf[i + 1] === MAGIC[1] &&
            buf[i + 2] === MAGIC[2] &&
            buf[i + 3] === MAGIC[3]
        ) {
            return i > 0 ? buf.slice(i) : buf;
        }
    }
    return null;
}

module.exports = { fixWebmBuffer };
