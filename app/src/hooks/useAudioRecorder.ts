import { useRef, useCallback, useEffect } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';

// Persistent mic stream acquired at mount — eliminates getUserMedia latency on
// each recording. In low-latency mode, the MediaRecorder also runs continuously
// against this stream and feeds a pre-roll ring buffer; in privacy mode, the
// recorder is built on-demand and torn down between dictations.
let sharedStream: MediaStream | null = null;
let sharedAudioContext: AudioContext | null = null;
let lastMicId: string = ''; // track which mic was acquired

// ─── Warm pipeline (low-latency mode only) ──────────────────────
// Everything below the stream is rebuilt when `lowLatencyMode` flips, when the
// mic ID changes, or when the idle timer releases the stream.
let warmRecorder: MediaRecorder | null = null;
let warmSource: MediaStreamAudioSourceNode | null = null;
let warmAnalyser: AnalyserNode | null = null;
// Header chunk: emitted once by MediaRecorder right after start(), contains
// EBML + Segment + Tracks + first cluster. Required to make any subsequent
// cluster blob decodable. Never dropped.
let headerChunk: Blob | null = null;
// Ring of the most-recent encoded clusters, used as pre-roll when the user
// hits the hotkey. Each chunk is ~100 ms (the MediaRecorder timeslice), so 5
// chunks ≈ 500 ms of audio that was captured BEFORE the keypress.
let ringBuffer: Blob[] = [];
const RING_BUFFER_SIZE = 5;
// Chunks accumulated while the user is actively dictating (between start &
// stop). On stop(), final blob = [header] + [ring tail] + [live chunks].
let liveChunks: Blob[] = [];
let isLive = false;
// Wall-clock timestamp of the most recent start() in low-latency mode.
// Used to compute the displayed dictation duration.
let liveStartTime = 0;

// Release the shared mic resources after this idle window. Without it, the
// recording-indicator stays lit forever and laptops stay in "mic active" power
// state. Re-acquiring on the next start() costs ~50–150 ms — negligible vs.
// keeping the mic open all afternoon.
// In low-latency mode this is intentionally disabled: keeping the mic warm
// IS the point of the mode.
const MIC_IDLE_TIMEOUT_MS = 5 * 60_000;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function tearDownWarmPipeline() {
    if (warmRecorder) {
        try {
            if (warmRecorder.state !== 'inactive') warmRecorder.stop();
        } catch { /* recorder already torn down */ }
        warmRecorder = null;
    }
    if (warmSource) {
        try { warmSource.disconnect(); } catch { /* already disconnected */ }
        warmSource = null;
    }
    warmAnalyser = null;
    headerChunk = null;
    ringBuffer = [];
    liveChunks = [];
    isLive = false;
}

function releaseSharedMic(reason: string) {
    inactivityTimer = null;
    tearDownWarmPipeline();
    if (sharedStream) {
        try { sharedStream.getTracks().forEach(t => t.stop()); } catch { /* tracks already gone */ }
        sharedStream = null;
        lastMicId = '';
    }
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
        try { sharedAudioContext.close(); } catch { /* already closed */ }
    }
    sharedAudioContext = null;
    console.log('[RECORDER] Released shared mic stream —', reason);
}

function cancelMicIdleTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }
}

function armMicIdleTimer() {
    cancelMicIdleTimer();
    inactivityTimer = setTimeout(() => releaseSharedMic('idle 5 min'), MIC_IDLE_TIMEOUT_MS);
}

function pickMimeType(): string {
    return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
}

// Build the AudioContext + source + analyser once the shared stream exists.
// Returns true if the audio graph is ready to be used.
function ensureAudioGraph(): boolean {
    if (!sharedStream) return false;
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
        sharedAudioContext = new AudioContext();
    }
    if (sharedAudioContext.state === 'suspended') {
        // resume() is async, but the warm path tolerates the gap because
        // ondataavailable starts firing only after resume completes.
        sharedAudioContext.resume().catch(() => { /* will retry on next op */ });
    }
    if (!warmSource) {
        warmSource = sharedAudioContext.createMediaStreamSource(sharedStream);
        warmAnalyser = sharedAudioContext.createAnalyser();
        warmAnalyser.fftSize = 256;
        warmAnalyser.smoothingTimeConstant = 0.7;
        warmSource.connect(warmAnalyser);
    }
    return true;
}

// Spin up a continuously-running MediaRecorder that feeds the ring buffer.
// Called once when entering low-latency mode and after any teardown.
function startWarmRecorder() {
    if (!sharedStream) return;
    if (warmRecorder && warmRecorder.state === 'recording') return;
    if (!ensureAudioGraph()) return;

    headerChunk = null;
    ringBuffer = [];
    liveChunks = [];
    isLive = false;

    const recorder = new MediaRecorder(sharedStream, { mimeType: pickMimeType() });

    recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        // The first chunk emitted by MediaRecorder is the only one that
        // contains the EBML header + Segment + Tracks. Pin it permanently —
        // every assembled blob is prefixed with this chunk.
        if (headerChunk === null) {
            headerChunk = e.data;
            return;
        }
        if (isLive) {
            liveChunks.push(e.data);
        } else {
            ringBuffer.push(e.data);
            if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
        }
    };

    recorder.onerror = (e: any) => {
        console.error('[RECORDER] Warm recorder error:', e?.error?.message || 'unknown');
        // Try to recover: tear down, the next start() will rebuild.
        tearDownWarmPipeline();
    };

    // 100 ms timeslice = ring granularity. Smaller would increase JS overhead;
    // larger would reduce ring resolution (we want ~500 ms total = 5 × 100 ms).
    recorder.start(100);
    warmRecorder = recorder;
    console.log('[RECORDER] Warm recorder running (ring buffer mode)');
}

export function useAudioRecorder() {
    // Privacy-mode recorder is built per dictation; keep it on a ref so stop()
    // can find it. In low-latency mode this ref stays null — we use warmRecorder.
    const privacyRecorderRef = useRef<MediaRecorder | null>(null);
    const privacyStartTimeRef = useRef<number>(0);

    const selectedMicId = useVoixifyStore(s => s.selectedMicId);
    const lowLatencyMode = useVoixifyStore(s => s.lowLatencyMode);

    function getCurrentMicId(): string {
        return useVoixifyStore.getState().selectedMicId || '';
    }

    function getAudioConstraints(): MediaStreamConstraints {
        const audio: MediaTrackConstraints = {};
        const micId = getCurrentMicId();
        if (micId) audio.deviceId = { exact: micId };
        return { audio: audio.deviceId ? audio : true, video: false };
    }

    // Mount: acquire mic, and in low-latency mode immediately bring the
    // MediaRecorder online. Re-runs when the mic ID or lowLatencyMode flips.
    useEffect(() => {
        const currentMicId = getCurrentMicId();

        // Belt: never reconfigure the pipeline during an active dictation —
        // the user toggling settings mid-recording (or a settings broadcast
        // from another window) would otherwise nuke the recorder. The change
        // takes effect on the next press instead.
        const recordingInFlight = isLive || privacyRecorderRef.current !== null;

        // Mic identity changed → tear everything down so we rebuild against
        // the new device.
        if (sharedStream && lastMicId !== currentMicId && !recordingInFlight) {
            console.log('[RECORDER] Mic changed, releasing old stream…');
            tearDownWarmPipeline();
            sharedStream.getTracks().forEach(t => t.stop());
            sharedStream = null;
        }

        // Mode changed while stream is still valid → tear down only the
        // pipeline above the stream. The stream itself is reusable.
        if (sharedStream && !lowLatencyMode && warmRecorder && !recordingInFlight) {
            console.log('[RECORDER] Switching to privacy mode — stopping warm recorder');
            tearDownWarmPipeline();
        }

        const proceedWithStream = () => {
            if (!sharedStream) return;
            if (lowLatencyMode) {
                // Cancel any pending idle release — low-latency mode keeps
                // the mic permanently warm.
                cancelMicIdleTimer();
                startWarmRecorder();
            }
        };

        if (sharedStream) {
            proceedWithStream();
            return;
        }

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.error('[RECORDER] navigator.mediaDevices is undefined! Microphone access is blocked.');
                return;
            }
            navigator.mediaDevices.getUserMedia(getAudioConstraints())
                .then((stream) => {
                    sharedStream = stream;
                    lastMicId = getCurrentMicId();
                    console.log('[RECORDER] Mic ready:', stream.getAudioTracks()[0]?.label);

                    // If the OS / user revokes the track mid-session, tear down
                    // so the next start() rebuilds against whatever's available.
                    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
                        console.warn('[RECORDER] Mic track ended — tearing down pipeline');
                        releaseSharedMic('track ended');
                    });

                    proceedWithStream();
                })
                .catch((err) => {
                    console.error('[RECORDER] Mic pre-acquire failed:', err);
                });
        } catch (e) {
            console.error('[RECORDER] Synchronous error inside useEffect:', e);
        }
    }, [selectedMicId, lowLatencyMode]);

    const getAnalyser = useCallback(() => warmAnalyser, []);

    // Privacy mode: build a fresh recorder per dictation. Returns once
    // MediaRecorder.onstart has fired, so the caller knows audio capture
    // is truly active before showing the pill.
    const startPrivacy = useCallback(async (): Promise<void> => {
        if (privacyRecorderRef.current?.state === 'recording') {
            console.warn('[RECORDER] Already recording (privacy), ignoring start()');
            return;
        }

        cancelMicIdleTimer();

        // Re-acquire mic if it was released by the idle timer.
        if (!sharedStream) {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('navigator.mediaDevices is undefined (Microphone blocked)');
            }
            sharedStream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
            lastMicId = getCurrentMicId();
        }

        if (!ensureAudioGraph()) throw new Error('Audio graph unavailable');
        if (sharedAudioContext?.state === 'suspended') {
            await sharedAudioContext.resume();
        }

        const recorder = new MediaRecorder(sharedStream, { mimeType: pickMimeType() });
        const sessionChunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) sessionChunks.push(e.data);
        };
        (recorder as any).__chunks = sessionChunks;

        // Resolve only once MediaRecorder is genuinely in 'recording' state —
        // this is the moment the pill can be safely revealed.
        await new Promise<void>((resolve, reject) => {
            const onStartHandler = () => {
                privacyStartTimeRef.current = Date.now();
                resolve();
            };
            const onErrorHandler = (e: any) => reject(new Error(e?.error?.message || 'MediaRecorder error'));
            recorder.addEventListener('start', onStartHandler, { once: true });
            recorder.addEventListener('error', onErrorHandler, { once: true });
            try {
                recorder.start(100);
            } catch (e) {
                reject(e as Error);
                return;
            }
            // Safety: if onstart never fires (driver hiccup), don't hang forever.
            setTimeout(() => reject(new Error('MediaRecorder onstart timeout')), 2000);
        });

        privacyRecorderRef.current = recorder;
        console.log('[RECORDER] Privacy recorder started');
    }, []);

    // Low-latency mode: nothing to spin up — the recorder is already running.
    // Just flip the flag so ondataavailable starts routing into liveChunks.
    const startLowLatency = useCallback(async (): Promise<void> => {
        if (isLive) {
            console.warn('[RECORDER] Already live, ignoring start()');
            return;
        }
        // Edge case: pipeline not yet warmed up (e.g. user pressed hotkey
        // during the first ~200 ms after app launch). Fall back to building
        // it on the spot — slower but guarantees nothing is lost.
        if (!warmRecorder || warmRecorder.state !== 'recording') {
            console.log('[RECORDER] Warm pipeline not ready — falling back to privacy start');
            return startPrivacy();
        }
        liveChunks = [];
        isLive = true;
        liveStartTime = Date.now();
    }, [startPrivacy]);

    const start = useCallback(async (): Promise<void> => {
        // Read mode fresh from the store: it may have been toggled while idle.
        const mode = useVoixifyStore.getState().lowLatencyMode;
        return mode ? startLowLatency() : startPrivacy();
    }, [startLowLatency, startPrivacy]);

    // Privacy stop: blob = concat of all chunks captured since onstart.
    const stopPrivacy = useCallback((): Promise<{ blob: Blob; duration: number }> => {
        return new Promise((resolve, reject) => {
            const recorder = privacyRecorderRef.current;
            if (!recorder || recorder.state === 'inactive') {
                reject(new Error('Recorder not active'));
                return;
            }
            const duration = Date.now() - privacyStartTimeRef.current;
            const sessionChunks: Blob[] = (recorder as any).__chunks ?? [];
            let resolved = false;

            const finalize = (blob: Blob) => {
                if (resolved) return;
                resolved = true;
                privacyRecorderRef.current = null;
                armMicIdleTimer();
                resolve({ blob, duration });
            };

            const timeout = setTimeout(() => {
                console.warn('[RECORDER] privacy onstop timeout, resolving with partial data');
                finalize(new Blob(sessionChunks, { type: 'audio/webm' }));
            }, 3000);

            recorder.onstop = () => {
                clearTimeout(timeout);
                finalize(new Blob(sessionChunks, { type: 'audio/webm' }));
            };
            recorder.stop();
        });
    }, []);

    // Low-latency stop: assemble [header] + [ring tail (preroll)] + [live].
    // The warm recorder keeps running and starts re-filling the ring buffer
    // immediately for the next dictation.
    const stopLowLatency = useCallback((): Promise<{ blob: Blob; duration: number }> => {
        return new Promise((resolve) => {
            const duration = Date.now() - liveStartTime;

            // Snapshot before clearing so any in-flight ondataavailable callback
            // doesn't mutate our arrays during the splice.
            const preroll = ringBuffer.slice(); // up to 5 chunks ≈ 500 ms
            const live = liveChunks.slice();

            // Reset live state so the warm recorder goes back to ring mode
            // for subsequent presses.
            isLive = false;
            liveChunks = [];

            const parts: Blob[] = [];
            if (headerChunk) parts.push(headerChunk);
            parts.push(...preroll);
            parts.push(...live);

            const blob = new Blob(parts, { type: 'audio/webm' });
            console.log(`[RECORDER] Low-latency stop — preroll=${preroll.length} chunks, live=${live.length} chunks, blob=${blob.size}B, duration=${duration}ms`);
            resolve({ blob, duration });
        });
    }, []);

    const stop = useCallback((): Promise<{ blob: Blob; duration: number }> => {
        // Use the same flag we used at start — privacyRecorderRef being set
        // means this dictation was started in privacy mode, regardless of any
        // mode flip that happened during the dictation.
        if (privacyRecorderRef.current) {
            return stopPrivacy();
        }
        return stopLowLatency();
    }, [stopPrivacy, stopLowLatency]);

    const isRecording = useCallback(() => {
        if (privacyRecorderRef.current?.state === 'recording') return true;
        return isLive;
    }, []);

    return { start, stop, isRecording, getAnalyser };
}
