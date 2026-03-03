import { useCallback, useRef } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { useVoixifyStore } from '../stores/voixifyStore';

const PROCESS_TIMEOUT_MS = 30_000; // 30s max for transcription

export function useVoixify() {
    const { start, stop, isRecording } = useAudioRecorder();
    const addToHistory = useVoixifyStore((s) => s.addToHistory);
    const processingRef = useRef(false); // prevents concurrent stop/process calls

    const startRecording = useCallback(async () => {
        if (isRecording()) return;
        try {
            await start();
        } catch (err) {
            console.error('[RECORDER] Start error:', err);
        }
    }, [start, isRecording]);

    const stopRecording = useCallback(async () => {
        if (!isRecording()) return;
        if (processingRef.current) return; // already in flight
        processingRef.current = true;

        const api = (window as any).voixify;

        try {
            const { blob, duration } = await stop();
            console.log(`[RECORDER] Stopped. Duration: ${duration}ms, Size: ${blob.size} bytes`);

            if (!api) {
                console.error('[RECORDER] IPC bridge not available');
                return;
            }

            const base64data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('FileReader failed'));
                reader.onloadend = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1]);
                };
                reader.readAsDataURL(blob);
            });

            console.log(`[API] Sending ${base64data.length} chars to main process...`);

            // Read language from the store instead of hardcoding 'fr'
            const lang = useVoixifyStore.getState().lang;

            // Timeout wrapper so the UI never gets permanently stuck in 'processing'
            const result = await Promise.race([
                api.processAudio({ audioBase64: base64data, lang, duration }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('processAudio timeout')), PROCESS_TIMEOUT_MS)
                ),
            ]);

            if (result.success && result.transcript) {
                console.log('[API] Success:', result.transcript);
                addToHistory({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    rawText: result.transcript,
                    correctedText: result.transcript,
                    audioPath: result.audioPath,
                    lang,
                    mode: 'dictate',
                    duration,
                });
                api.pasteText(result.transcript);
            } else {
                console.error('[API] Failed:', result.error);
                api.hideWindow();
            }
        } catch (err: any) {
            console.error('[RECORDER] Stop error:', err.message);
            api?.hideWindow();
        } finally {
            processingRef.current = false;
            // Notify main process that the cycle is done so it can reset its state
            api?.recordingEnded();
        }
    }, [stop, isRecording, addToHistory]);

    return { startRecording, stopRecording };
}
