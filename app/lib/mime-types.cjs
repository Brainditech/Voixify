// Whisper accepts mp3, mp4, mpeg, mpga, m4a, wav, webm by spec, and most
// faster-whisper deployments will also handle anything ffmpeg can read
// (mov, mkv, avi, ogg, flac, opus, aac). This table maps the user-supplied
// file extension to a sensible Content-Type so the multipart upload looks
// well-formed to whatever stack sits behind /transcribe.
//
// Keys are lowercase including the dot. Lookups must lowercase the input
// extension — Windows file pickers preserve case ("Audio.MP3").

const path = require('path');

const MIME_BY_EXT = {
    // Audio
    '.mp3': 'audio/mpeg',
    '.mpga': 'audio/mpeg',
    '.mpeg': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    // Video — Whisper-side ffmpeg extracts the audio track
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
};

function extOf(filePath) {
    if (typeof filePath !== 'string' || !filePath) return '';
    return path.extname(filePath).toLowerCase();
}

function mimeForFile(filePath) {
    return MIME_BY_EXT[extOf(filePath)] || 'application/octet-stream';
}

function isSupportedExt(filePath) {
    return Object.prototype.hasOwnProperty.call(MIME_BY_EXT, extOf(filePath));
}

// Sorted list, useful as the dialog filter `extensions` array (no dot).
const SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXT).map(e => e.slice(1)).sort();

module.exports = { MIME_BY_EXT, mimeForFile, isSupportedExt, SUPPORTED_EXTENSIONS };
