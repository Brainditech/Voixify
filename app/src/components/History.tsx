import React, { useState } from 'react';
import { useVoixifyStore } from '../stores/voixifyStore';

const api = (window as any).voixify;

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'à l\'instant';
    if (mins < 60) return `il y a ${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `il y a ${days}j`;
}

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
}

export default function History() {
    const history = useVoixifyStore(s => s.history);
    const deleteHistoryItem = useVoixifyStore(s => s.deleteHistoryItem);
    const clearHistory = useVoixifyStore(s => s.clearHistory);
    const [search, setSearch] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const filtered = search.trim()
        ? history.filter(h =>
            (h.correctedText || h.rawText).toLowerCase().includes(search.toLowerCase())
        )
        : history;

    function handleCopy(id: string, text: string) {
        api?.copyToClipboard(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    }

    return (
        <div className="history-panel">
            {/* Privacy banner */}
            <div className="history-privacy">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div>
                    <span className="history-privacy-title">Données stockées localement</span>
                    <span className="history-privacy-desc">Vos données restent sur votre appareil</span>
                </div>
            </div>

            {/* Search + Clear */}
            <div className="history-toolbar">
                <div className="history-search-wrap">
                    <svg className="history-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        className="history-search"
                        type="text"
                        placeholder="Rechercher…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                {history.length > 0 && (
                    <button className="history-clear" onClick={clearHistory}>
                        Tout effacer
                    </button>
                )}
            </div>

            {/* Items */}
            <div className="history-list">
                {filtered.length === 0 && (
                    <div className="history-empty">
                        {history.length === 0
                            ? 'Aucune dictée pour le moment.\nUtilisez Ctrl+Space pour commencer.'
                            : 'Aucun résultat trouvé.'
                        }
                    </div>
                )}
                {filtered.map(item => {
                    const text = item.correctedText || item.rawText;
                    return (
                        <div key={item.id} className="history-card">
                            <div className="history-card-header">
                                <div className="history-card-meta">
                                    <span className="history-badge-lang">{item.lang === 'fr' ? '🇫🇷' : '🇬🇧'}</span>
                                    <span className="history-badge-duration">⏱ {formatDuration(item.duration)}</span>
                                </div>
                                <span className="history-card-time">{timeAgo(item.timestamp)}</span>
                            </div>
                            <p className="history-card-text">{text}</p>
                            <div className="history-card-actions">
                                <button
                                    className={`history-action-btn ${copiedId === item.id ? 'copied' : ''}`}
                                    onClick={() => handleCopy(item.id, text)}
                                    title="Copier"
                                >
                                    {copiedId === item.id ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    )}
                                </button>
                                <button
                                    className="history-action-btn delete"
                                    onClick={() => deleteHistoryItem(item.id)}
                                    title="Supprimer"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
