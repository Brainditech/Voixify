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

        // Load persisted settings FROM the main process (saved to disk).
        // This covers the case where settings were saved via the Settings window
        // (separate BrowserWindow with separate localStorage) — especially the API key.
        api.getSettings().then((saved: any) => {
            if (!saved) return;
            const store = useVoixifyStore.getState();
            if (saved.deepgramApiKey && !store.deepgramApiKey) store.setDeepgramApiKey(saved.deepgramApiKey);
            if (saved.lang) store.setLang(saved.lang);
            if (saved.transcriptionSource) store.setTranscriptionSource(saved.transcriptionSource);
            if (saved.deepgramModel) store.setDeepgramModel(saved.deepgramModel);
            if (saved.correctionLevel) store.setCorrectionLevel(saved.correctionLevel);
            if (saved.llmCorrectionEnabled !== undefined) store.setLlmCorrectionEnabled(saved.llmCorrectionEnabled);
            if (saved.autopasteEnabled !== undefined) store.setAutopasteEnabled(saved.autopasteEnabled);
            if (saved.ollamaModel) store.setOllamaModel(saved.ollamaModel);
            if (saved.selectedMicId) store.setSelectedMicId(saved.selectedMicId);
        }).catch(() => { });

        // Sync les paramètres non-critiques depuis Zustand → main process.
        // IMPORTANT: on n'envoie PAS le hotkey ici — le main process a déjà chargé
        // la bonne valeur depuis settings.json. Envoyer le hotkey depuis le localStorage
        // Zustand écraserait silencieusement la valeur correcte avec une valeur potentiellement
        // périmée. Le hotkey n'est changé que via la fenêtre Paramètres (update-hotkey IPC).
        const state = useVoixifyStore.getState();
        api.updateSettings({
            transcriptionSource: state.transcriptionSource,
            lang: state.lang,
            deepgramModel: state.deepgramModel,
            deepgramApiKey: state.deepgramApiKey,
            correctionLevel: state.correctionLevel,
            llmCorrectionEnabled: state.llmCorrectionEnabled,
            autopasteEnabled: state.autopasteEnabled,
            ollamaModel: state.ollamaModel,
            selectedMicId: state.selectedMicId,
        }).catch(() => { });

        api.onStateChange((s: string) => {
            setRecordingState(s as any);
            if (s === 'recording') startRef.current();
        });

        api.onStopRecording(() => {
            setRecordingState('processing');
            Promise.resolve(stopRef.current()).finally(() => setRecordingState('idle'));
        });

        // Listen for settings changes from the Settings window (separate BrowserWindow).
        // This bridges the isolated localStorage gap between the two Electron renderers.
        api.onSettingsChanged?.((settings: any) => {
            const store = useVoixifyStore.getState();
            if (settings.lang !== undefined) store.setLang(settings.lang);
            if (settings.transcriptionSource !== undefined) store.setTranscriptionSource(settings.transcriptionSource);
            if (settings.deepgramModel !== undefined) store.setDeepgramModel(settings.deepgramModel);
            if (settings.deepgramApiKey !== undefined) store.setDeepgramApiKey(settings.deepgramApiKey);
            if (settings.correctionLevel !== undefined) store.setCorrectionLevel(settings.correctionLevel);
            if (settings.llmCorrectionEnabled !== undefined) store.setLlmCorrectionEnabled(settings.llmCorrectionEnabled);
            if (settings.autopasteEnabled !== undefined) store.setAutopasteEnabled(settings.autopasteEnabled);
            if (settings.ollamaModel !== undefined) store.setOllamaModel(settings.ollamaModel);
            if (settings.selectedMicId !== undefined) store.setSelectedMicId(settings.selectedMicId);
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
