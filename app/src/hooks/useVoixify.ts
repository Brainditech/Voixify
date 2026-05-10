import { useCallback, useEffect, useRef } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { useVoixifyStore } from '../stores/voixifyStore';

// 120s ceiling — large-v3 cold start (model download + VRAM load) can take
// 30-60s on a fresh server. The previous 30s timeout was too aggressive and
// silently dropped the first transcription (paste never fired).
const PROCESS_TIMEOUT_MS = 120_000;

// Fallback used only if the IPC URL fetch hasn't resolved yet (first paint).
// Matches the BACKEND_PORT default in electron.cjs.
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3001';

export function useVoixify() {
    const { start, stop, isRecording } = useAudioRecorder();
    const addToHistory = useVoixifyStore((s) => s.addToHistory);
    const setRecordingState = useVoixifyStore((s) => s.setRecordingState);
    const processingRef = useRef(false); // prevents concurrent stop/process calls
    const backendUrlRef = useRef<string>(DEFAULT_BACKEND_URL);

    // Resolve the real backend URL once at mount. Stored in a ref so the
    // stopRecording callback always reads the current value without becoming
    // a dependency that retriggers downstream effects.
    useEffect(() => {
        const api = (window as any).voixify;
        if (!api?.getBackendUrl) return;
        api.getBackendUrl().then((url: string) => {
            if (typeof url === 'string' && url) backendUrlRef.current = url;
        }).catch(() => { /* fall back to default */ });
    }, []);

    const startRecording = useCallback(async () => {
        if (isRecording()) return;
        try {
            await start();
        } catch (err) {
            console.error('[RECORDER] Start error:', err);
        }
    }, [start, isRecording]);

    const stopRecording = useCallback(async () => {
        const api = (window as any).voixify;
        if (!isRecording()) {
            api?.hideWindow();
            return;
        }
        if (processingRef.current) return; // already in flight
        processingRef.current = true;

        try {
            const { blob, duration } = await stop();

            if (!api) {
                console.error('[RECORDER] IPC bridge not available');
                return;
            }

            // Send the audio as a Uint8Array via Electron's structured-clone IPC.
            // Avoids the ~33% base64 overhead and an extra encode/decode cycle.
            const audio = new Uint8Array(await blob.arrayBuffer());

            // ─── Read ALL settings from Zustand store (persisted, single source of truth) ───
            const {
                lang,
                deepgramModel,
                deepgramApiKey,
                whisperApiKey,
                transcriptionSource,
                llmCorrectionEnabled,
                correctionLevel,
                ollamaModel,
                whisperUrl,
                ollamaUrl,
            } = useVoixifyStore.getState();

            // Timeout wrapper so the UI never gets permanently stuck in 'processing'
            const result = await Promise.race([
                api.processAudio({
                    audio,
                    lang,
                    deepgramModel,
                    deepgramApiKey,
                    whisperApiKey,
                    transcriptionSource,
                    whisperUrl,
                }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Transcription timeout (2 min) — si c\'est le 1er enregistrement, le modèle Whisper se charge encore, réessayez')), PROCESS_TIMEOUT_MS)
                ),
            ]);

            if (result.success && result.transcript) {
                let finalTranscript = result.transcript;

                // ─── AI correction (using Zustand store settings, NOT mainSettings) ───
                if (llmCorrectionEnabled && correctionLevel !== 'off') {
                    setRecordingState('correcting');

                    try {
                        const res = await fetch(`${backendUrlRef.current}/api/correct`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                text: finalTranscript,
                                lang,
                                model: ollamaModel,
                                level: correctionLevel,
                                ollamaUrl,
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
