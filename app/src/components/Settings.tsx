import React, { useState, useEffect } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';
import History from './History';

const api = (window as any).voixify;

type Tab = 'transcription' | 'advanced' | 'history';

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

const DEEPGRAM_MODELS = [
    { value: 'nova-3', label: 'Nova-3', desc: '⭐ Meilleur — FR + EN + multi', recommended: true },
    { value: 'nova-2', label: 'Nova-2', desc: 'Rapide — FR + EN' },
    { value: 'nova-2-general', label: 'Nova-2 General', desc: 'Généraliste multi-langue' },
    { value: 'enhanced', label: 'Enhanced', desc: 'Équilibré — EN optimisé' },
    { value: 'base', label: 'Base', desc: 'Économique — EN uniquement' },
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
        deepgramModel, setDeepgramModel,
        transcriptionSource, setTranscriptionSource,
        whisperUrl, setWhisperUrl,
        ollamaUrl, setOllamaUrl,
        autopasteEnabled, setAutopasteEnabled,
        llmCorrectionEnabled, setLlmCorrectionEnabled,
        availableModels, setAvailableModels,
    } = useVoixifyStore();

    const [activeTab, setActiveTab] = useState<Tab>('transcription');
    const [hotkeyStatus, setHotkeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
    const [modelsLoading, setModelsLoading] = useState(false);

    useEffect(() => {
        async function syncWithMain() {
            try {
                await api?.updateSettings({
                    transcriptionSource, lang, deepgramModel,
                    correctionLevel, llmCorrectionEnabled,
                    autopasteEnabled, ollamaModel,
                });
            } catch { }
        }
        syncWithMain();
        fetchOllamaModels();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    function setSetting<T>(key: string, value: T, setter: (v: T) => void) {
        setter(value);
        api?.updateSettings({ [key]: value }).catch(() => { });
    }

    async function fetchOllamaModels() {
        setModelsLoading(true);
        try {
            const res = await fetch('http://127.0.0.1:3001/api/models');
            if (res.ok) {
                const data = await res.json();
                const names = (data.models || []).map((m: any) => m.name || m);
                if (names.length > 0) setAvailableModels(names);
            }
        } catch { } finally {
            setModelsLoading(false);
        }
    }

    async function applyHotkey(key: string) {
        setHotkey(key);
        const result = await api?.updateHotkey(key);
        setHotkeyStatus(result?.success === false ? 'error' : 'ok');
        setTimeout(() => setHotkeyStatus('idle'), 2000);
    }

    const ollamaModels = availableModels.length > 0 ? availableModels : [ollamaModel];

    return (
        <div className="settings">
            {/* Header — draggable title bar */}
            <div className="settings-header">
                <div className="settings-header-left">
                    <div className="settings-logo">🎙</div>
                    <h1 className="settings-title">Voixify</h1>
                </div>
                <button className="settings-close" onClick={() => api?.closeSettings()}>✕</button>
            </div>

            <div className="settings-layout">
                {/* ─── Sidebar ─── */}
                <nav className="settings-sidebar">
                    <div className="sidebar-section-label">Paramètres</div>
                    <button
                        className={`sidebar-nav-item ${activeTab === 'transcription' ? 'active' : ''}`}
                        onClick={() => setActiveTab('transcription')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                        Transcription
                    </button>
                    <button
                        className={`sidebar-nav-item ${activeTab === 'advanced' ? 'active' : ''}`}
                        onClick={() => setActiveTab('advanced')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        Avancé
                    </button>

                    <div className="sidebar-divider" />

                    <button
                        className={`sidebar-nav-item ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        Historique
                    </button>

                    <div className="sidebar-spacer" />
                    <div className="settings-version">Voixify v2.0</div>
                </nav>

                {/* ─── Content ─── */}
                <div className="settings-content">
                    {activeTab === 'history' && <History />}

                    {activeTab === 'transcription' && (
                        <div className="settings-body">
                            <div className="settings-page-title">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="22" />
                                </svg>
                                <span>Transcription</span>
                            </div>
                            <p className="settings-page-desc">Configurez la reconnaissance vocale et les raccourcis clavier.</p>

                            {/* Langue */}
                            <section className="settings-section">
                                <h2 className="settings-section-title">Langue de dictée</h2>
                                <div className="pill-group">
                                    {LANG_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            className={`pill-btn ${lang === opt.value ? 'active' : ''}`}
                                            onClick={() => setSetting('lang', opt.value as any, setLang)}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Source */}
                            <section className="settings-section">
                                <h2 className="settings-section-title">Source de transcription</h2>
                                <div className="pill-group">
                                    <button
                                        className={`pill-btn ${transcriptionSource === 'deepgram' ? 'active' : ''}`}
                                        onClick={() => setSetting('transcriptionSource', 'deepgram', setTranscriptionSource)}
                                    >
                                        ☁️&nbsp; Deepgram
                                    </button>
                                    <button
                                        className={`pill-btn ${transcriptionSource === 'whisper' ? 'active' : ''}`}
                                        onClick={() => setSetting('transcriptionSource', 'whisper', setTranscriptionSource)}
                                    >
                                        🏠&nbsp; Whisper local
                                    </button>
                                </div>
                                <p className="settings-hint">
                                    {transcriptionSource === 'deepgram'
                                        ? 'Cloud — rapide, précis, nécessite une clé API'
                                        : 'Local — privé, gratuit, nécessite le backend Docker'}
                                </p>
                            </section>

                            {/* Modèle Deepgram */}
                            {transcriptionSource === 'deepgram' && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Modèle Deepgram</h2>
                                    <div className="model-grid">
                                        {DEEPGRAM_MODELS.map(m => (
                                            <button
                                                key={m.value}
                                                className={`model-btn ${deepgramModel === m.value ? 'active' : ''}`}
                                                onClick={() => setSetting('deepgramModel', m.value, setDeepgramModel)}
                                            >
                                                <span className="model-label">
                                                    {m.label}
                                                    {m.recommended && <span className="model-badge">recommandé</span>}
                                                </span>
                                                <span className="model-desc">{m.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}

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
                                <p className="settings-hint">Maintenir pour enregistrer, relâcher pour coller</p>
                            </section>
                        </div>
                    )}

                    {activeTab === 'advanced' && (
                        <div className="settings-body">
                            <div className="settings-page-title">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                                <span>Avancé</span>
                            </div>
                            <p className="settings-page-desc">Correction IA, collage automatique et configuration des API.</p>

                            {/* Correction IA */}
                            <section className="settings-section">
                                <div className="settings-row">
                                    <div>
                                        <h2 className="settings-section-title" style={{ marginBottom: 0 }}>Correction IA</h2>
                                        <p className="settings-hint" style={{ marginTop: 2 }}>Améliore et corrige le texte avant collage</p>
                                    </div>
                                    <button
                                        className={`toggle ${llmCorrectionEnabled ? 'on' : 'off'}`}
                                        onClick={() => setSetting('llmCorrectionEnabled', !llmCorrectionEnabled, setLlmCorrectionEnabled)}
                                    >
                                        <span className="toggle-thumb" />
                                    </button>
                                </div>

                                {llmCorrectionEnabled && (
                                    <div className="correction-grid" style={{ marginTop: '0.75rem' }}>
                                        {CORRECTION_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                className={`correction-btn ${correctionLevel === opt.value ? 'active' : ''}`}
                                                onClick={() => setSetting('correctionLevel', opt.value as any, setCorrectionLevel)}
                                            >
                                                <span className="correction-label">{opt.label}</span>
                                                <span className="correction-desc">{opt.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {/* Modèle Ollama */}
                            {llmCorrectionEnabled && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">
                                        Modèle IA locale (Ollama)
                                        {modelsLoading && <span className="settings-badge">chargement…</span>}
                                    </h2>
                                    <select
                                        className="settings-select"
                                        value={ollamaModel}
                                        onChange={e => setSetting('ollamaModel', e.target.value, setOllamaModel)}
                                    >
                                        {ollamaModels.map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                </section>
                            )}

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
                                <h2 className="settings-section-title">API locales</h2>
                                <label className="settings-label">Whisper URL</label>
                                <input
                                    className="settings-input"
                                    value={whisperUrl}
                                    onChange={e => setWhisperUrl(e.target.value)}
                                    placeholder="http://localhost:8000"
                                />
                                <label className="settings-label" style={{ marginTop: 10 }}>Ollama URL</label>
                                <input
                                    className="settings-input"
                                    value={ollamaUrl}
                                    onChange={e => setOllamaUrl(e.target.value)}
                                    placeholder="http://localhost:11434"
                                />
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
