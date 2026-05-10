import React, { useEffect, useState } from 'react';
import { useSyncSettings } from '../hooks/useSyncSettings';
import { useVoixifyStore } from '../stores/voixifyStore';

// Voixify bridge surface used by this window. Kept minimal — just the methods
// the file-transcription flow actually needs.
interface VoixifyApi {
    closeTranscribe?: () => Promise<void>;
    pickTranscriptionFile?: () => Promise<{ path: string; name: string; sizeBytes: number } | null>;
    transcribeFile?: (payload: { filePath: string; language?: string }) => Promise<TranscribeResult>;
    saveTranscription?: (payload: { content: string; format: 'txt' | 'md'; suggestedName?: string }) => Promise<{ success?: boolean; canceled?: boolean; path?: string; error?: string }>;
    copyToClipboard?: (text: string) => Promise<void>;
}

interface TranscribeResult {
    success: boolean;
    transcript?: string;
    durationMs?: number;
    fileName?: string;
    sizeBytes?: number;
    error?: string;
}

type State =
    | { status: 'idle' }
    | { status: 'loading'; fileName: string; sizeBytes: number }
    | { status: 'done'; fileName: string; durationMs: number; sizeBytes: number }
    | { status: 'error'; message: string; lastFile?: { path: string; name: string; sizeBytes: number } };

function humanSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function buildMarkdown(fileName: string, content: string): string {
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return `# Transcription — ${fileName}\n\n> Source : ${fileName}\n> Date : ${date}\n\n${content}\n`;
}

function suggestedBaseName(fileName: string | undefined): string {
    if (!fileName) return 'transcription';
    return fileName.replace(/\.[^.]+$/, '');
}

export default function FileTranscriber() {
    // Hydrate language + Whisper config from main settings; setSetting unused here.
    useSyncSettings();
    const lang = useVoixifyStore(s => s.lang);

    const [state, setState] = useState<State>({ status: 'idle' });
    const [transcript, setTranscript] = useState<string>('');
    const [savedHint, setSavedHint] = useState<string | null>(null);

    const api = (window as any).voixify as VoixifyApi | undefined;

    // Clear the "Sauvegardé" hint after a few seconds.
    useEffect(() => {
        if (!savedHint) return;
        const t = setTimeout(() => setSavedHint(null), 3000);
        return () => clearTimeout(t);
    }, [savedHint]);

    async function handlePickAndTranscribe() {
        if (!api?.pickTranscriptionFile || !api?.transcribeFile) {
            setState({ status: 'error', message: 'IPC bridge indisponible' });
            return;
        }
        const picked = await api.pickTranscriptionFile();
        if (!picked) return; // user cancelled — stay idle
        setState({ status: 'loading', fileName: picked.name, sizeBytes: picked.sizeBytes });
        setTranscript('');

        try {
            const result = await api.transcribeFile({ filePath: picked.path, language: lang });
            if (result.success && typeof result.transcript === 'string') {
                setTranscript(result.transcript);
                setState({
                    status: 'done',
                    fileName: result.fileName || picked.name,
                    durationMs: result.durationMs || 0,
                    sizeBytes: result.sizeBytes || picked.sizeBytes,
                });
            } else {
                setState({
                    status: 'error',
                    message: result.error || 'Échec inconnu',
                    lastFile: picked,
                });
            }
        } catch (e: any) {
            setState({
                status: 'error',
                message: e?.message || 'Erreur inattendue',
                lastFile: picked,
            });
        }
    }

    async function handleRetry() {
        if (state.status !== 'error' || !state.lastFile || !api?.transcribeFile) return;
        const file = state.lastFile;
        setState({ status: 'loading', fileName: file.name, sizeBytes: file.sizeBytes });
        try {
            const result = await api.transcribeFile({ filePath: file.path, language: lang });
            if (result.success && typeof result.transcript === 'string') {
                setTranscript(result.transcript);
                setState({
                    status: 'done',
                    fileName: result.fileName || file.name,
                    durationMs: result.durationMs || 0,
                    sizeBytes: result.sizeBytes || file.sizeBytes,
                });
            } else {
                setState({ status: 'error', message: result.error || 'Échec inconnu', lastFile: file });
            }
        } catch (e: any) {
            setState({ status: 'error', message: e?.message || 'Erreur inattendue', lastFile: file });
        }
    }

    async function handleSave(format: 'txt' | 'md') {
        if (state.status !== 'done' || !api?.saveTranscription) return;
        const fileName = state.fileName;
        const content = format === 'md' ? buildMarkdown(fileName, transcript) : transcript;
        const res = await api.saveTranscription({
            content,
            format,
            suggestedName: suggestedBaseName(fileName),
        });
        if (res?.success && res.path) {
            setSavedHint(`Sauvegardé : ${res.path}`);
        } else if (res?.error) {
            setSavedHint(`Erreur : ${res.error}`);
        }
    }

    async function handleCopy() {
        if (!transcript) return;
        if (api?.copyToClipboard) {
            await api.copyToClipboard(transcript);
        } else {
            try { await navigator.clipboard.writeText(transcript); } catch { /* best effort */ }
        }
        setSavedHint('Copié dans le presse-papiers');
    }

    function handleReset() {
        setState({ status: 'idle' });
        setTranscript('');
        setSavedHint(null);
    }

    function handleClose() {
        api?.closeTranscribe?.();
    }

    const charCount = transcript.length;
    const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

    return (
        <div className="transcribe-window">
            <header className="transcribe-header">
                <div>
                    <h1 className="transcribe-title">📄 Transcription de fichier</h1>
                    <p className="transcribe-subtitle">Charge un audio ou une vidéo, récupère le texte, télécharge en .txt ou .md.</p>
                </div>
                <button className="transcribe-close" onClick={handleClose} aria-label="Fermer">×</button>
            </header>

            <main className="transcribe-body">
                {state.status === 'idle' && (
                    <div className="transcribe-pickzone">
                        <button className="transcribe-pick-btn" onClick={handlePickAndTranscribe}>
                            Choisir un fichier audio / vidéo
                        </button>
                        <p className="transcribe-hint">
                            Formats acceptés : MP3, WAV, M4A, FLAC, OGG, OPUS, WebM, AAC, MP4, MOV, MKV, AVI…
                            <br />
                            Taille max : 1,5 Go. La langue actuelle est <strong>{lang}</strong> (modifiable dans Paramètres).
                        </p>
                    </div>
                )}

                {state.status === 'loading' && (
                    <div className="transcribe-loading">
                        <div className="transcribe-spinner" />
                        <p className="transcribe-loading-title">Transcription en cours…</p>
                        <p className="transcribe-loading-meta">
                            <strong>{state.fileName}</strong> · {humanSize(state.sizeBytes)}
                        </p>
                        <p className="transcribe-hint">
                            Whisper traite le fichier. Cela peut prendre quelques minutes pour les longues vidéos.
                        </p>
                    </div>
                )}

                {state.status === 'done' && (
                    <div className="transcribe-done">
                        <div className="transcribe-meta">
                            <span><strong>{state.fileName}</strong></span>
                            <span>·</span>
                            <span>{humanSize(state.sizeBytes)}</span>
                            <span>·</span>
                            <span>traité en {(state.durationMs / 1000).toFixed(1)}s</span>
                            <span>·</span>
                            <span>{wordCount} mots / {charCount} car.</span>
                        </div>
                        <textarea
                            className="transcribe-text"
                            value={transcript}
                            onChange={e => setTranscript(e.target.value)}
                            spellCheck={true}
                            aria-label="Transcription"
                        />
                        <div className="transcribe-actions">
                            <button className="transcribe-btn" onClick={handleCopy} disabled={!transcript}>
                                Copier
                            </button>
                            <button className="transcribe-btn" onClick={() => handleSave('txt')} disabled={!transcript}>
                                Sauver .txt
                            </button>
                            <button className="transcribe-btn primary" onClick={() => handleSave('md')} disabled={!transcript}>
                                Sauver .md
                            </button>
                            <button className="transcribe-btn ghost" onClick={handleReset}>
                                Nouvelle transcription
                            </button>
                        </div>
                        {savedHint && <p className="transcribe-saved-hint">{savedHint}</p>}
                    </div>
                )}

                {state.status === 'error' && (
                    <div className="transcribe-error">
                        <p className="transcribe-error-title">⚠️ Échec de la transcription</p>
                        <p className="transcribe-error-msg">{state.message}</p>
                        <div className="transcribe-actions">
                            {state.lastFile && (
                                <button className="transcribe-btn primary" onClick={handleRetry}>Réessayer</button>
                            )}
                            <button className="transcribe-btn" onClick={handlePickAndTranscribe}>Choisir un autre fichier</button>
                            <button className="transcribe-btn ghost" onClick={handleReset}>Annuler</button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
