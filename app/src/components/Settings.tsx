import React, { useState, useEffect } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';

const api = (window as any).voixify;

const HOTKEY_OPTIONS = [
    { label: 'Ctrl+Space', value: 'CommandOrControl+Space' },
    { label: 'Alt+Space', value: 'Alt+Space' },
    { label: 'Ctrl+Shift+Space', value: 'CommandOrControl+Shift+Space' },
    { label: 'F9', value: 'F9' },
];

const LANG_OPTIONS = [
    { label: '🇫🇷  Français', value: 'fr' },
    { label: '🇬🇧  English', value: 'en' },
];

const CORRECTION_OPTIONS = [
    { label: 'Désactivée', value: 'off', desc: "Texte brut sans modification" },
    { label: 'Minimale', value: 'minimal', desc: "Ponctuation + mots de remplissage" },
    { label: 'Standard', value: 'standard', desc: "Grammaire + orthographe" },
    { label: 'Avancée', value: 'advanced', desc: "Style professionnel fluide" },
];

export default function Settings() {
    const {
        lang, setLang,
        hotkey, setHotkey,
        correctionLevel, setCorrectionLevel,
        ollamaModel, setOllamaModel,
        whisperUrl, setWhisperUrl,
        ollamaUrl, setOllamaUrl,
        autopasteEnabled, setAutopasteEnabled,
        availableModels, setAvailableModels,
    } = useVoixifyStore();

    const [hotkeyStatus, setHotkeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
    const [modelsLoading, setModelsLoading] = useState(false);

    // Load available Ollama models on mount
    useEffect(() => {
        fetchModels();
    }, [ollamaUrl]);

    async function fetchModels() {
        setModelsLoading(true);
        try {
            const port = process.env.NODE_ENV === 'development' ? '3001' : '3001';
            const res = await fetch(`http://localhost:${port}/api/models`);
            if (res.ok) {
                const data = await res.json();
                const names = (data.models || []).map((m: any) => m.name || m);
                setAvailableModels(names);
            }
        } catch {
            // Backend not running or Ollama unreachable — keep existing list
        } finally {
            setModelsLoading(false);
        }
    }

    async function applyHotkey(key: string) {
        setHotkey(key);
        const result = await api?.updateHotkey(key);
        setHotkeyStatus(result?.success === false ? 'error' : 'ok');
        setTimeout(() => setHotkeyStatus('idle'), 2000);
    }

    const models = availableModels.length > 0
        ? availableModels
        : [ollamaModel];

    return (
        <div className="settings">
            {/* Header */}
            <div className="settings-header">
                <div className="settings-header-left">
                    <div className="settings-logo">🎙</div>
                    <div>
                        <h1 className="settings-title">Voixify</h1>
                        <p className="settings-subtitle">Dictée vocale IA</p>
                    </div>
                </div>
                <button className="settings-close" onClick={() => api?.closeSettings()}>✕</button>
            </div>

            <div className="settings-body">

                {/* Langue */}
                <section className="settings-section">
                    <h2 className="settings-section-title">Langue de dictée</h2>
                    <div className="pill-group">
                        {LANG_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                className={`pill-btn ${lang === opt.value ? 'active' : ''}`}
                                onClick={() => setLang(opt.value as any)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Raccourci */}
                <section className="settings-section">
                    <h2 className="settings-section-title">Raccourci clavier</h2>
                    <div className="pill-group">
                        {HOTKEY_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                className={`pill-btn ${hotkey === opt.value ? 'active' : ''}`}
                                onClick={() => applyHotkey(opt.value)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {hotkeyStatus === 'ok' && <p className="settings-hint ok">✓ Raccourci mis à jour</p>}
                    {hotkeyStatus === 'error' && <p className="settings-hint err">✗ Raccourci invalide ou déjà utilisé</p>}
                    <p className="settings-hint">Maintenir le raccourci pour enregistrer, relâcher pour coller</p>
                </section>

                {/* Correction IA */}
                <section className="settings-section">
                    <h2 className="settings-section-title">Correction IA</h2>
                    <div className="correction-grid">
                        {CORRECTION_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                className={`correction-btn ${correctionLevel === opt.value ? 'active' : ''}`}
                                onClick={() => setCorrectionLevel(opt.value as any)}
                            >
                                <span className="correction-label">{opt.label}</span>
                                <span className="correction-desc">{opt.desc}</span>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Modèle Ollama */}
                <section className="settings-section">
                    <h2 className="settings-section-title">
                        Modèle IA
                        {modelsLoading && <span className="settings-badge">chargement…</span>}
                    </h2>
                    <select
                        className="settings-select"
                        value={ollamaModel}
                        onChange={e => setOllamaModel(e.target.value)}
                    >
                        {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <p className="settings-hint">Modèle Ollama local utilisé pour la correction</p>
                </section>

                {/* Collage automatique */}
                <section className="settings-section">
                    <div className="settings-row">
                        <div>
                            <h2 className="settings-section-title" style={{ marginBottom: 0 }}>Collage automatique</h2>
                            <p className="settings-hint" style={{ marginTop: 2 }}>Colle le texte directement après dictée</p>
                        </div>
                        <button
                            className={`toggle ${autopasteEnabled ? 'on' : 'off'}`}
                            onClick={() => setAutopasteEnabled(!autopasteEnabled)}
                        >
                            <span className="toggle-thumb" />
                        </button>
                    </div>
                </section>

                {/* URLs avancées */}
                <section className="settings-section">
                    <h2 className="settings-section-title">API locales (avancé)</h2>
                    <label className="settings-label">Whisper URL</label>
                    <input
                        className="settings-input"
                        value={whisperUrl}
                        onChange={e => setWhisperUrl(e.target.value)}
                        placeholder="http://localhost:8000"
                    />
                    <label className="settings-label" style={{ marginTop: 8 }}>Ollama URL</label>
                    <input
                        className="settings-input"
                        value={ollamaUrl}
                        onChange={e => setOllamaUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                    />
                </section>

            </div>

            {/* Footer */}
            <div className="settings-footer">
                <span className="settings-version">Voixify v1.0</span>
            </div>
        </div>
    );
}
