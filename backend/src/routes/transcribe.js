const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const router = express.Router();

// ─── Constants ───────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const WHISPER_TIMEOUT_MS = 60_000;             // 60 seconds

// Store audio in memory (not disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// Multer error handler middleware
function handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: `File too large — maximum ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
            });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next(err);
}

router.post('/', upload.single('audio'), handleMulterError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const whisperUrl = process.env.WHISPER_URL || 'http://host.docker.internal:8000';
        const lang = req.body.lang || 'fr';

        // Build form data for Whisper
        const formData = new FormData();
        formData.append('audio_file', req.file.buffer, {
            filename: 'audio.webm',
            contentType: req.file.mimetype || 'audio/webm',
        });

        // Some Whisper APIs accept language param
        if (lang) formData.append('language', lang);

        const endpoint = `${whisperUrl}/transcribe`;
        console.log(`[TRANSCRIBE] Sending ${req.file.size} bytes to ${endpoint}`);

        const whisperRes = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
            timeout: WHISPER_TIMEOUT_MS,
        });

        if (!whisperRes.ok) {
            const errText = await whisperRes.text();
            throw new Error(`Whisper API error ${whisperRes.status}: ${errText}`);
        }

        const data = await whisperRes.json();
        console.log(`[TRANSCRIBE] Result: "${data.text || data.transcription || JSON.stringify(data)}"`);

        // Normalize Whisper response (different versions return different fields)
        const transcript = data.text || data.transcription || data.result || '';
        const detectedLang = data.language || lang;

        res.json({ transcript, language: detectedLang });
    } catch (err) {
        console.error('[TRANSCRIBE ERROR]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
