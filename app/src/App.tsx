import React, { useEffect, useRef } from 'react';
import './styles/globals.css';
import { useVoixify } from './hooks/useVoixify';
import { useVoixifyStore } from './stores/voixifyStore';
import { useSyncSettings } from './hooks/useSyncSettings';
import Settings from './components/Settings';

// Hash-based routing: #/settings → Settings window, anything else → Pill
const isSettingsWindow = window.location.hash.includes('settings');

export default function App() {
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

        api.onStateChange((s: string) => {
            setRecordingState(s as any);
            if (s === 'recording') startRef.current();
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
