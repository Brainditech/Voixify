import React, { useState, useEffect, useRef } from 'react';
import './styles/globals.css';
import { useVoixify } from './hooks/useVoixify';

export default function App() {
    const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle');
    const { startRecording, stopRecording } = useVoixify();

    // Keep stable refs so the IPC callbacks always call the latest functions
    // without re-registering listeners on every render.
    const startRef = useRef(startRecording);
    const stopRef = useRef(stopRecording);
    useEffect(() => { startRef.current = startRecording; }, [startRecording]);
    useEffect(() => { stopRef.current = stopRecording; }, [stopRecording]);

    useEffect(() => {
        const api = (window as any).voixify;
        if (!api) return;

        // Tell main process we're mounted — ensures window is hidden until first hotkey press
        api.rendererReady();

        // Each call to onStateChange/onStopRecording replaces the previous listener
        // (removeAllListeners is called inside preload.cjs).
        api.onStateChange((s: string) => {
            setState(s as any);
            if (s === 'recording') startRef.current();
        });

        api.onStopRecording(() => {
            setState('processing');
            // Reset to idle when done so the pill doesn't flash old state on next show
            Promise.resolve(stopRef.current()).finally(() => setState('idle'));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Register once — preload ensures only one listener is active at a time

    return (
        <div className={`pill ${state}`}>
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
