import { useEffect, useRef, useState } from 'react';

// Renders in the dedicated bottom-right toast window. The main process shows
// the window and pushes a {type, message}; this component owns the lifecycle:
// display → wait DURATION → fade out → ask main to hide the window. A new toast
// arriving mid-display replaces the message and restarts the timers.

type ToastType = 'error' | 'warning' | 'info';
interface ToastPayload { type: ToastType; message: string; }

const DURATION_MS = 6000;
const FADE_MS = 280;

const ICONS: Record<ToastType, string> = { error: '✕', warning: '!', info: 'i' };

export default function Toast() {
    const [toast, setToast] = useState<ToastPayload | null>(null);
    const [leaving, setLeaving] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const api = window.voixify;
        if (!api?.onToast) return;

        const clearTimers = () => {
            if (hideTimer.current) clearTimeout(hideTimer.current);
            if (fadeTimer.current) clearTimeout(fadeTimer.current);
        };

        api.onToast((payload: ToastPayload) => {
            clearTimers();
            setLeaving(false);
            setToast(payload);
            hideTimer.current = setTimeout(() => {
                setLeaving(true); // CSS fade-out
                fadeTimer.current = setTimeout(() => {
                    setToast(null);
                    window.voixify?.hideToast?.();
                }, FADE_MS);
            }, DURATION_MS);
        });

        return clearTimers;
    }, []);

    if (!toast) return null;
    const type: ToastType = (['error', 'warning', 'info'] as const).includes(toast.type)
        ? toast.type
        : 'error';

    return (
        <div className={`vx-toast vx-toast-${type}${leaving ? ' leaving' : ''}`} role="alert">
            <span className="vx-toast-icon" aria-hidden="true">{ICONS[type]}</span>
            <span className="vx-toast-msg">{toast.message}</span>
        </div>
    );
}
