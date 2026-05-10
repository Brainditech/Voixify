import { useCallback, useEffect } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';

// Single source of truth: settings.json in the Electron main process.
// Each renderer (Pill window + Settings window) hydrates from it on mount and
// pushes every change back through `update-settings`. The main process then
// re-broadcasts the new state to every window so the two stores stay aligned.
//
// The hotkey is *not* synced through this hook — it has its own IPC channel
// (`update-hotkey`) because changing it requires re-registering a global
// shortcut and may fail (system conflict). Touching it via `update-settings`
// would silently swap registrations without the validation feedback.

export type SyncableSettingKey =
    | 'lang'
    | 'transcriptionSource'
    | 'deepgramModel'
    | 'deepgramApiKey'
    | 'whisperApiKey'
    | 'whisperUrl'
    | 'ollamaUrl'
    | 'ollamaModel'
    | 'correctionLevel'
    | 'llmCorrectionEnabled'
    | 'autopasteEnabled'
    | 'selectedMicId'
    | 'hotkeyMode';

// Map an incoming settings payload to the matching Zustand setter. Keys not
// listed here (e.g. `hotkey`, unknown future keys) are ignored — they have
// dedicated channels.
function applyPayloadToStore(payload: Record<string, unknown>): void {
    const s = useVoixifyStore.getState();
    if (payload.lang !== undefined) s.setLang(payload.lang as any);
    if (payload.transcriptionSource !== undefined) s.setTranscriptionSource(payload.transcriptionSource as any);
    if (payload.deepgramModel !== undefined) s.setDeepgramModel(payload.deepgramModel as any);
    if (payload.deepgramApiKey !== undefined) s.setDeepgramApiKey(payload.deepgramApiKey as any);
    if (payload.whisperApiKey !== undefined) s.setWhisperApiKey(payload.whisperApiKey as any);
    if (payload.whisperUrl !== undefined) s.setWhisperUrl(payload.whisperUrl as any);
    if (payload.ollamaUrl !== undefined) s.setOllamaUrl(payload.ollamaUrl as any);
    if (payload.ollamaModel !== undefined) s.setOllamaModel(payload.ollamaModel as any);
    if (payload.correctionLevel !== undefined) s.setCorrectionLevel(payload.correctionLevel as any);
    if (payload.llmCorrectionEnabled !== undefined) s.setLlmCorrectionEnabled(payload.llmCorrectionEnabled as any);
    if (payload.autopasteEnabled !== undefined) s.setAutopasteEnabled(payload.autopasteEnabled as any);
    if (payload.selectedMicId !== undefined) s.setSelectedMicId(payload.selectedMicId as any);
    if (payload.hotkeyMode !== undefined) s.setHotkeyMode(payload.hotkeyMode as any);
}

interface UseSyncSettingsOptions {
    // If true, also reflect `hotkey` from main into Zustand on the initial
    // hydration. Settings window needs this to display the current hotkey;
    // Pill window doesn't.
    hydrateHotkey?: boolean;
}

export function useSyncSettings({ hydrateHotkey = false }: UseSyncSettingsOptions = {}) {
    useEffect(() => {
        const api = (window as any).voixify;
        if (!api) return;

        // 1) Hydrate from main on mount — this overwrites whatever the local
        //    Zustand cache had, because settings.json is authoritative.
        api.getSettings?.().then((saved: Record<string, unknown> | null | undefined) => {
            if (!saved) return;
            applyPayloadToStore(saved);
            if (hydrateHotkey && saved.hotkey) {
                useVoixifyStore.getState().setHotkey(saved.hotkey as string);
            }
        }).catch(() => { /* main not ready yet — defaults are fine */ });

        // 2) Listen for changes coming from the *other* window. The originator
        //    of a change also receives this echo, but applying the same value
        //    twice is a no-op so we don't bother filtering.
        api.onSettingsChanged?.((settings: Record<string, unknown>) => {
            applyPayloadToStore(settings);
        });
        // intentionally [] — preload's onSettingsChanged already calls
        // removeAllListeners before each registration, so re-running this effect
        // would just churn the same listener.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Optimistic local update + push to main. The main process will broadcast
    // back to all windows including this one; that echo is a no-op.
    const setSetting = useCallback(<K extends SyncableSettingKey>(key: K, value: unknown) => {
        applyPayloadToStore({ [key]: value });
        const api = (window as any).voixify;
        api?.updateSettings?.({ [key]: value }).catch(() => { /* best effort */ });
    }, []);

    return { setSetting };
}
