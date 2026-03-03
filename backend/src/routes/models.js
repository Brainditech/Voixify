const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
        const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { timeout: 5000 });
        if (!tagsRes.ok) throw new Error('Ollama not reachable');
        const data = await tagsRes.json();
        const models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
        res.json({ models });
    } catch (err) {
        res.status(503).json({ error: err.message, models: [] });
    }
});

module.exports = router;
