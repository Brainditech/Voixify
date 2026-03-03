const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

router.get('/', async (req, res) => {
    const whisperUrl = process.env.WHISPER_URL || 'http://host.docker.internal:8000';
    const ollamaUrl = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';

    const checks = await Promise.allSettled([
        // Check Whisper — allSettled never rejects, so no .catch() needed
        fetch(`${whisperUrl}/`, { method: 'GET', timeout: 3000 }),
        // Check Ollama
        fetch(`${ollamaUrl}/api/tags`, { method: 'GET', timeout: 3000 }),
    ]);

    const whisperOk = checks[0].status === 'fulfilled' && checks[0].value?.ok === true;
    const ollamaOk = checks[1].status === 'fulfilled' && checks[1].value?.ok === true;

    res.json({
        status: whisperOk && ollamaOk ? 'healthy' : 'degraded',
        services: {
            whisper: { url: whisperUrl, status: whisperOk ? 'online' : 'offline' },
            ollama: { url: ollamaUrl, status: ollamaOk ? 'online' : 'offline', model: process.env.OLLAMA_MODEL }
        },
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
