// Type definitions for the `window.voixify` IPC bridge exposed by preload.cjs.
// This is the single source of truth for the renderer ↔ main contract — keep it
// in sync with the contextBridge.exposeInMainWorld(...) surface in preload.cjs.

export interface ProcessAudioPayload {
    audio: Uint8Array;
    lang: string;
    deepgramModel?: string;
    deepgramApiKey?: string;
    whisperApiKey?: string;
    transcriptionSource?: string;
    whisperUrl?: string;
}

export interface ProcessAudioResult {
    success: boolean;
    transcript?: string;
    audioPath?: string;
    error?: string;
}

export interface PickedFile {
    path: string;
    name: string;
    sizeBytes: number;
}

export interface TranscribeFilePayload {
    filePath: string;
    language?: string;
}

export interface TranscribeResult {
    success: boolean;
    transcript?: string;
    durationMs?: number;
    fileName?: string;
    sizeBytes?: number;
    error?: string;
}

export interface SaveTranscriptionPayload {
    content: string;
    format: 'txt' | 'md';
    suggestedName?: string;
}

export interface SaveTranscriptionResult {
    success?: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
}

export interface UpdateHotkeyResult {
    success: boolean;
    error?: string;
}

export interface VoixifyApi {
    // Pill lifecycle
    rendererReady(): Promise<void>;
    processAudio(payload: ProcessAudioPayload): Promise<ProcessAudioResult>;
    recordingEnded(): Promise<void>;
    recordingArmed(): Promise<void>;
    hideWindow(): Promise<void>;
    pasteText(text: string): Promise<void>;
    copyToClipboard(text: string): Promise<boolean>;

    // Settings
    openSettings(): Promise<void>;
    closeSettings(): Promise<void>;
    updateHotkey(key: string, showWarning?: boolean): Promise<UpdateHotkeyResult>;
    updateSettings(partial: Record<string, unknown>): Promise<boolean>;
    getSettings(): Promise<Record<string, unknown> | null>;
    getBackendUrl(): Promise<string>;

    // File transcription window (audio/video upload)
    openTranscribe(): Promise<void>;
    closeTranscribe(): Promise<void>;
    pickTranscriptionFile(): Promise<PickedFile | null>;
    transcribeFile(payload: TranscribeFilePayload): Promise<TranscribeResult>;
    saveTranscription(payload: SaveTranscriptionPayload): Promise<SaveTranscriptionResult>;

    // Events from main → renderer
    onStateChange(cb: (state: string) => void): void;
    onStopRecording(cb: () => void): void;
    onArmRecording(cb: () => void): void;
    onSettingsChanged(cb: (settings: Record<string, unknown>) => void): void;
}

declare global {
    interface Window {
        voixify?: VoixifyApi;
    }
}
