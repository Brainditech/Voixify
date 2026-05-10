import React, { useEffect, useRef } from 'react';
import './styles/globals.css';
import { useVoixify } from './hooks/useVoixify';
import { useVoixifyStore } from './stores/voixifyStore';
import { useSyncSettings } from './hooks/useSyncSettings';
import Settings from './components/Settings';
import FileTranscriber from './components/FileTranscriber';

// Hash-based routing: each Electron BrowserWindow loads the same bundle but
// with a different hash. The pill window has no special hash; settings and
// transcribe windows each render their own root component.
const hash = window.location.hash;
const isSettingsWindow = hash.includes('settings');
const isTranscribeWindow = hash.includes('transcribe');

export default function App() {
    if (isTranscribeWindow) return <FileTranscriber />;
    if (isSettingsWindow) return <Settings />;
    return <Pill />;
}

function Pill() {
    const recordingState = useVoixifyStore(s => s.recordingState);
    const setRecordingState = useVoixifyStore(s => s.setRecordingState);
    const { startRecording, stopRecording } = useVoixify();

    const startRef = useRef(startRecording);
    const stopRef = useRef(stopRecording);
    useEffect(() => { startRef.current = startRecording; }, [startRecording]);
    useEffect(() => { stopRef.current = stopRecording; }, [stopRecording]);

    // Hydrate settings from the main process and listen for cross-window
    // changes. Hotkey is intentionally not synced from here — it lives on a
    // dedicated IPC channel (update-hotkey) that handles registration failures.
    useSyncSettings();

    useEffect(() => {
        const api = (window as any).voixify;
        if (!api) return;

        api.rendererReady();

        // Low-latency mode: main shows the pill and emits state-change('recording')
        // synchronously with the keypress. The warm ring buffer is already
        // capturing, so startRef.current() is a near-instant flag flip.
        api.onStateChange((s: string) => {
            setRecordingState(s as any);
            if (s === 'recording') startRef.current();
        });

        // Privacy mode: main holds back the pill and instead emits this event.
        // We must build the MediaRecorder, await its onstart, then notify main
        // to reveal the pill. This trades ~150 ms of perceived UI lag for the
        // guarantee that the pill appearing == audio actively being captured.
        api.onArmRecording?.(async () => {
            try {
                await startRef.current();
                api.recordingArmed?.();
            } catch (err) {
                console.error('[PILL] arm-recording failed:', err);
                api.hideWindow?.();
            }
        });

        api.onStopRecording(() => {
            setRecordingState('processing');
            Promise.resolve(stopRef.current()).finally(() => setRecordingState('idle'));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={`pill ${recordingState}`}>
            <div className="pill-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
            </div>
            <div className="bars">
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
            </div>
        </div>
    );
}
