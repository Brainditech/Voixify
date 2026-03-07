const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ─── Constants ───────────────────────────────────────────────
const OLLAMA_TIMEOUT_MS = 60_000; // 60 seconds
const VALID_LEVELS = ['minimal', 'standard', 'advanced'];

// Correction prompts by language — STRICT: never alter meaning
const PROMPTS = {
    fr: {
        system: `Tu es un correcteur de dictée vocale en français.
Tu reçois un texte brut transcrit par un système de reconnaissance vocale.

RÈGLES STRICTES ET NON NÉGOCIABLES :
1. Tu ne changes JAMAIS le fond ni le sens du message
2. Tu ne rajoutes AUCUNE idée, phrase ou information absente du texte original
3. Tu ne supprimes AUCUNE idée ou information présente dans le texte original
4. Tu ne reformules PAS les phrases — tu les nettoies uniquement
5. Tu gardes le vocabulaire et le registre de langue de l'utilisateur
6. Tu supprimes uniquement les hésitations orales : "euh", "hum", "ben", "quoi", "voilà", "donc euh", "en fait"
7. Tu réponds UNIQUEMENT avec le texte corrigé, sans commentaire, explication ni métadonnée`,
        minimal: "Supprime les hésitations (euh, hum, ben) et ajoute la ponctuation de base (points, virgules). Ne change RIEN d'autre.",
        standard: "Supprime les hésitations, corrige les fautes d'orthographe et de grammaire, ajoute la ponctuation. Ne reformule PAS et ne change PAS les mots choisis par l'utilisateur.",
        advanced: "Supprime les hésitations, corrige orthographe/grammaire/ponctuation, et améliore la fluidité SANS changer les mots, les idées ni le sens. Ne rajoute rien, ne supprime aucune idée.",
        ask: `Tu es un assistant de communication. L'utilisateur te donne une instruction vocale et tu génères un message complet et approprié dans la langue demandée. Adapte le ton selon le contexte (email = formel, message = décontracté). Réponds uniquement avec le message généré, sans explication.`
    },
    en: {
        system: `You are a voice dictation corrector.
You receive raw text transcribed by a speech recognition system.

STRICT, NON-NEGOTIABLE RULES:
1. NEVER change the meaning or substance of the message
2. NEVER add ideas, sentences or information not in the original
3. NEVER remove ideas or information present in the original  
4. Do NOT rephrase sentences — only clean them up
5. Keep the user's vocabulary and language register
6. Only remove oral hesitations: "um", "uh", "like", "you know", "so", "basically", "I mean"
7. Reply ONLY with the corrected text — no comments, explanations or metadata`,
        minimal: "Remove hesitations (um, uh, like) and add basic punctuation (periods, commas). Change NOTHING else.",
        standard: "Remove hesitations, fix spelling and grammar mistakes, add punctuation. Do NOT rephrase or change the user's word choices.",
        advanced: "Remove hesitations, fix spelling/grammar/punctuation, and improve flow WITHOUT changing words, ideas or meaning. Add nothing, remove no ideas.",
        ask: `You are a communication assistant. The user gives you a voice instruction and you generate a complete, appropriate message. Adapt tone to context (email = formal, message = casual). Reply only with the generated message, no explanation.`
    }
};

router.post('/', async (req, res) => {
    try {
        const { text, lang = 'fr', level = 'standard', mode = 'correct', context = '' } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ error: 'No text provided' });
        }

        // Validate correction level against known values
        const safeLevel = VALID_LEVELS.includes(level) ? level : 'standard';
        if (level !== safeLevel) {
            console.warn(`[CORRECT] Unknown level "${level}", falling back to "standard"`);
        }

        const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
        const model = req.body.model || process.env.OLLAMA_MODEL || 'llama3';
        const prompts = PROMPTS[lang] || PROMPTS.fr;

        let systemPrompt, userPrompt;

        if (mode === 'ask') {
            systemPrompt = prompts.ask;
            userPrompt = context ? `Contexte: ${context}\n\nInstruction vocale: ${text}` : `Instruction vocale: ${text}`;
        } else {
            systemPrompt = `${prompts.system}\n\nNiveau de correction: ${prompts[safeLevel]}`;
            userPrompt = `Texte à corriger:\n${text}`;
        }

        const ollamaPayload = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            stream: false,
            options: {
                temperature: 0.1,
                top_p: 0.85,
                num_predict: 1024
            }
        };

        console.log(`[CORRECT] Model: ${model} | Lang: ${lang} | Level: ${safeLevel} | Mode: ${mode}`);
        console.log(`[CORRECT] Input: "${text.substring(0, 80)}..."`);

        const ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ollamaPayload),
            timeout: OLLAMA_TIMEOUT_MS,
        });

        if (!ollamaRes.ok) {
            const errText = await ollamaRes.text();
            throw new Error(`Ollama API error ${ollamaRes.status}: ${errText}`);
        }

        const data = await ollamaRes.json();
        const corrected = data.message?.content || data.response || text;
        console.log(`[CORRECT] Output: "${corrected.substring(0, 80)}..."`);

        res.json({ correctedText: corrected.trim(), model });
    } catch (err) {
        // Build a user-friendly error message
        let userError = err.message;
        if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
            userError = `Ollama injoignable sur ${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'} — vérifiez qu'Ollama est lancé`;
        } else if (err.type === 'request-timeout' || err.message?.includes('timeout')) {
            userError = `Ollama timeout (60s) — le modèle est peut-être trop lourd`;
        } else if (err.message?.includes('404') || err.message?.includes('model')) {
            userError = `Modèle IA introuvable — vérifiez le nom du modèle dans les paramètres`;
        }

        console.error('[CORRECT ERROR]', userError);
        // Graceful fallback: return original text so dictation still works
        res.status(500).json({ error: userError, correctedText: req.body.text });
    }
});

module.exports = router;
