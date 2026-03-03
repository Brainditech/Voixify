import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RecordingState = 'idle' | 'recording' | 'processing' | 'correcting' | 'done' | 'error';
export type CorrectionLevel = 'off' | 'minimal' | 'standard' | 'advanced';
export type AppMode = 'dictate' | 'ask';
export type Lang = 'fr' | 'en';
export type TranscriptionSource = 'deepgram' | 'whisper';

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
    ollamaModel: string;
    deepgramModel: string;
    transcriptionSource: TranscriptionSource;
    autopasteEnabled: boolean;
    llmCorrectionEnabled: boolean;
    // Direct API endpoints (no backend proxy needed)
    whisperUrl: string;
    ollamaUrl: string;

    // UI
    showSettings: boolean;
    showHistory: boolean;
    serviceStatus: ServiceStatus;
    availableModels: string[];
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
    setOllamaModel: (m: string) => void;
    setDeepgramModel: (m: string) => void;
    setTranscriptionSource: (s: TranscriptionSource) => void;
    setAutopasteEnabled: (v: boolean) => void;
    setLlmCorrectionEnabled: (v: boolean) => void;
    setWhisperUrl: (u: string) => void;
    setOllamaUrl: (u: string) => void;
    setShowSettings: (v: boolean) => void;
    setShowHistory: (v: boolean) => void;
    setServiceStatus: (s: Partial<ServiceStatus>) => void;
    setAvailableModels: (m: string[]) => void;
    addToHistory: (item: HistoryItem) => void;
    clearHistory: () => void;
    reset: () => void;
}

export const useVoixifyStore = create<VoixifyState>()(
    persist(
        (set) => ({
            recordingState: 'idle',
            rawTranscript: '',
            correctedText: '',
            errorMessage: null,
            toastMessage: null,

            lang: 'fr',
            mode: 'dictate',
            correctionLevel: 'standard',
            hotkey: 'CommandOrControl+Space',
            ollamaModel: 'kimi-k2.5:cloud',
            deepgramModel: 'nova-3',
            transcriptionSource: 'deepgram',
            autopasteEnabled: true,
            llmCorrectionEnabled: false,
            whisperUrl: 'http://localhost:8000',   // Direct Whisper Docker
            ollamaUrl: 'http://localhost:11434',   // Direct Ollama

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
            setOllamaModel: (m) => set({ ollamaModel: m }),
            setDeepgramModel: (m) => set({ deepgramModel: m }),
            setTranscriptionSource: (s) => set({ transcriptionSource: s }),
            setAutopasteEnabled: (v) => set({ autopasteEnabled: v }),
            setLlmCorrectionEnabled: (v) => set({ llmCorrectionEnabled: v }),
            setWhisperUrl: (u) => set({ whisperUrl: u }),
            setOllamaUrl: (u) => set({ ollamaUrl: u }),
            setShowSettings: (v) => set({ showSettings: v }),
            setShowHistory: (v) => set({ showHistory: v }),
            setServiceStatus: (s) => set((st) => ({ serviceStatus: { ...st.serviceStatus, ...s } })),
            setAvailableModels: (m) => set({ availableModels: m }),
            addToHistory: (item) => set((st) => ({ history: [item, ...st.history].slice(0, 100) })),
            clearHistory: () => set({ history: [] }),
            reset: () => set({ recordingState: 'idle', rawTranscript: '', correctedText: '', errorMessage: null, toastMessage: null }),
        }),
        {
            name: 'voixify-v4',
            version: 3,
            migrate: (persistedState: any, version: number) => {
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
                return state;
            },
            partialize: (s) => ({
                lang: s.lang, mode: s.mode, correctionLevel: s.correctionLevel,
                hotkey: s.hotkey, ollamaModel: s.ollamaModel, deepgramModel: s.deepgramModel,
                transcriptionSource: s.transcriptionSource, autopasteEnabled: s.autopasteEnabled, whisperUrl: s.whisperUrl,
                ollamaUrl: s.ollamaUrl, history: s.history,
            }),
        }
    )
);
