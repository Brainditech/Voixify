import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { installMockVoixifyApi } from '../../__tests__/setup';
import { useVoixifyStore } from '../../stores/voixifyStore';

// useAudioRecorder owns the mic stream and MediaRecorder — both irrelevant to
// what useVoixify orchestrates (IPC -> paste -> history). Mock it so tests run
// in jsdom without WebRTC.
//
// jsdom's Blob doesn't always implement arrayBuffer(); useVoixify calls it
// before sending audio over IPC. We hand back a Blob-shaped object whose
// arrayBuffer() resolves immediately to the bytes we care about.
function makeFakeAudioBlob() {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
    return {
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
        size: bytes.byteLength,
        type: 'audio/webm',
    } as unknown as Blob;
}

const mockRecorder = {
    isRecording: false,
    start: vi.fn(async () => { mockRecorder.isRecording = true; }),
    stop: vi.fn(async () => {
        mockRecorder.isRecording = false;
        return { blob: makeFakeAudioBlob(), duration: 100 };
    }),
};

vi.mock('../useAudioRecorder', () => ({
    useAudioRecorder: () => ({
        start: mockRecorder.start,
        stop: mockRecorder.stop,
        isRecording: () => mockRecorder.isRecording,
        getAnalyser: () => null,
    }),
}));

import { useVoixify } from '../useVoixify';

describe('useVoixify', () => {
    beforeEach(() => {
        mockRecorder.isRecording = false;
        mockRecorder.start.mockClear();
        mockRecorder.stop.mockClear();
        // Reset store to defaults — each test starts clean.
        useVoixifyStore.setState({
            llmCorrectionEnabled: false,
            correctionLevel: 'standard',
            lang: 'fr',
            transcriptionSource: 'deepgram',
            deepgramApiKey: 'fake-key',
            whisperApiKey: '',
            ollamaModel: 'llama3.2:3b',
            ollamaUrl: 'http://127.0.0.1:11434',
            whisperUrl: 'http://127.0.0.1:9990',
            deepgramModel: 'nova-3',
            history: [],
        });
    });

    it('startRecording calls start() when not already recording', async () => {
        installMockVoixifyApi();
        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.startRecording();
        });
        expect(mockRecorder.start).toHaveBeenCalledTimes(1);
    });

    it('startRecording is a no-op while already recording', async () => {
        installMockVoixifyApi();
        mockRecorder.isRecording = true;
        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.startRecording();
        });
        expect(mockRecorder.start).not.toHaveBeenCalled();
    });

    it('stopRecording sends audio to processAudio and pastes the transcript', async () => {
        const api = installMockVoixifyApi({
            processAudio: vi.fn().mockResolvedValue({ success: true, transcript: 'bonjour le monde' }),
        });
        mockRecorder.isRecording = true;
        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.stopRecording();
        });
        expect(api.processAudio).toHaveBeenCalledTimes(1);
        const payload = api.processAudio.mock.calls[0][0];
        expect(payload.audio).toBeInstanceOf(Uint8Array);
        expect(payload.lang).toBe('fr');
        expect(payload.deepgramApiKey).toBe('fake-key');
        expect(api.pasteText).toHaveBeenCalledWith('bonjour le monde');
        expect(api.recordingEnded).toHaveBeenCalled();
        // History got an entry
        expect(useVoixifyStore.getState().history).toHaveLength(1);
        expect(useVoixifyStore.getState().history[0].rawText).toBe('bonjour le monde');
    });

    it('hides the window when transcription fails', async () => {
        const api = installMockVoixifyApi({
            processAudio: vi.fn().mockResolvedValue({ success: false, error: 'API down' }),
        });
        mockRecorder.isRecording = true;
        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.stopRecording();
        });
        expect(api.hideWindow).toHaveBeenCalled();
        expect(api.pasteText).not.toHaveBeenCalled();
    });

    it('skips correction when llmCorrectionEnabled is false', async () => {
        const api = installMockVoixifyApi({
            processAudio: vi.fn().mockResolvedValue({ success: true, transcript: 'raw text' }),
        });
        const fetchSpy = vi.spyOn(global, 'fetch');
        mockRecorder.isRecording = true;

        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.stopRecording();
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(api.pasteText).toHaveBeenCalledWith('raw text');
        fetchSpy.mockRestore();
    });

    it('runs correction via /api/correct when llmCorrectionEnabled is true', async () => {
        useVoixifyStore.setState({ llmCorrectionEnabled: true, correctionLevel: 'standard' });
        const api = installMockVoixifyApi({
            processAudio: vi.fn().mockResolvedValue({ success: true, transcript: 'allo allo' }),
        });
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ correctedText: 'Allô, allô.' }),
            text: async () => '',
        } as any);
        mockRecorder.isRecording = true;

        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.stopRecording();
        });

        // Wait for the backend URL useEffect to settle if it raced
        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain('/api/correct');
        expect(init?.method).toBe('POST');
        expect(api.pasteText).toHaveBeenCalledWith('Allô, allô.');
        fetchSpy.mockRestore();
    });

    it('falls back to raw transcript when correction errors out', async () => {
        useVoixifyStore.setState({ llmCorrectionEnabled: true, correctionLevel: 'standard' });
        const api = installMockVoixifyApi({
            processAudio: vi.fn().mockResolvedValue({ success: true, transcript: 'raw text' }),
        });
        const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
        mockRecorder.isRecording = true;

        const { result } = renderHook(() => useVoixify());
        await act(async () => {
            await result.current.stopRecording();
        });

        expect(api.pasteText).toHaveBeenCalledWith('raw text');
        fetchSpy.mockRestore();
    });
});
