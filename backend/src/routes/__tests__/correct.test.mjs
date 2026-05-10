import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

// The route is CommonJS (module.exports = router); Node ESM can default-import
// CJS modules. Using createRequire keeps the resolution explicit and side-steps
// any tooling that gets confused by mixed-mode imports.
const requireCjs = createRequire(import.meta.url);
const correctRoute = requireCjs('../correct');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/correct', correctRoute);
    return app;
}

describe('POST /api/correct', () => {
    let fetchSpy;

    beforeEach(() => {
        // Default: Ollama returns a successful corrected message.
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                message: { content: 'Bonjour, comment ça va ?' },
                load_duration: 0,
                prompt_eval_duration: 0,
                eval_duration: 0,
                eval_count: 0,
            }),
            text: async () => '',
        });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('returns 400 when no text is provided', async () => {
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({ text: '' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns 400 for whitespace-only text', async () => {
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({ text: '   \n\t  ' });
        expect(res.status).toBe(400);
    });

    it('falls back to "standard" when level is unknown', async () => {
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({
            text: 'allo allo',
            lang: 'fr',
            level: 'cosmic',
        });
        expect(res.status).toBe(200);
        const ollamaPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const systemMsg = ollamaPayload.messages.find(m => m.role === 'system').content;
        expect(systemMsg).toContain('Supprime les hésitations');
    });

    it('falls back to French prompts when lang is unsupported', async () => {
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({
            text: 'salut',
            lang: 'klingon',
        });
        expect(res.status).toBe(200);
        const ollamaPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const systemMsg = ollamaPayload.messages.find(m => m.role === 'system').content;
        expect(systemMsg).toContain('correcteur de dictée vocale en français');
    });

    it('routes English requests through the English prompts', async () => {
        const app = buildApp();
        await request(app).post('/api/correct').send({
            text: 'um hello there',
            lang: 'en',
        });
        const ollamaPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        const systemMsg = ollamaPayload.messages.find(m => m.role === 'system').content;
        expect(systemMsg).toContain('voice dictation corrector');
    });

    it('returns the corrected text from Ollama on success', async () => {
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({
            text: 'Bonjour comment ca va',
            lang: 'fr',
        });
        expect(res.status).toBe(200);
        expect(res.body.correctedText).toBe('Bonjour, comment ça va ?');
    });

    it('falls back to original text when Ollama is unreachable (ECONNREFUSED)', async () => {
        const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
            cause: { code: 'ECONNREFUSED' },
        });
        fetchSpy.mockRejectedValueOnce(err);
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({
            text: 'bonjour',
            lang: 'fr',
            ollamaUrl: 'http://127.0.0.1:11434',
        });
        expect(res.status).toBe(500);
        expect(res.body.correctedText).toBe('bonjour');
        expect(res.body.error).toContain('Ollama injoignable');
    });

    it('returns a clear timeout message when Ollama AbortSignal fires', async () => {
        const err = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
        fetchSpy.mockRejectedValueOnce(err);
        const app = buildApp();
        const res = await request(app).post('/api/correct').send({
            text: 'bonjour',
            lang: 'fr',
        });
        expect(res.status).toBe(500);
        expect(res.body.error).toContain('timeout');
        expect(res.body.correctedText).toBe('bonjour');
    });

    it('passes a custom ollamaUrl through to fetch', async () => {
        const app = buildApp();
        await request(app).post('/api/correct').send({
            text: 'bonjour',
            lang: 'fr',
            ollamaUrl: 'http://custom-host:11434',
        });
        const url = fetchSpy.mock.calls[0][0];
        expect(url).toBe('http://custom-host:11434/api/chat');
    });

    it('caps num_predict at 512 and uses 3× input length for short text', async () => {
        const app = buildApp();
        const shortText = 'allo';
        await request(app).post('/api/correct').send({ text: shortText, lang: 'fr' });
        const ollamaPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(ollamaPayload.options.num_predict).toBe(shortText.length * 3);

        fetchSpy.mockClear();
        const longText = 'a'.repeat(1000);
        await request(app).post('/api/correct').send({ text: longText, lang: 'fr' });
        const ollamaPayload2 = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(ollamaPayload2.options.num_predict).toBe(512);
    });
});
