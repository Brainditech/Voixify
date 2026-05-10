import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecordingState = 'idle' | 'recording' | 'processing' | 'correcting' | 'done' | 'error';
export type CorrectionLevel = 'off' | 'minimal' | 'standard' | 'advanced';
export type AppMode = 'dictate' | 'ask';
export type Lang = 'fr' | 'en' | 'auto';
export type TranscriptionSource = 'deepgram' | 'whisper';
export type HotkeyMode = 'hold' | 'toggle';

export interface HistoryItem {
    id: string;
    timestamp: number;
    rawText: string;
    correctedText: string;
    audioPath?: string;
    lang: Lang;
    mode: AppMode;
    duration: number;
}

export interface ServiceStatus {
    whisper: 'online' | 'offline' | 'checking';
    ollama: 'online' | 'offline' | 'checking';
}

export interface OllamaModelInfo {
    name: string;
    sizeBytes: number;
    parameterSize: string; // "3.2B", "36.0B", "" if unknown (cloud)
    family: string;         // "llama", "qwen", "phi", "gptoss"…
    quantization: string;   // "Q4_K_M", "F16"…
    isCloud: boolean;       // ends with :cloud (remote inference)
    isEmbedding: boolean;   // not usable for chat/correction
}

interface VoixifyState {
    recordingState: RecordingState;
    rawTranscript: string;
    correctedText: string;
    errorMessage: string | null;
    toastMessage: string | null;

    // Settings (persisted)
    lang: Lang;
    mode: AppMode;
    correctionLevel: CorrectionLevel;
    hotkey: string;
    hotkeyMode: HotkeyMode;
    ollamaModel: string;
    deepgramModel: string;
    deepgramApiKey: string;
    whisperApiKey: string;
    transcriptionSource: TranscriptionSource;
    autopasteEnabled: boolean;
    llmCorrectionEnabled: boolean;
    selectedMicId: string;
    // Latency vs privacy: when true, the mic is captured continuously and a
    // 500 ms pre-roll buffer is kept so the very first phoneme is never clipped.
    // When false, the mic is released between dictations and the pill is held
    // back until MediaRecorder is confirmed active (no clipping, slight delay).
    lowLatencyMode: boolean;
    // Direct API endpoints (no backend proxy needed)
    whisperUrl: string;
    ollamaUrl: string;

    // UI
    showSettings: boolean;
    showHistory: boolean;
    serviceStatus: ServiceStatus;
    availableModels: OllamaModelInfo[];
    history: HistoryItem[];

    setRecordingState: (s: RecordingState) => void;
    setRawTranscript: (t: string) => void;
    setCorrectedText: (t: string) => void;
    setError: (m: string | null) => void;
    setToast: (m: string | null) => void;
    setLang: (l: Lang) => void;
    setMode: (m: AppMode) => void;
    setCorrectionLevel: (l: CorrectionLevel) => void;
    setHotkey: (k: string) => void;
    setHotkeyMode: (m: HotkeyMode) => void;
    setOllamaModel: (m: string) => void;
    setDeepgramModel: (m: string) => void;
    setDeepgramApiKey: (k: string) => void;
    setWhisperApiKey: (k: string) => void;
    setTranscriptionSource: (s: TranscriptionSource) => void;
    setAutopasteEnabled: (v: boolean) => void;
    setLlmCorrectionEnabled: (v: boolean) => void;
    setSelectedMicId: (id: string) => void;
    setLowLatencyMode: (v: boolean) => void;
    setWhisperUrl: (u: string) => void;
    setOllamaUrl: (u: string) => void;
    setShowSettings: (v: boolean) => void;
    setShowHistory: (v: boolean) => void;
    setServiceStatus: (s: Partial<ServiceStatus>) => void;
    setAvailableModels: (m: OllamaModelInfo[]) => void;
    addToHistory: (item: HistoryItem) => void;
    deleteHistoryItem: (id: string) => void;
    clearHistory: () => void;
    reset: () => void;
}

// Exported for unit testing — the store itself wraps it via `persist`.
export function migrateVoixifyState(persistedState: any, version: number): any {
    let state = persistedState;
    if (version < 2) {
        state = {
            ...state,
            hotkey: state?.hotkey || 'CommandOrControl+Space',
            deepgramModel: state?.deepgramModel || 'nova-3',
            transcriptionSource: state?.transcriptionSource || 'deepgram',
        };
    }
    if (version < 3) {
        state = {
            ...state,
            llmCorrectionEnabled: state?.llmCorrectionEnabled || false,
        };
    }
    if (version < 4) {
        const oldUrl = state?.whisperUrl || '';
        if (!oldUrl || oldUrl === 'http://127.0.0.1:8000' || oldUrl === 'http://localhost:8000') {
            state = {
                ...state,
                whisperUrl: 'http://127.0.0.1:9990',
            };
        }
    }
    if (version < 5) {
        if (!state?.lang) {
            state = { ...state, lang: 'auto' };
        }
    }
    if (version < 6) {
        state = { ...state, hotkeyMode: state?.hotkeyMode || 'hold' };
    }
    if (version < 7) {
        state = { ...state, whisperApiKey: state?.whisperApiKey || '' };
    }
    if (version < 8) {
        // v8: API keys are no longer persisted in localStorage. Strip them
        // from the localStorage copy so an old plaintext key doesn't linger.
        if (state) {
            delete state.deepgramApiKey;
            delete state.whisperApiKey;
        }
    }
    if (version < 9) {
        // Default ON so existing users immediately benefit from zero-clip
        // capture. Opt-out via Settings if the permanent OS mic indicator is
        // a problem.
        state = { ...state, lowLatencyMode: state?.lowLatencyMode ?? true };
    }
    return state;
}

export const useVoixifyStore = create<VoixifyState>()(
    persist(
        (set) => ({
            recordingState: 'idle',
            rawTranscript: '',
            correctedText: '',
            errorMessage: null,
            toastMessage: null,

            lang: 'auto',
            mode: 'dictate',
            correctionLevel: 'standard',
            hotkey: 'CommandOrControl+Space',
            hotkeyMode: 'hold',
            ollamaModel: 'kimi-k2.5:cloud',
            deepgramModel: 'nova-3',
            deepgramApiKey: '',
            whisperApiKey: '',
            transcriptionSource: 'deepgram',
            autopasteEnabled: true,
            llmCorrectionEnabled: false,
            selectedMicId: '',
            lowLatencyMode: true,
            whisperUrl: 'http://127.0.0.1:9990',
            ollamaUrl: 'http://127.0.0.1:11434',

            showSettings: false,
            showHistory: false,
            serviceStatus: { whisper: 'checking', ollama: 'checking' },
            availableModels: [],
            history: [],

            setRecordingState: (s) => set({ recordingState: s }),
            setRawTranscript: (t) => set({ rawTranscript: t }),
            setCorrectedText: (t) => set({ correctedText: t }),
            setError: (m) => set({ errorMessage: m }),
            setToast: (m) => set({ toastMessage: m }),
            setLang: (l) => set({ lang: l }),
            setMode: (m) => set({ mode: m }),
            setCorrectionLevel: (l) => set({ correctionLevel: l }),
            setHotkey: (k) => set({ hotkey: k }),
            setHotkeyMode: (m) => set({ hotkeyMode: m }),
            setOllamaModel: (m) => set({ ollamaModel: m }),
            setDeepgramModel: (m) => set({ deepgramModel: m }),
            setDeepgramApiKey: (k) => set({ deepgramApiKey: k }),
            setWhisperApiKey: (k) => set({ whisperApiKey: k }),
            setTranscriptionSource: (s) => set({ transcriptionSource: s }),
            setAutopasteEnabled: (v) => set({ autopasteEnabled: v }),
            setLlmCorrectionEnabled: (v) => set({ llmCorrectionEnabled: v }),
            setSelectedMicId: (id) => set({ selectedMicId: id }),
            setLowLatencyMode: (v) => set({ lowLatencyMode: v }),
            setWhisperUrl: (u) => set({ whisperUrl: u }),
            setOllamaUrl: (u) => set({ ollamaUrl: u }),
            setShowSettings: (v) => set({ showSettings: v }),
            setShowHistory: (v) => set({ showHistory: v }),
            setServiceStatus: (s) => set((st) => ({ serviceStatus: { ...st.serviceStatus, ...s } })),
            setAvailableModels: (m) => set({ availableModels: m }),
            addToHistory: (item) => set((st) => ({ history: [item, ...st.history].slice(0, 100) })),
            deleteHistoryItem: (id) => set((st) => ({ history: st.history.filter(h => h.id !== id) })),
            clearHistory: () => set({ history: [] }),
            reset: () => set({ recordingState: 'idle', rawTranscript: '', correctedText: '', errorMessage: null, toastMessage: null }),
        }),
        {
            name: 'voixify-v9',
            version: 9,
            migrate: (persistedState: any, version: number) => migrateVoixifyState(persistedState, version),
            partialize: (s) => ({
                // Settings persistence: the main process (settings.json) is now the
                // authoritative store. We keep these in localStorage too so the UI
                // doesn't flash defaults during the async IPC hydration on mount —
                // but at every mount, useSyncSettings() overwrites these values
                // with whatever the main process holds. Secrets (API keys) are
                // *deliberately* excluded so they only live encrypted on disk.
                lang: s.lang, mode: s.mode, correctionLevel: s.correctionLevel,
                hotkey: s.hotkey, hotkeyMode: s.hotkeyMode,
                ollamaModel: s.ollamaModel, deepgramModel: s.deepgramModel,
                transcriptionSource: s.transcriptionSource, autopasteEnabled: s.autopasteEnabled,
                llmCorrectionEnabled: s.llmCorrectionEnabled, selectedMicId: s.selectedMicId,
                lowLatencyMode: s.lowLatencyMode,
                whisperUrl: s.whisperUrl,
                ollamaUrl: s.ollamaUrl, history: s.history,
            }),
        }
    )
);
