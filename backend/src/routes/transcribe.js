const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');
const router = express.Router();

// ─── Constants ───────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const WHISPER_TIMEOUT_MS = 60_000;             // 60 seconds

// Store audio in memory (not disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// Multer error handler
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

// ─── Detect Whisper API format ────────────────────────────────
// Some Whisper Docker images (e.g. ahmetoner/whisper-asr-webservice) accept:
//   POST /transcribe  application/json  { media_url, metadata }
// Others (e.g. faster-whisper-server) accept:
//   POST /transcribe  multipart/form-data  audio_file=<binary>
// We try JSON first (serving the file temporarily), then fall back to multipart.

// Global map to hold audio buffers temporarily so Docker can download them
const tempAudioFiles = new Map();

// Quick route to serve the audio to Docker
router.get('/temp/:id', (req, res) => {
    const buffer = tempAudioFiles.get(req.params.id);
    if (!buffer) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'audio/webm');
    res.send(buffer);
});

async function callWhisperJson(whisperUrl, audioBuffer, lang) {
    // Generate a temporary ID to serve the file over HTTP
    const id = Date.now().toString() + Math.floor(Math.random() * 10000).toString();
    tempAudioFiles.set(id, audioBuffer);

    // Docker bridge to reach the host's backend running on port 3001
    // (If the backend was remote, we'd use the public domain instead)
    const mediaUrl = `http://host.docker.internal:3001/api/transcribe/temp/${id}`;

    try {
        const body = JSON.stringify({
            media_url: mediaUrl,
            metadata: `lang=${lang}`
        });

        const res = await fetch(`${whisperUrl}/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            timeout: WHISPER_TIMEOUT_MS,
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Whisper JSON ${res.status}: ${errText}`);
        }
        return await res.json();
    } finally {
        // Clean up memory after request finishes
        tempAudioFiles.delete(id);
    }
}

async function callWhisperMultipart(whisperUrl, audioBuffer, lang) {
    const formData = new FormData();
    formData.append('audio_file', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm',
    });
    formData.append('language', lang);

    const res = await fetch(`${whisperUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
        timeout: WHISPER_TIMEOUT_MS,
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Whisper multipart ${res.status}: ${errText}`);
    }
    return await res.json();
}

// ─── Route ───────────────────────────────────────────────────
router.post('/', upload.single('audio'), handleMulterError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const whisperUrl = process.env.WHISPER_URL || 'http://host.docker.internal:8000';
        const lang = req.body.lang || 'fr';

        console.log(`[TRANSCRIBE] ${req.file.size} bytes → ${whisperUrl} (lang: ${lang})`);

        let data;
        // Try JSON format first (media_url), fall back to multipart if it fails
        try {
            data = await callWhisperJson(whisperUrl, req.file.buffer, lang);
            console.log('[TRANSCRIBE] Used JSON/media_url format');
        } catch (jsonErr) {
            console.warn('[TRANSCRIBE] JSON failed, trying multipart:', jsonErr.message);
            data = await callWhisperMultipart(whisperUrl, req.file.buffer, lang);
            console.log('[TRANSCRIBE] Used multipart format');
        }

        // Normalize response — different Whisper versions return different fields
        const transcript = data.text || data.transcription || data.result || '';
        const detectedLang = data.language || lang;

        console.log(`[TRANSCRIBE] Result: "${transcript.substring(0, 80)}"`);
        res.json({ transcript, language: detectedLang });

    } catch (err) {
        let userError = err.message;
        if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
            userError = `Whisper injoignable — vérifiez que le conteneur Docker est lancé`;
        } else if (err.type === 'request-timeout' || err.message?.includes('timeout')) {
            userError = `Whisper timeout (60s) — le modèle est peut-être surchargé`;
        }
        console.error('[TRANSCRIBE ERROR]', userError);
        res.status(500).json({ error: userError });
    }
});

module.exports = router;
