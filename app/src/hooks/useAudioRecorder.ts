import { useRef, useCallback, useEffect } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';

// Persistent mic stream acquired at mount — eliminates getUserMedia latency on each recording
let sharedStream: MediaStream | null = null;
let sharedAudioContext: AudioContext | null = null;
let lastMicId: string = ''; // track which mic was acquired

export function useAudioRecorder() {
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);

    const selectedMicId = useVoixifyStore(s => s.selectedMicId);

    // Build audio constraints — always reads latest selectedMicId from the store
    // to avoid stale closure issues in useCallback
    function getAudioConstraints(): MediaStreamConstraints {
        const audio: MediaTrackConstraints = {};
        const micId = useVoixifyStore.getState().selectedMicId || '';
        if (micId) {
            audio.deviceId = { exact: micId };
        }
        return { audio: audio.deviceId ? audio : true, video: false };
    }

    // Helper: get current mic ID from the store (avoids stale closures)
    function getCurrentMicId(): string {
        return useVoixifyStore.getState().selectedMicId || '';
    }

    // Acquire mic at mount (and re-acquire when selectedMicId changes)
    useEffect(() => {
        const currentMicId = getCurrentMicId();
        // If the mic ID changed, release the old stream
        if (sharedStream && lastMicId !== currentMicId) {
            console.log('[RECORDER] Mic changed, releasing old stream…');
            sharedStream.getTracks().forEach(t => t.stop());
            sharedStream = null;
        }

        if (sharedStream) return; // already acquired with the right mic
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.error('[RECORDER] navigator.mediaDevices is undefined! Microphone access is blocked by the context.');
                return;
            }
            const constraints = getAudioConstraints();
            navigator.mediaDevices.getUserMedia(constraints)
                .then((stream) => {
                    sharedStream = stream;
                    lastMicId = getCurrentMicId();
                    const track = stream.getAudioTracks()[0];
                    console.log('[RECORDER] Mic ready:', track.label);
                })
                .catch((err) => {
                    console.error('[RECORDER] Mic pre-acquire failed:', err);
                });
        } catch (e) {
            console.error('[RECORDER] Synchronous error inside useEffect:', e);
        }
        // intentionally not cleaning up sharedStream — kept for the app lifetime
    }, [selectedMicId]);

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
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('navigator.mediaDevices is undefined (Microphone blocked)');
            }

            const currentMicId = getCurrentMicId();

            // If the selected mic changed since the shared stream was acquired, release it
            if (sharedStream && lastMicId !== currentMicId) {
                console.log('[RECORDER] Mic changed at start(), re-acquiring…');
                sharedStream.getTracks().forEach(t => t.stop());
                sharedStream = null;
            }

            const constraints = getAudioConstraints();
            const stream = sharedStream
                ?? await navigator.mediaDevices.getUserMedia(constraints);
            if (!sharedStream) {
                sharedStream = stream;
                lastMicId = currentMicId;
            }

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
