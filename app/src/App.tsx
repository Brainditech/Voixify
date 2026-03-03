import React, { useState, useEffect, useRef } from 'react';
import './styles/globals.css';
import { useVoixify } from './hooks/useVoixify';
import { useVoixifyStore } from './stores/voixifyStore';
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

    useEffect(() => {
        const api = (window as any).voixify;
        if (!api) return;

        api.rendererReady();

        // Sync ALL persisted settings from Zustand store → main process on startup.
        // This ensures mainSettings in electron.cjs matches the user's saved preferences,
        // not the hardcoded defaults (which would reset on every app launch).
        const state = useVoixifyStore.getState();
        api.updateSettings({
            transcriptionSource: state.transcriptionSource,
            lang: state.lang,
            deepgramModel: state.deepgramModel,
            correctionLevel: state.correctionLevel,
            llmCorrectionEnabled: state.llmCorrectionEnabled,
            autopasteEnabled: state.autopasteEnabled,
            ollamaModel: state.ollamaModel,
        }).catch(() => { });
        api.updateHotkey(state.hotkey).catch(() => { });

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
