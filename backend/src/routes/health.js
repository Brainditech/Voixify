const express = require('express');
const router = express.Router();
// Uses Node 18+ native fetch — no `node-fetch` dep needed.

router.get('/', async (req, res) => {
    const whisperUrl = process.env.WHISPER_URL || 'http://127.0.0.1:9990';
    const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

    const checks = await Promise.allSettled([
        // Native fetch uses AbortSignal.timeout instead of node-fetch's `timeout` opt.
        fetch(`${whisperUrl}/`, { method: 'GET', signal: AbortSignal.timeout(3000) }),
        fetch(`${ollamaUrl}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(3000) }),
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
