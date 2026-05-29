import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';

// jsdom doesn't ship crypto.randomUUID; useVoixify calls it after a successful
// transcription. Provide a stable stub so tests don't crash.
if (!('randomUUID' in crypto)) {
    (crypto as any).randomUUID = () =>
        'test-uuid-' + Math.random().toString(36).slice(2, 10);
}

// Default no-op voixify bridge. Individual tests override this via
// installMockVoixifyApi() below.
export interface MockVoixifyApi {
    rendererReady: ReturnType<typeof vi.fn>;
    processAudio: ReturnType<typeof vi.fn>;
    recordingEnded: ReturnType<typeof vi.fn>;
    hideWindow: ReturnType<typeof vi.fn>;
    pasteText: ReturnType<typeof vi.fn>;
    copyToClipboard: ReturnType<typeof vi.fn>;
    openSettings: ReturnType<typeof vi.fn>;
    closeSettings: ReturnType<typeof vi.fn>;
    updateHotkey: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
    getSettings: ReturnType<typeof vi.fn>;
    getBackendUrl: ReturnType<typeof vi.fn>;
    onStateChange: ReturnType<typeof vi.fn>;
    onStopRecording: ReturnType<typeof vi.fn>;
    onSettingsChanged: ReturnType<typeof vi.fn>;
    // File transcription
    openTranscribe: ReturnType<typeof vi.fn>;
    closeTranscribe: ReturnType<typeof vi.fn>;
    pickTranscriptionFile: ReturnType<typeof vi.fn>;
    transcribeFile: ReturnType<typeof vi.fn>;
    saveTranscription: ReturnType<typeof vi.fn>;
    // Toast notifications
    notify: ReturnType<typeof vi.fn>;
    hideToast: ReturnType<typeof vi.fn>;
    onToast: ReturnType<typeof vi.fn>;
}

export function installMockVoixifyApi(overrides: Partial<MockVoixifyApi> = {}): MockVoixifyApi {
    const base: MockVoixifyApi = {
        rendererReady: vi.fn().mockResolvedValue(undefined),
        processAudio: vi.fn().mockResolvedValue({ success: true, transcript: 'hello' }),
        recordingEnded: vi.fn().mockResolvedValue(undefined),
        hideWindow: vi.fn().mockResolvedValue(undefined),
        pasteText: vi.fn().mockResolvedValue(undefined),
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
        openSettings: vi.fn().mockResolvedValue(undefined),
        closeSettings: vi.fn().mockResolvedValue(undefined),
        updateHotkey: vi.fn().mockResolvedValue({ success: true }),
        updateSettings: vi.fn().mockResolvedValue(true),
        getSettings: vi.fn().mockResolvedValue({}),
        getBackendUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3001'),
        onStateChange: vi.fn(),
        onStopRecording: vi.fn(),
        onSettingsChanged: vi.fn(),
        openTranscribe: vi.fn().mockResolvedValue(undefined),
        closeTranscribe: vi.fn().mockResolvedValue(undefined),
        pickTranscriptionFile: vi.fn().mockResolvedValue(null),
        transcribeFile: vi.fn().mockResolvedValue({ success: true, transcript: '', durationMs: 0, fileName: '', sizeBytes: 0 }),
        saveTranscription: vi.fn().mockResolvedValue({ canceled: true }),
        notify: vi.fn().mockResolvedValue(true),
        hideToast: vi.fn().mockResolvedValue(true),
        onToast: vi.fn(),
        ...overrides,
    };
    (window as any).voixify = base;
    return base;
}

afterEach(() => {
    delete (window as any).voixify;
    vi.clearAllMocks();
});
