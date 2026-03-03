const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ─── Constants ───────────────────────────────────────────────
const OLLAMA_TIMEOUT_MS = 60_000; // 60 seconds
const VALID_LEVELS = ['minimal', 'standard', 'advanced'];

// Correction prompts by language
const PROMPTS = {
    fr: {
        system: `Tu es un correcteur expert de dictée vocale en français. 
Ton rôle est de corriger un texte transcrit par un système STT (speech-to-text).
RÈGLES ABSOLUES :
- Preserve STRICTEMENT le sens et l'intention originale
- Supprime les mots de remplissage : "euh", "hum", "donc euh", "voilà", "ben", "quoi"
- Corrige la grammaire, l'orthographe et la ponctuation
- Ne rajoute PAS de contenu qui n'était pas dans le discours
- Ne réponds qu'avec le texte corrigé, sans explication ni métadonnée`,
        minimal: "Supprime uniquement les mots de remplissage et ajoute la ponctuation de base.",
        standard: "Corrige la grammaire, supprime les fillers, ajoute la ponctuation correcte.",
        advanced: "Reformule pour un style professionnel fluide tout en préservant le sens exact.",
        ask: `Tu es un assistant de communication. L'utilisateur te donne une instruction vocale et tu génères un message complet et approprié dans la langue demandée. Adapte le ton selon le contexte (email = formel, message = décontracté). Réponds uniquement avec le message généré, sans explication.`
    },
    en: {
        system: `You are an expert voice dictation corrector.
Your role is to correct text transcribed by a speech-to-text system.
ABSOLUTE RULES:
- Strictly preserve the original meaning and intent
- Remove filler words: "um", "uh", "like", "you know", "so", "basically"
- Fix grammar, spelling and punctuation
- Do NOT add content that wasn't in the speech
- Reply ONLY with the corrected text, no explanation or metadata`,
        minimal: "Remove only filler words and add basic punctuation.",
        standard: "Fix grammar, remove fillers, add proper punctuation.",
        advanced: "Rephrase for a professional, fluent style while preserving exact meaning.",
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

        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
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
                temperature: 0.3,
                top_p: 0.9,
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
        console.error('[CORRECT ERROR]', err.message);
        // Fallback: return original text if Ollama fails
        res.status(500).json({ error: err.message, correctedText: req.body.text });
    }
});

module.exports = router;
