import { describe, it, expect } from 'vitest';
import { migrateVoixifyState } from '../voixifyStore';

// migrate() is called by Zustand `persist` whenever the loaded state has a
// version below the current one. Each `if (version < N)` patch must be
// idempotent and forward-only — we verify that here without spinning up
// the full Zustand store.

describe('migrateVoixifyState', () => {
    it('v1 → v8: applies every default the user never had', () => {
        const v1 = { lang: 'fr', whisperUrl: 'http://127.0.0.1:8000' };
        const out = migrateVoixifyState(v1, 1);
        expect(out.hotkey).toBe('CommandOrControl+Space'); // v2
        expect(out.deepgramModel).toBe('nova-3');          // v2
        expect(out.transcriptionSource).toBe('deepgram');  // v2
        expect(out.llmCorrectionEnabled).toBe(false);      // v3
        expect(out.whisperUrl).toBe('http://127.0.0.1:9990'); // v4 patches the legacy 8000 URL
        expect(out.lang).toBe('fr');                       // v5 preserves explicit langs
        expect(out.hotkeyMode).toBe('hold');               // v6
        expect(out.whisperApiKey).toBeUndefined();         // v8 strips it
        expect(out.deepgramApiKey).toBeUndefined();        // v8 strips it
    });

    it('v3 → v8: skips already-applied earlier migrations', () => {
        const v3 = {
            hotkey: 'F9',
            deepgramModel: 'nova-2',
            transcriptionSource: 'whisper',
            llmCorrectionEnabled: true,
            whisperUrl: 'http://my.host:9990',
            lang: 'en',
        };
        const out = migrateVoixifyState(v3, 3);
        expect(out.hotkey).toBe('F9');                     // user value preserved
        expect(out.deepgramModel).toBe('nova-2');
        expect(out.transcriptionSource).toBe('whisper');
        expect(out.llmCorrectionEnabled).toBe(true);
        expect(out.whisperUrl).toBe('http://my.host:9990'); // v4 doesn't touch a non-legacy URL
        expect(out.lang).toBe('en');
        expect(out.hotkeyMode).toBe('hold');               // v6 default applied
    });

    it('v4: replaces the legacy localhost:8000 whisperUrl', () => {
        const v3 = { whisperUrl: 'http://localhost:8000' };
        const out = migrateVoixifyState(v3, 3);
        expect(out.whisperUrl).toBe('http://127.0.0.1:9990');
    });

    it('v4: leaves a custom whisperUrl untouched', () => {
        const v3 = { whisperUrl: 'http://192.168.1.50:9990' };
        const out = migrateVoixifyState(v3, 3);
        expect(out.whisperUrl).toBe('http://192.168.1.50:9990');
    });

    it('v5: only fills in lang when missing — never overrides', () => {
        const withLang = migrateVoixifyState({ lang: 'fr' }, 4);
        expect(withLang.lang).toBe('fr');

        const noLang = migrateVoixifyState({}, 4);
        expect(noLang.lang).toBe('auto');
    });

    it('v8: scrubs plaintext API keys from the localStorage copy', () => {
        const v7 = {
            deepgramApiKey: 'ag_secret_123',
            whisperApiKey: 'wsp_secret_456',
            hotkey: 'CommandOrControl+Space',
        };
        const out = migrateVoixifyState(v7, 7);
        expect(out.deepgramApiKey).toBeUndefined();
        expect(out.whisperApiKey).toBeUndefined();
        expect(out.hotkey).toBe('CommandOrControl+Space');
    });

    it('v7 → v8: the v7→v8 hop alone strips keys without re-running v2-v7', () => {
        const v7 = {
            deepgramApiKey: 'leaked',
            whisperApiKey: 'also leaked',
            hotkey: 'F9',
            deepgramModel: 'nova-2',
            transcriptionSource: 'whisper',
            llmCorrectionEnabled: true,
            whisperUrl: 'http://my.host:9990',
            lang: 'en',
            hotkeyMode: 'toggle',
        };
        const out = migrateVoixifyState(v7, 7);
        expect(out.deepgramApiKey).toBeUndefined();
        expect(out.whisperApiKey).toBeUndefined();
        expect(out.hotkeyMode).toBe('toggle'); // user value preserved
    });

    it('v9: defaults lowLatencyMode to true when missing', () => {
        const v8 = { lang: 'fr', hotkeyMode: 'hold' };
        const out = migrateVoixifyState(v8, 8);
        expect(out.lowLatencyMode).toBe(true);
    });

    it('v9: preserves an explicit lowLatencyMode=false from a future state', () => {
        const v8 = { lang: 'fr', lowLatencyMode: false };
        const out = migrateVoixifyState(v8, 8);
        expect(out.lowLatencyMode).toBe(false);
    });

    it('handles a null persisted state without throwing', () => {
        // Zustand can pass null on a fresh install with corrupted localStorage
        const out = migrateVoixifyState(null, 1);
        // We can't assert specific defaults here (the migration mutates a null
        // input via `...null` which becomes `{}`), but the call must not throw.
        expect(out).toBeDefined();
    });
});
