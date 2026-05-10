const express = require('express');
const router = express.Router();
// Uses Node 18+ native fetch — no `node-fetch` dep needed.

router.get('/', async (req, res) => {
    try {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!tagsRes.ok) throw new Error('Ollama not reachable');
        const data = await tagsRes.json();
        const models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
        res.json({ models });
    } catch (err) {
        res.status(503).json({ error: err.message, models: [] });
    }
});

module.exports = router;
