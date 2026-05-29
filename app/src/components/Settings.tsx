import React, { useState, useEffect } from 'react';
import { useVoixifyStore, OllamaModelInfo } from '../stores/voixifyStore';
import { useSyncSettings } from '../hooks/useSyncSettings';
import History from './History';

// Ollama model families that are for embeddings/OCR, NOT text generation.
// Selecting them for correction silently fails at chat time.
const NON_CHAT_FAMILIES = new Set(['nomic-bert', 'bge', 'minilm', 'glmocr', 'clip']);

function formatSize(bytes: number): string {
    if (!bytes || bytes < 1024 * 1024) return '—';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 ** 2))} MB`;
}

const RECOMMENDED_LOCAL_MODELS = [
    { pull: 'llama3.2:3b', why: 'Rapide, excellente correction FR + EN' },
    { pull: 'qwen2.5:3b', why: 'Très bonne qualité, léger' },
    { pull: 'phi3.5', why: 'Microsoft, équilibré' },
];

const api = window.voixify;

type Tab = 'transcription' | 'input' | 'advanced' | 'history';

const HOTKEY_OPTIONS = [
    { label: 'Ctrl+Space', value: 'CommandOrControl+Space' },
    { label: 'Alt+Space', value: 'Alt+Space' },
    { label: 'Ctrl+Shift+Space', value: 'CommandOrControl+Shift+Space' },
    { label: 'F9', value: 'F9' },
];

const LANG_OPTIONS = [
    { label: '🇫🇷  Français', value: 'fr' },
    { label: '🇬🇧  English', value: 'en' },
    { label: '🌐  Auto', value: 'auto' },
];

const DEEPGRAM_MODELS = [
    { value: 'nova-3', label: 'Nova-3', desc: '⭐ Meilleur — FR + EN + multi', recommended: true },
    { value: 'nova-2', label: 'Nova-2', desc: 'Rapide — FR + EN' },
    { value: 'nova-2-general', label: 'Nova-2 General', desc: 'Généraliste multi-langue' },
    { value: 'enhanced', label: 'Enhanced', desc: 'Équilibré — EN optimisé' },
    { value: 'base', label: 'Base', desc: 'Économique — EN uniquement' },
];

// "Off" is owned by the master toggle (llmCorrectionEnabled). Listing it here
// too made the UI ambiguous: enabling correction only to pick "Désactivée"
// reads as "I want correction, but actually I don't". The picker now only
// exposes intensity choices; turning correction off is a single click on the
// toggle.
const CORRECTION_OPTIONS = [
    { label: 'Minimale', value: 'minimal', desc: "Ponctuation + mots de remplissage" },
    { label: 'Standard', value: 'standard', desc: "Grammaire + orthographe" },
    { label: 'Avancée', value: 'advanced', desc: "Style professionnel fluide" },
];

export default function Settings() {
    const {
        lang,
        hotkey, setHotkey,
        hotkeyMode,
        correctionLevel,
        ollamaModel,
        deepgramModel,
        deepgramApiKey, setDeepgramApiKey,
        whisperApiKey, setWhisperApiKey,
        initialPrompt, setInitialPrompt,
        transcriptionSource,
        whisperUrl,
        ollamaUrl,
        autopasteEnabled,
        llmCorrectionEnabled,
        selectedMicId,
        lowLatencyMode,
        availableModels, setAvailableModels,
    } = useVoixifyStore();

    // Single source of truth: every setting change flows through `setSetting`,
    // which updates the local store and pushes to the main process. The Pill
    // window receives the broadcast and stays aligned automatically.
    // hydrateHotkey:true so the Settings UI shows the current hotkey at mount.
    const { setSetting } = useSyncSettings({ hydrateHotkey: true });

    const [activeTab, setActiveTab] = useState<Tab>('transcription');
    const [hotkeyStatus, setHotkeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
    const [modelsLoading, setModelsLoading] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [apiKeySaved, setApiKeySaved] = useState(false);
    const [showWhisperKey, setShowWhisperKey] = useState(false);
    const [whisperKeySaved, setWhisperKeySaved] = useState(false);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const apiKeySaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const whisperKeySaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const initialPromptSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ollama pull state — tracks an in-flight `ollama pull` streamed over HTTP.
    const [pullState, setPullState] = useState<{
        name: string;
        percent: number;   // 0..100 for the current layer (or 0 if unknown)
        status: string;    // latest human-readable status from Ollama
        error: string | null;
    } | null>(null);
    const [customPullName, setCustomPullName] = useState('');
    const pullAbortRef = React.useRef<AbortController | null>(null);

    // Enumerate audio input devices
    async function refreshAudioDevices() {
        try {
            // Need to request access first so device labels are available
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter(d => d.kind === 'audioinput');
            setAudioDevices(inputs);
        } catch (e) {
            console.error('[SETTINGS] Failed to enumerate audio devices:', e);
        }
    }

    // useSyncSettings hydrates settings + sets up cross-window listeners; the
    // Settings-only side effects (Ollama model list, audio device list) stay here.
    useEffect(() => {
        fetchOllamaModels();
        refreshAudioDevices();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    async function fetchOllamaModels(attempt = 1) {
        setModelsLoading(true);
        try {
            // Appeler Ollama directement — sans passer par le backend proxy.
            // Le proxy met plusieurs secondes à démarrer dans l'app packagée,
            // ce qui fait échouer silencieusement le chargement des modèles.
            // On essaie d'abord l'URL configurée par l'utilisateur, puis localhost.
            const baseUrl = useVoixifyStore.getState().ollamaUrl || 'http://localhost:11434';
            const urlsToTry = [baseUrl, 'http://localhost:11434'].filter(
                (u, i, arr) => arr.indexOf(u) === i // dédoublonner
            );

            let models: OllamaModelInfo[] = [];
            for (const url of urlsToTry) {
                try {
                    const res = await fetch(`${url}/api/tags`, {
                        signal: AbortSignal.timeout(5000),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        models = (data.models || []).map((m: any): OllamaModelInfo => {
                            const name: string = m.name || m.model || '';
                            const d = m.details || {};
                            const family: string = d.family || '';
                            return {
                                name,
                                sizeBytes: m.size || 0,
                                parameterSize: d.parameter_size || '',
                                family,
                                quantization: d.quantization_level || '',
                                isCloud: name.endsWith(':cloud') || !!m.remote_host,
                                isEmbedding: NON_CHAT_FAMILIES.has(family),
                            };
                        }).filter((m: OllamaModelInfo) => m.name);
                        if (models.length > 0) break; // succès, on arrête
                    }
                } catch {
                    // Cette URL n'est pas disponible, on essaie la suivante
                }
            }

            if (models.length > 0) {
                // Sort: local chat models first, then cloud, then embeddings last
                models.sort((a, b) => {
                    const rank = (m: OllamaModelInfo) =>
                        m.isEmbedding ? 3 : m.isCloud ? 2 : 1;
                    const r = rank(a) - rank(b);
                    if (r !== 0) return r;
                    return a.name.localeCompare(b.name);
                });
                setAvailableModels(models);
            } else if (attempt < 3) {
                // Ollama n'est peut-être pas encore prêt — retry dans 3s (max 3 tentatives)
                setTimeout(() => fetchOllamaModels(attempt + 1), 3000);
            }
        } catch {
            // Silencieux — Ollama peut ne pas être installé
        } finally {
            setModelsLoading(false);
        }
    }

    async function pullModel(modelName: string) {
        const name = modelName.trim();
        if (!name || pullState) return;
        const baseUrl = useVoixifyStore.getState().ollamaUrl || 'http://localhost:11434';
        const controller = new AbortController();
        pullAbortRef.current = controller;
        setPullState({ name, percent: 0, status: 'Initialisation…', error: null });

        try {
            const res = await fetch(`${baseUrl}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, stream: true }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) {
                throw new Error(`HTTP ${res.status} — modèle introuvable ou Ollama indisponible`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let succeeded = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.error) throw new Error(msg.error);
                        const percent = msg.total && msg.completed
                            ? Math.round((msg.completed / msg.total) * 100)
                            : undefined;
                        setPullState(s => s ? {
                            ...s,
                            percent: percent ?? s.percent,
                            status: msg.status || s.status,
                        } : null);
                        if (msg.status === 'success') succeeded = true;
                    } catch (parseErr: any) {
                        // Rethrow real errors; ignore garbled partial lines
                        if (parseErr?.message && !parseErr.message.startsWith('Unexpected')) {
                            throw parseErr;
                        }
                    }
                }
            }

            if (succeeded) {
                setPullState(null);
                setCustomPullName('');
                fetchOllamaModels();
            } else {
                setPullState(s => s ? { ...s, error: 'Téléchargement interrompu avant la fin' } : null);
                setTimeout(() => setPullState(null), 4000);
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setPullState(null);
            } else {
                setPullState(s => s ? { ...s, error: err.message || 'Erreur inconnue' } : null);
                setTimeout(() => setPullState(null), 4000);
            }
        } finally {
            pullAbortRef.current = null;
        }
    }

    function cancelPull() {
        pullAbortRef.current?.abort();
    }

    async function applyHotkey(key: string) {
        setHotkey(key);
        const result = await api?.updateHotkey(key);
        setHotkeyStatus(result?.success === false ? 'error' : 'ok');
        setTimeout(() => setHotkeyStatus('idle'), 2000);
    }

    const selectedModelInfo = availableModels.find(m => m.name === ollamaModel);

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
                        className={`sidebar-nav-item ${activeTab === 'input' ? 'active' : ''}`}
                        onClick={() => setActiveTab('input')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M6 8h.01" />
                            <path d="M10 8h.01" />
                            <path d="M14 8h.01" />
                            <path d="M18 8h.01" />
                            <path d="M8 12h.01" />
                            <path d="M12 12h.01" />
                            <path d="M16 12h.01" />
                            <path d="M7 16h10" />
                        </svg>
                        Entrée
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
                    <div className="settings-version">Voixify v2.0 — Brainditech</div>
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
                            <p className="settings-page-desc">Configurez la reconnaissance vocale.</p>

                            {/* Langue */}
                            <section className="settings-section">
                                <h2 className="settings-section-title">Langue de dictée</h2>
                                <div className="pill-group">
                                    {LANG_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            className={`pill-btn ${lang === opt.value ? 'active' : ''}`}
                                            onClick={() => setSetting('lang', opt.value)}
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
                                        onClick={() => setSetting('transcriptionSource', 'deepgram')}
                                    >
                                        ☁️&nbsp; Deepgram
                                    </button>
                                    <button
                                        className={`pill-btn ${transcriptionSource === 'whisper' ? 'active' : ''}`}
                                        onClick={() => setSetting('transcriptionSource', 'whisper')}
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

                            {/* Clé API Whisper */}
                            {transcriptionSource === 'whisper' && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Clé API Whisper</h2>
                                    <div className="api-key-row">
                                        <input
                                            className="settings-input api-key-input"
                                            type={showWhisperKey ? 'text' : 'password'}
                                            value={whisperApiKey}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setWhisperApiKey(val);
                                                if (whisperKeySaveTimer.current) clearTimeout(whisperKeySaveTimer.current);
                                                whisperKeySaveTimer.current = setTimeout(() => {
                                                    api?.updateSettings({ whisperApiKey: val })
                                                        .then(() => {
                                                            setWhisperKeySaved(true);
                                                            setTimeout(() => setWhisperKeySaved(false), 2500);
                                                        })
                                                        .catch(() => {});
                                                }, 400);
                                            }}
                                            placeholder="Collez votre clé API Whisper ici…"
                                            spellCheck={false}
                                            autoComplete="off"
                                        />
                                        <button
                                            className="api-key-toggle"
                                            onClick={() => setShowWhisperKey(!showWhisperKey)}
                                            title={showWhisperKey ? 'Masquer' : 'Afficher'}
                                            type="button"
                                        >
                                            {showWhisperKey ? (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                                    <line x1="1" y1="1" x2="23" y2="23" />
                                                </svg>
                                            ) : (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                    <circle cx="12" cy="12" r="3" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                    <p className="settings-hint" style={{ color: whisperKeySaved ? '#4ade80' : undefined }}>
                                        {whisperKeySaved
                                            ? '✓ Clé sauvegardée dans le profil'
                                            : whisperApiKey
                                                ? '✓ Clé configurée — envoyée en Bearer token à Whisper'
                                                : '⚠ Beaucoup d\'instances auto-hébergées (dont l\'API Docker) EXIGENT une clé — elle doit correspondre à API_KEY du serveur.'}
                                    </p>
                                </section>
                            )}

                            {/* Vocabulaire / prompt initial (Whisper uniquement) */}
                            {transcriptionSource === 'whisper' && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Vocabulaire / prompt initial</h2>
                                    <textarea
                                        className="settings-input"
                                        style={{ minHeight: 72, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }}
                                        value={initialPrompt}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setInitialPrompt(val);
                                            if (initialPromptSaveTimer.current) clearTimeout(initialPromptSaveTimer.current);
                                            initialPromptSaveTimer.current = setTimeout(() => {
                                                api?.updateSettings({ initialPrompt: val }).catch(() => {});
                                            }, 400);
                                        }}
                                        placeholder="Noms propres, jargon, sigles… ex : Brainditech, Voixify, Deepgram, Kubernetes, ARN"
                                        spellCheck={false}
                                    />
                                    <p className="settings-hint">
                                        Envoyé comme <code>initial_prompt</code> à Whisper : oriente l'orthographe des noms,
                                        du jargon et des accents. Le plus gros levier de précision pour la dictée.
                                    </p>
                                </section>
                            )}

                            {/* Clé API Deepgram */}
                            {transcriptionSource === 'deepgram' && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Clé API Deepgram</h2>
                                    <div className="api-key-row">
                                        <input
                                            className="settings-input api-key-input"
                                            type={showApiKey ? 'text' : 'password'}
                                            value={deepgramApiKey}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setDeepgramApiKey(val);
                                                if (apiKeySaveTimer.current) clearTimeout(apiKeySaveTimer.current);
                                                apiKeySaveTimer.current = setTimeout(() => {
                                                    api?.updateSettings({ deepgramApiKey: val })
                                                        .then(() => {
                                                            setApiKeySaved(true);
                                                            setTimeout(() => setApiKeySaved(false), 2500);
                                                        })
                                                        .catch(() => {});
                                                }, 400);
                                            }}
                                            placeholder="Collez votre clé API Deepgram ici…"
                                            spellCheck={false}
                                            autoComplete="off"
                                        />
                                        <button
                                            className="api-key-toggle"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            title={showApiKey ? 'Masquer' : 'Afficher'}
                                            type="button"
                                        >
                                            {showApiKey ? (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                                    <line x1="1" y1="1" x2="23" y2="23" />
                                                </svg>
                                            ) : (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                    <circle cx="12" cy="12" r="3" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                    <p className="settings-hint" style={{ color: apiKeySaved ? '#4ade80' : undefined }}>
                                        {apiKeySaved
                                            ? '✓ Clé sauvegardée dans le profil'
                                            : deepgramApiKey
                                                ? '✓ Clé configurée'
                                                : '⚠ Aucune clé — la transcription ne fonctionnera pas'}
                                    </p>
                                </section>
                            )}

                            {/* Modèle Deepgram */}
                            {transcriptionSource === 'deepgram' && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Modèle Deepgram</h2>
                                    <div className="model-grid">
                                        {DEEPGRAM_MODELS.map(m => (
                                            <button
                                                key={m.value}
                                                className={`model-btn ${deepgramModel === m.value ? 'active' : ''}`}
                                                onClick={() => setSetting('deepgramModel', m.value)}
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
                        </div>
                    )}

                    {activeTab === 'input' && (
                        <div className="settings-body">
                            <div className="settings-page-title">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="4" width="20" height="16" rx="2" />
                                    <path d="M6 8h.01" />
                                    <path d="M10 8h.01" />
                                    <path d="M14 8h.01" />
                                    <path d="M18 8h.01" />
                                    <path d="M8 12h.01" />
                                    <path d="M12 12h.01" />
                                    <path d="M16 12h.01" />
                                    <path d="M7 16h10" />
                                </svg>
                                <span>Entrée</span>
                            </div>
                            <p className="settings-page-desc">Microphone et raccourci clavier.</p>

                            {/* Microphone */}
                            <section className="settings-section">
                                <h2 className="settings-section-title">Microphone</h2>
                                <select
                                    className="settings-select"
                                    value={selectedMicId}
                                    onChange={e => setSetting('selectedMicId', e.target.value)}
                                >
                                    <option value="">Par défaut (système)</option>
                                    {audioDevices.map(d => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {d.label || `Microphone (${d.deviceId.substring(0, 8)}…)`}
                                        </option>
                                    ))}
                                </select>
                                <p className="settings-hint">
                                    {audioDevices.length === 0
                                        ? '⚠ Aucun microphone détecté'
                                        : `${audioDevices.length} microphone${audioDevices.length > 1 ? 's' : ''} détecté${audioDevices.length > 1 ? 's' : ''}`}
                                </p>
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
                            </section>

                            {/* Mode d'activation */}
                            <section className="settings-section">
                                <div className="settings-row">
                                    <div>
                                        <h2 className="settings-section-title" style={{ marginBottom: 0 }}>Mode mains-libres</h2>
                                        <p className="settings-hint" style={{ marginTop: 2 }}>
                                            {hotkeyMode === 'toggle'
                                                ? '1ᵉʳ appui = démarrer, 2ᵉ appui = arrêter et coller (vous pouvez lâcher la touche)'
                                                : 'Maintenir la touche pour enregistrer, relâcher pour coller'}
                                        </p>
                                    </div>
                                    <button
                                        className={`toggle ${hotkeyMode === 'toggle' ? 'on' : 'off'}`}
                                        onClick={() => setSetting(
                                            'hotkeyMode',
                                            hotkeyMode === 'toggle' ? 'hold' : 'toggle',
                                        )}
                                    >
                                        <span className="toggle-thumb" />
                                    </button>
                                </div>
                            </section>

                            {/* Mode de capture (latence vs vie privée) */}
                            <section className="settings-section">
                                <div className="settings-row">
                                    <div>
                                        <h2 className="settings-section-title" style={{ marginBottom: 0 }}>Mode basse latence</h2>
                                        <p className="settings-hint" style={{ marginTop: 2 }}>
                                            {lowLatencyMode
                                                ? 'Le micro reste actif en permanence et capture les 500 ms précédant l\'appui. Aucun mot perdu. L\'indicateur micro de Windows reste allumé tant que Voixify tourne.'
                                                : 'Le micro est libéré entre les dictées. L\'interface s\'affiche avec un léger décalage (~150 ms), une fois la capture confirmée — pour que la pill soit synchrone avec l\'enregistrement.'}
                                        </p>
                                    </div>
                                    <button
                                        className={`toggle ${lowLatencyMode ? 'on' : 'off'}`}
                                        onClick={() => setSetting('lowLatencyMode', !lowLatencyMode)}
                                    >
                                        <span className="toggle-thumb" />
                                    </button>
                                </div>
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
                                        onClick={() => {
                                            const willBeEnabled = !llmCorrectionEnabled;
                                            setSetting('llmCorrectionEnabled', willBeEnabled);
                                            // Legacy state can leave correctionLevel at 'off' from before
                                            // this option was removed from the picker. Promote to 'standard'
                                            // so enabling the toggle yields an immediately-active level.
                                            if (willBeEnabled && correctionLevel === 'off') {
                                                setSetting('correctionLevel', 'standard');
                                            }
                                        }}
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
                                                onClick={() => setSetting('correctionLevel', opt.value)}
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
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <h2 className="settings-section-title" style={{ marginBottom: 0 }}>
                                            Modèle IA locale (Ollama)
                                            {modelsLoading && <span className="settings-badge">chargement…</span>}
                                        </h2>
                                        <button
                                            type="button"
                                            className="pill-btn"
                                            style={{ padding: '4px 10px', fontSize: 12 }}
                                            onClick={() => fetchOllamaModels()}
                                            disabled={modelsLoading}
                                            title="Rafraîchir la liste des modèles Ollama"
                                        >
                                            ↻&nbsp; Rafraîchir
                                        </button>
                                    </div>

                                    {availableModels.length === 0 && !modelsLoading ? (
                                        <div className="settings-hint" style={{ lineHeight: 1.6 }}>
                                            <p style={{ marginBottom: 8 }}>
                                                ⚠ Aucun modèle détecté. Vérifiez qu'Ollama est lancé
                                                sur <code>{ollamaUrl}</code>.
                                            </p>
                                            <p style={{ marginBottom: 4 }}>Modèles recommandés pour la correction :</p>
                                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                                {RECOMMENDED_LOCAL_MODELS.map(r => (
                                                    <li key={r.pull}>
                                                        <code>ollama pull {r.pull}</code> — {r.why}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : (
                                        <>
                                            <select
                                                className="settings-select"
                                                value={ollamaModel}
                                                onChange={e => setSetting('ollamaModel', e.target.value)}
                                            >
                                                {/* Show the persisted selection even if Ollama doesn't know it yet
                                                    (e.g. before the first /api/tags response returns) */}
                                                {!availableModels.some(m => m.name === ollamaModel) && ollamaModel && (
                                                    <option value={ollamaModel}>{ollamaModel}</option>
                                                )}
                                                {availableModels.map(m => {
                                                    const icon = m.isEmbedding ? '🚫' : m.isCloud ? '☁️' : '📍';
                                                    const metaShort = [m.parameterSize, formatSize(m.sizeBytes)]
                                                        .filter(s => s && s !== '—').join(' · ');
                                                    return (
                                                        <option
                                                            key={m.name}
                                                            value={m.name}
                                                            disabled={m.isEmbedding}
                                                        >
                                                            {icon}  {m.name}{metaShort ? `  —  ${metaShort}` : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>

                                            {/* Detail card for the current selection */}
                                            {selectedModelInfo && (
                                                <div
                                                    className="model-btn active"
                                                    style={{
                                                        marginTop: 10,
                                                        cursor: 'default',
                                                        pointerEvents: 'none',
                                                        borderColor: selectedModelInfo.isEmbedding
                                                            ? 'rgba(239, 68, 68, 0.35)'
                                                            : selectedModelInfo.isCloud
                                                                ? 'rgba(245, 158, 11, 0.35)'
                                                                : 'rgba(74, 222, 128, 0.3)',
                                                        background: selectedModelInfo.isEmbedding
                                                            ? 'rgba(239, 68, 68, 0.06)'
                                                            : selectedModelInfo.isCloud
                                                                ? 'rgba(245, 158, 11, 0.06)'
                                                                : 'rgba(74, 222, 128, 0.08)',
                                                        color: selectedModelInfo.isEmbedding
                                                            ? '#ef4444'
                                                            : selectedModelInfo.isCloud
                                                                ? '#f59e0b'
                                                                : '#4ade80',
                                                    }}
                                                >
                                                    <span className="model-label">
                                                        {selectedModelInfo.name}
                                                        {selectedModelInfo.isEmbedding && (
                                                            <span className="model-badge" style={{ color: '#ef4444' }}>embed — inutilisable</span>
                                                        )}
                                                        {selectedModelInfo.isCloud && !selectedModelInfo.isEmbedding && (
                                                            <span className="model-badge">cloud</span>
                                                        )}
                                                        {!selectedModelInfo.isCloud && !selectedModelInfo.isEmbedding && (
                                                            <span className="model-badge" style={{ color: '#4ade80' }}>local</span>
                                                        )}
                                                    </span>
                                                    <span className="model-desc">
                                                        {[
                                                            selectedModelInfo.parameterSize && `${selectedModelInfo.parameterSize} paramètres`,
                                                            formatSize(selectedModelInfo.sizeBytes) !== '—' && formatSize(selectedModelInfo.sizeBytes),
                                                            selectedModelInfo.family,
                                                            selectedModelInfo.quantization,
                                                        ].filter(Boolean).join(' • ') || '—'}
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {selectedModelInfo?.isEmbedding && (
                                        <p className="settings-hint" style={{ color: '#ef4444' }}>
                                            ⚠ <b>{ollamaModel}</b> est un modèle d'embeddings/OCR —
                                            la correction ne fonctionnera pas. Choisissez un modèle <b>📍 local</b>.
                                        </p>
                                    )}
                                    {selectedModelInfo?.isCloud && (
                                        <p className="settings-hint" style={{ color: '#f59e0b' }}>
                                            ⚠ Modèle <b>:cloud</b> — inférence distante (latence réseau + modèle géant).
                                            Pour une correction en 1–3s, préférez un modèle local léger
                                            (ex: <code>llama3.2:3b</code>, <code>qwen2.5:3b</code>).
                                        </p>
                                    )}
                                    {selectedModelInfo && !selectedModelInfo.isCloud && !selectedModelInfo.isEmbedding && (
                                        <p className="settings-hint">
                                            Modèle local — 1ère correction ~5s (chargement VRAM), suivantes ~1–3s.
                                        </p>
                                    )}
                                </section>
                            )}

                            {/* Télécharger un nouveau modèle Ollama */}
                            {llmCorrectionEnabled && (
                                <section className="settings-section">
                                    <h2 className="settings-section-title">Télécharger un modèle</h2>

                                    {pullState ? (
                                        <div style={{
                                            padding: 12,
                                            borderRadius: 8,
                                            background: 'rgba(74, 222, 128, 0.06)',
                                            border: '1px solid rgba(74, 222, 128, 0.25)',
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>
                                                    📥 {pullState.name}
                                                </span>
                                                <span style={{ fontSize: 12, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
                                                    {pullState.error ? '—' : `${pullState.percent}%`}
                                                </span>
                                            </div>
                                            <div style={{
                                                height: 6,
                                                borderRadius: 3,
                                                background: 'rgba(255, 255, 255, 0.08)',
                                                overflow: 'hidden',
                                                marginBottom: 8,
                                            }}>
                                                <div style={{
                                                    height: '100%',
                                                    width: `${pullState.percent}%`,
                                                    background: pullState.error ? '#ef4444' : '#4ade80',
                                                    transition: 'width 200ms ease-out',
                                                }} />
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: 11, color: pullState.error ? '#ef4444' : 'rgba(255,255,255,0.55)' }}>
                                                    {pullState.error || pullState.status}
                                                </span>
                                                {!pullState.error && (
                                                    <button
                                                        type="button"
                                                        className="pill-btn"
                                                        style={{ padding: '3px 10px', fontSize: 11 }}
                                                        onClick={cancelPull}
                                                    >
                                                        Annuler
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="settings-hint" style={{ marginBottom: 8 }}>
                                                Modèles légers recommandés pour la correction :
                                            </p>
                                            <div className="pill-group" style={{ flexWrap: 'wrap', gap: 6 }}>
                                                {RECOMMENDED_LOCAL_MODELS
                                                    .filter(r => !availableModels.some(m => m.name.startsWith(r.pull.split(':')[0])))
                                                    .map(r => (
                                                        <button
                                                            key={r.pull}
                                                            type="button"
                                                            className="pill-btn"
                                                            onClick={() => pullModel(r.pull)}
                                                            title={r.why}
                                                        >
                                                            📥&nbsp; {r.pull}
                                                        </button>
                                                    ))}
                                                {RECOMMENDED_LOCAL_MODELS
                                                    .every(r => availableModels.some(m => m.name.startsWith(r.pull.split(':')[0]))) && (
                                                        <span className="settings-hint" style={{ color: '#4ade80' }}>
                                                            ✓ Tous les modèles recommandés sont déjà installés
                                                        </span>
                                                    )}
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                                <input
                                                    className="settings-input"
                                                    style={{ flex: 1 }}
                                                    value={customPullName}
                                                    onChange={e => setCustomPullName(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter' && customPullName.trim()) pullModel(customPullName); }}
                                                    placeholder="Autre modèle (ex: mistral:7b, gemma2:2b…)"
                                                    spellCheck={false}
                                                    autoComplete="off"
                                                />
                                                <button
                                                    type="button"
                                                    className="pill-btn"
                                                    onClick={() => pullModel(customPullName)}
                                                    disabled={!customPullName.trim()}
                                                    style={{ opacity: customPullName.trim() ? 1 : 0.4 }}
                                                >
                                                    Télécharger
                                                </button>
                                            </div>
                                            <p className="settings-hint" style={{ marginTop: 6 }}>
                                                Le téléchargement peut prendre plusieurs minutes selon la taille du modèle
                                                et votre connexion (2–8 GB typiquement).
                                            </p>
                                        </>
                                    )}
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
                                        onClick={() => setSetting('autopasteEnabled', !autopasteEnabled)}
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
                                    onChange={e => setSetting('whisperUrl', e.target.value)}
                                    placeholder="http://localhost:9990"
                                />
                                <label className="settings-label" style={{ marginTop: 10 }}>Ollama URL</label>
                                <input
                                    className="settings-input"
                                    value={ollamaUrl}
                                    onChange={e => setSetting('ollamaUrl', e.target.value)}
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
