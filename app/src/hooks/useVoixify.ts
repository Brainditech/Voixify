import { useCallback, useRef } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { useVoixifyStore } from '../stores/voixifyStore';

const PROCESS_TIMEOUT_MS = 30_000; // 30s max for transcription

export function useVoixify() {
    const { start, stop, isRecording } = useAudioRecorder();
    const addToHistory = useVoixifyStore((s) => s.addToHistory);
    const setRecordingState = useVoixifyStore((s) => s.setRecordingState);
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

            // Read settings from store
            const { lang, deepgramModel, transcriptionSource } = useVoixifyStore.getState();

            // Timeout wrapper so the UI never gets permanently stuck in 'processing'
            const result = await Promise.race([
                api.processAudio({ audioBase64: base64data, lang, deepgramModel, transcriptionSource, duration }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('processAudio timeout')), PROCESS_TIMEOUT_MS)
                ),
            ]);

            if (result.success && result.transcript) {
                console.log('[API] STT Success:', result.transcript);
                let finalTranscript = result.transcript;

                // Sync with mainSettings to ensure we have the absolute latest UI choices
                const settings = await api.getSettings();

                if (settings.llmCorrectionEnabled && settings.correctionLevel !== 'off') {
                    setRecordingState('correcting');
                    console.log(`[API] Triggering LLM Correction (${settings.ollamaModel}, level: ${settings.correctionLevel})...`);
                    try {
                        // Use the mapped ollamaUrl or fallback to proxy backend for the /api/correct route
                        const res = await fetch('http://127.0.0.1:3001/api/correct', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                text: finalTranscript,
                                lang: settings.lang,
                                model: settings.ollamaModel,
                                level: settings.correctionLevel
                            })
                        });

                        if (res.ok) {
                            const data = await res.json();
                            if (data.correctedText) {
                                finalTranscript = data.correctedText;
                                console.log('[API] LLM Success:', finalTranscript);
                            }
                        } else {
                            console.error('[API] LLM Route failed', await res.text());
                        }
                    } catch (err: any) {
                        console.error('[API] LLM Correction error:', err.message);
                    }
                }

                addToHistory({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    rawText: result.transcript,
                    correctedText: finalTranscript,
                    audioPath: result.audioPath,
                    lang: settings.lang || lang,
                    mode: 'dictate',
                    duration,
                });
                api.pasteText(finalTranscript);
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
