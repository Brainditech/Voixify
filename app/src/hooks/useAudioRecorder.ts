import { useRef, useCallback, useEffect } from 'react';

// Persistent mic stream acquired at mount — eliminates getUserMedia latency on each recording
let sharedStream: MediaStream | null = null;
let sharedAudioContext: AudioContext | null = null;

export function useAudioRecorder() {
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);

    // Acquire mic at mount so it's ready instantly when recording starts
    useEffect(() => {
        if (sharedStream) return; // already acquired by a previous mount
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then((stream) => {
                sharedStream = stream;
                const track = stream.getAudioTracks()[0];
                console.log('[RECORDER] Mic ready:', track.label);
            })
            .catch((err) => {
                console.error('[RECORDER] Mic pre-acquire failed:', err);
            });
        // intentionally not cleaning up sharedStream — kept for the app lifetime
    }, []);

    const getAnalyser = useCallback(() => analyserRef.current, []);

    // Clean up audio nodes from a previous session
    const cleanupAudioNodes = useCallback(() => {
        if (sourceRef.current) {
            try { sourceRef.current.disconnect(); } catch { /* already disconnected */ }
            sourceRef.current = null;
        }
        analyserRef.current = null;
    }, []);

    const start = useCallback(async (): Promise<void> => {
        if (mediaRecorderRef.current?.state === 'recording') {
            console.warn('[RECORDER] Already recording, ignoring start()');
            return;
        }

        // Cancel any pending silence timer / rAF from previous session
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        // Clean up any leaked audio nodes from a previous cycle
        cleanupAudioNodes();

        try {
            const stream = sharedStream
                ?? await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (!sharedStream) sharedStream = stream;

            // Reuse or create AudioContext
            if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
                sharedAudioContext = new AudioContext();
            }
            if (sharedAudioContext.state === 'suspended') {
                await sharedAudioContext.resume();
            }

            const source = sharedAudioContext.createMediaStreamSource(stream);
            const analyser = sharedAudioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;
            source.connect(analyser);
            sourceRef.current = source;
            analyserRef.current = analyser;

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            const recorder = new MediaRecorder(stream, { mimeType });
            const sessionChunks: Blob[] = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) sessionChunks.push(e.data);
            };

            // Expose chunks via recorder so stop() can always find them
            (recorder as any).__chunks = sessionChunks;

            mediaRecorderRef.current = recorder;
            startTimeRef.current = Date.now();
            recorder.start(100);

            console.log('[RECORDER] Started');
        } catch (err) {
            console.error('[RECORDER] Start error:', err);
            cleanupAudioNodes();
            throw err;
        }
    }, [cleanupAudioNodes]);

    const stop = useCallback((): Promise<{ blob: Blob; duration: number }> => {
        return new Promise((resolve, reject) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state === 'inactive') {
                reject(new Error('Recorder not active'));
                return;
            }

            // Cancel silence detection loop
            if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
            }
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }

            const duration = Date.now() - startTimeRef.current;
            const sessionChunks: Blob[] = (recorder as any).__chunks ?? [];

            // Prevent double-resolve: only the first path (onstop or timeout) resolves
            let resolved = false;

            const finalize = (blob: Blob) => {
                if (resolved) return;
                resolved = true;
                mediaRecorderRef.current = null;
                cleanupAudioNodes();
                resolve({ blob, duration });
            };

            // Safety timeout — if onstop never fires (Chromium bug), resolve with what we have
            const timeout = setTimeout(() => {
                console.warn('[RECORDER] onstop timeout, resolving with partial data');
                finalize(new Blob(sessionChunks, { type: 'audio/webm' }));
            }, 3000);

            recorder.onstop = () => {
                clearTimeout(timeout);
                finalize(new Blob(sessionChunks, { type: 'audio/webm' }));
            };

            recorder.stop();
        });
    }, [cleanupAudioNodes]);

    const isRecording = useCallback(
        () => mediaRecorderRef.current?.state === 'recording',
        []
    );

    return { start, stop, isRecording, getAnalyser };
}
