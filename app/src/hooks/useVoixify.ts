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

            // ─── Read ALL settings from Zustand store (persisted, single source of truth) ───
            const {
                lang,
                deepgramModel,
                transcriptionSource,
                llmCorrectionEnabled,
                correctionLevel,
                ollamaModel,
            } = useVoixifyStore.getState();

            // Timeout wrapper so the UI never gets permanently stuck in 'processing'
            const result = await Promise.race([
                api.processAudio({
                    audioBase64: base64data,
                    lang,
                    deepgramModel,
                    transcriptionSource,
                    duration,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Transcription timeout (30s) — vérifiez votre connexion')), PROCESS_TIMEOUT_MS)
                ),
            ]);

            if (result.success && result.transcript) {
                let finalTranscript = result.transcript;

                // ─── AI correction (using Zustand store settings, NOT mainSettings) ───
                if (llmCorrectionEnabled && correctionLevel !== 'off') {
                    setRecordingState('correcting');

                    try {
                        const res = await fetch('http://127.0.0.1:3001/api/correct', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                text: finalTranscript,
                                lang,
                                model: ollamaModel,
                                level: correctionLevel,
                            }),
                        });

                        if (res.ok) {
                            const data = await res.json();
                            if (data.correctedText) {
                                finalTranscript = data.correctedText;
                            }
                        } else {
                            const errText = await res.text().catch(() => '');
                            console.error('[API] Correction failed:', res.status, errText.substring(0, 200));
                        }
                    } catch (err: any) {
                        // Network error = Ollama or backend unreachable
                        if (err.message?.includes('fetch') || err.message?.includes('ECONNREFUSED') || err.name === 'TypeError') {
                            console.error('[API] Correction service unreachable — using raw transcription');
                        } else {
                            console.error('[API] Correction error:', err.message);
                        }
                        // Continue with uncorrected text — don't fail the whole flow
                    }
                }

                addToHistory({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    rawText: result.transcript,
                    correctedText: finalTranscript,
                    audioPath: result.audioPath,
                    lang,
                    mode: 'dictate',
                    duration,
                });
                api.pasteText(finalTranscript);
            } else {
                // Transcription failed — log error and hide
                console.error('[API] Transcription failed:', result.error);
                api.hideWindow();
            }
        } catch (err: any) {
            // Handle specific error types for better diagnostics
            if (err.message?.includes('timeout')) {
                console.error('[RECORDER] Transcription timed out — API may be slow or unreachable');
            } else if (err.message?.includes('ECONNREFUSED')) {
                console.error('[RECORDER] Cannot connect to API — is the backend running?');
            } else {
                console.error('[RECORDER] Stop error:', err.message);
            }
            api?.hideWindow();
        } finally {
            processingRef.current = false;
            // Notify main process that the cycle is done so it can reset its state
            api?.recordingEnded();
        }
    }, [stop, isRecording, addToHistory]);

    return { startRecording, stopRecording };
}
