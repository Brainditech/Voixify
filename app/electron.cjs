const {
    app, BrowserWindow, globalShortcut, Tray, Menu, powerMonitor,
    clipboard, ipcMain, nativeImage, screen, dialog, session
} = require('electron');
const path = require('path');
const os = require('os');
const { exec, fork } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

// ─── Single Instance Lock ────────────────────────────────────
// Si une instance tourne déjà, on la focus et on quitte immédiatement.
// Cela garantit que l'ancienne instance (zombie ou non) libère ses
// raccourcis AVANT que la nouvelle tente de les enregistrer.
if (!app.requestSingleInstanceLock()) {
    // Une instance existe déjà → on lui envoie le signal de focus et on sort
    app.quit();
    process.exit(0);
}

// ─── Daily Logging System ────────────────────────────────────
// Logs are stored as one file per day (voixify_YYYY-MM-DD.log) inside a
// dedicated logs/ folder.  This prevents a single monolithic file from
// growing indefinitely and makes old logs easy to inspect or delete.
//
// Location:
//   Production → %APPDATA%/voixify/logs/
//   Dev        → %TEMP%/voixify-dev-logs/
//
// Optimisations:
//   • Buffered async writes (flush every 2 s or 16 KB – no sync I/O)
//   • Dynamic midnight rollover (getLogFile() is resolved on every flush)
//   • Auto-purge of files older than 30 days at startup

const originalMainLog = console.log;
const originalMainError = console.error;

let _logDirCache = null;

function getLogDir() {
    if (_logDirCache) return _logDirCache;
    // app.isPackaged is available synchronously even before whenReady()
    const base = app.isPackaged
        ? path.join(process.env.APPDATA || os.homedir(), 'voixify', 'logs')
        : path.join(os.tmpdir(), 'voixify-dev-logs');
    try { fs.mkdirSync(base, { recursive: true }); } catch (_) { /* dir may already exist */ }
    _logDirCache = base;
    return base;
}

function getLogFile() {
    const date = new Date().toISOString().slice(0, 10); // "2026-03-08"
    return path.join(getLogDir(), `voixify_${date}.log`);
}

// ─── Auto-purge logs older than 30 days ──────────────────────
function cleanOldLogs() {
    try {
        const dir = getLogDir();
        const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const f of fs.readdirSync(dir)) {
            if (!f.startsWith('voixify_') || !f.endsWith('.log')) continue;
            const full = path.join(dir, f);
            try {
                if (fs.statSync(full).mtimeMs < cutoffMs) {
                    fs.unlinkSync(full);
                    originalMainLog(`[STARTUP] Purged old log: ${f}`);
                }
            } catch (_) { /* best effort per file */ }
        }
    } catch (e) {
        originalMainError('[STARTUP] Log cleanup failed:', e.message);
    }
}

// Run cleanup immediately at startup
cleanOldLogs();

// Write session header into today's log file
try {
    fs.appendFileSync(getLogFile(),
        `\n--- SESSION START ${new Date().toISOString()} ---\n`, 'utf8');
} catch (_) { /* non-critical */ }

// ─── Buffered Async Logging ─────────────────────────────────
// Prevents synchronous disk I/O from blocking the main thread.
// Flushes every 2s or when the buffer exceeds 16KB.
let logBuffer = '';
let flushTimer = null;

function flushLog() {
    if (!logBuffer) return;
    const data = logBuffer;
    logBuffer = '';
    // getLogFile() is resolved on every flush so a midnight rollover
    // automatically creates the next day's file without restarting the app.
    fs.appendFile(getLogFile(), data, { encoding: 'utf8' }, (err) => {
        if (err) originalMainError('[LOG ERROR] Failed to write to disk:', err.message);
    });
}

function queueLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    logBuffer += `[${timestamp}] [${level}] ${message}\n`;

    if (logBuffer.length > 16384) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        flushLog();
    } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushLog();
        }, 2000);
    }
}

console.log = (...args) => {
    queueLog('LOG', args);
    originalMainLog(...args);
};

console.error = (...args) => {
    queueLog('ERROR', args);
    originalMainError(...args);
};
// ─── Suppress Chromium GPU-cache warnings ────────────────────
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-cache');

// ─── Load .env from project root ─────────────────────────────
const envPaths = [
    path.resolve(__dirname, '..', '..', '.env'),   // dev: project root
    path.resolve(__dirname, '..', '.env'),          // alt: one level up
    path.resolve(__dirname, '.env'),                // packaged: same dir
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, quiet: true });
        break;
    }
}

// ─── Config ──────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PILL_W = 180;
const PILL_H = 56;
const SETTINGS_W = 820;
const SETTINGS_H = 660;

// App icon path — used for tray and settings window
// Windows requires .ico for proper taskbar/tray display; other platforms use .png
const ICON_PATH = path.join(__dirname, 'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// ─── Normalize WHISPER_URL — strip trailing /transcribe so the call in transcribe.js doesn't duplicate it
const rawWhisperUrl = process.env.WHISPER_URL || 'http://127.0.0.1:9990';
process.env.WHISPER_URL = rawWhisperUrl.replace(/\/transcribe\/?$/, '');

// Deepgram key from environment (fallback — UI key takes priority)
const DEEPGRAM_KEY_ENV = process.env.DEEPGRAM_KEY || '';

// ─── Persistent settings file ────────────────────────────────
// Settings are saved to a JSON file in %APPDATA%/voixify/ so they
// survive full app restarts (API keys, hotkey, language, etc.)
function getSettingsPath() {
    // app.getPath('userData') may not be available before app.whenReady()
    // but the path itself is deterministic
    const userDataPath = app.isPackaged
        ? path.join(process.env.APPDATA || os.homedir(), 'voixify')
        : path.join(os.tmpdir(), 'voixify-dev-settings');
    return path.join(userDataPath, 'settings.json');
}

function loadPersistedSettings() {
    try {
        const filePath = getSettingsPath();
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log('[SETTINGS] Loaded from', filePath);
            return data;
        }
    } catch (e) {
        console.error('[SETTINGS] Failed to load persisted settings:', e.message);
    }
    return {};
}

function savePersistedSettings(settings) {
    try {
        const filePath = getSettingsPath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
        console.error('[SETTINGS] Failed to save settings:', e.message);
    }
}

// ─── Main-process settings store (source of truth across windows) ───
// When Settings window changes a value, it calls api.updateSettings({...})
// which syncs here. This avoids the multi-renderer Zustand isolation problem.
// At startup, we merge defaults ← persisted file ← env vars.
const persistedSettings = loadPersistedSettings();
const mainSettings = {
    transcriptionSource: 'deepgram',
    lang: 'auto',
    deepgramModel: 'nova-3',
    deepgramApiKey: '',
    whisperApiKey: '',
    correctionLevel: 'off',
    autopasteEnabled: true,
    llmCorrectionEnabled: false,
    ollamaModel: 'kimi-k2.5:cloud',
    selectedMicId: '',
    whisperUrl: process.env.WHISPER_URL || 'http://127.0.0.1:9990',
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    hotkeyMode: 'hold', // 'hold' = push-to-talk (legacy) | 'toggle' = press-once-to-start-press-again-to-stop
    // Persisted settings (from disk) override defaults.
    ...persistedSettings,
};
// .env is a FALLBACK only — never overrides a key the user typed in the UI.
// Without this rule, setting DEEPGRAM_KEY in .env made the UI field silently useless.
if (!mainSettings.deepgramApiKey && DEEPGRAM_KEY_ENV) {
    mainSettings.deepgramApiKey = DEEPGRAM_KEY_ENV;
}

// ─── IPC validation constants ────────────────────────────────
// `update-settings` spreads its payload into mainSettings — we must drop
// any key not on the allowlist so a malformed payload can't inject arbitrary
// state (e.g. a fake `hotkey` value bypassing registration).
const ALLOWED_SETTINGS_KEYS = new Set(Object.keys(mainSettings));
const ALLOWED_LANGS = new Set(['fr', 'en', 'auto']);
const MIN_AUDIO_BYTES = 1000;          // ~smaller than this can't contain audible content
const MAX_AUDIO_BYTES = 50_000_000;    // 50 MB cap — same as the old multer limit

function pickAllowedKeys(obj, allowedSet) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of Object.keys(obj)) {
        if (allowedSet.has(k)) out[k] = obj[k];
    }
    return out;
}

// ─── WebM repair ────────────────────────────────────────────
function fixWebmBuffer(buf) {
    const scanLimit = Math.min(buf.length - 4, 65536);
    for (let i = 0; i < scanLimit; i++) {
        if (buf[i] === 0x1a && buf[i + 1] === 0x45 && buf[i + 2] === 0xdf && buf[i + 3] === 0xa3) {
            return i > 0 ? buf.slice(i) : buf;
        }
    }
    return null;
}

// ─── State ───────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;
let tray = null;
let currentHotkey = persistedSettings.hotkey || 'CommandOrControl+Space';
let isRecordingActive = false;
let processingAudio = false;
// Références aux intervalles de heartbeat pour pouvoir les stopper proprement
let fastHeartbeatRef = null;
let slowHeartbeatRef = null;
let watchdogRef = null;

// ─── Failsafe Watchdog ───────────────────────────────────────
// If processingAudio stays true for too long (e.g. hanging network request),
// we force a reset so the user isn't stuck forever.
function startWatchdog() {
    if (watchdogRef) clearTimeout(watchdogRef);
    watchdogRef = setTimeout(() => {
        if (processingAudio) {
            console.error('[WATCHDOG] Audio processing stuck for >60s — forcing reset.');
            processingAudio = false;
            isRecordingActive = false;
            safeSend('state-change', 'error');
        }
    }, 60000); // 60s max
}

function stopWatchdog() {
    if (watchdogRef) {
        clearTimeout(watchdogRef);
        watchdogRef = null;
    }
}

// ─── Safe IPC send ───────────────────────────────────────────
function safeSend(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send(channel, ...args);
    }
}

// ─── Window position ─────────────────────────────────────────
function pillPos() {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    return { x: Math.round((sw - PILL_W) / 2), y: sh - PILL_H - 20 };
}

// ─── App icon ────────────────────────────────────────────────
function getAppIcon() {
    if (fs.existsSync(ICON_PATH)) {
        return nativeImage.createFromPath(ICON_PATH);
    }
    // Fallback: tiny transparent 1×1 placeholder

    return nativeImage.createEmpty();
}

// ─── Create pill window ──────────────────────────────────────
function createWindow() {
    const pos = pillPos();
    mainWindow = new BrowserWindow({
        width: PILL_W, height: PILL_H,
        x: pos.x, y: pos.y,
        frame: false, transparent: true, resizable: false,
        alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
        focusable: false,
        show: false,
        backgroundColor: '#00000000',
        icon: getAppIcon(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            // Pill is shown via showInactive() and never gets focus — without
            // this, Chromium classifies it as a backgrounded window and throttles
            // CSS animations, leaving the recording bars frozen on screen.
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

    // Refuse any window.open() — we never need popups, this blocks XSS pivot.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // ─── Media permissions (critical for file:// protocol in production) ───
    mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
        // Always grant media (microphone) access
        if (permission === 'media') { callback(true); return; }
        callback(false);
    });
    mainWindow.webContents.session.setPermissionCheckHandler((wc, permission) => {
        if (permission === 'media') return true;
        return false;
    });

    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

    if (isDev) mainWindow.loadURL('http://localhost:5173/#/pill');
    else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: 'pill' });

    mainWindow.on('closed', () => { mainWindow = null; });

    // ─── Renderer crash recovery ───────────────────────────────
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[CRASH] Renderer process gone:', details.reason);
        // Reset state so the app doesn't stay blocked
        processingAudio = false;
        isRecordingActive = false;
        stopWatchdog();
        // If it's a "crashed", try to reload/recreate
        if (details.reason === 'crashed' || details.reason === 'oom') {
            console.log('[CRASH] Attempting window reload...');
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
            }, 1000);
        }
    });
}

// ─── Create settings window ──────────────────────────────────
function createSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    settingsWindow = new BrowserWindow({
        width: SETTINGS_W,
        height: SETTINGS_H,
        x: Math.round((sw - SETTINGS_W) / 2),
        y: Math.round((sh - SETTINGS_H) / 2),
        frame: false,
        transparent: false,
        resizable: false,
        alwaysOnTop: false,
        skipTaskbar: false,
        hasShadow: true,
        show: false,
        backgroundColor: '#111115',
        icon: getAppIcon(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

    settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    if (isDev) settingsWindow.loadURL('http://localhost:5173/#/settings');
    else settingsWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: 'settings' });

    settingsWindow.once('ready-to-show', () => settingsWindow.show());
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Show pill ───────────────────────────────────────────────
function showPill() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const pos = pillPos();
    mainWindow.setBounds({ width: PILL_W, height: PILL_H, ...pos });
    // Sur Windows, showInactive() seul peut échouer à rendre la fenêtre
    // visible si une autre fenêtre est au premier plan. Le cycle
    // setAlwaysOnTop(true, 'screen-saver') force le DWM compositor
    // à placer la fenêtre au-dessus de tout, y compris les overlays jeu.
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.showInactive();
    safeSend('state-change', 'recording');
}

// ─── Stop recording and hide ─────────────────────────────────
function triggerStop() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    safeSend('state-change', 'processing');
    safeSend('stop-recording');

}

// ─── Hotkey registration — supports two modes ────────────────
// 'hold'   : push-to-talk. Maintain the key to record; releasing it stops and transcribes.
// 'toggle' : press-once-to-start, press-again-to-stop. Hands-free between the two presses.
let holdTimer = null;
let repeatCount = 0;
// Toggle-mode: timestamp of the previous callback, used to distinguish a
// fresh human press (gap > ~250 ms) from Windows key-repeat (~30 ms intervals).
let toggleLastCallbackTime = 0;

// Defensive re-registration: called on power resume, screen unlock, and heartbeat
// NOTE: we do NOT reset processingAudio / isRecordingActive here because the
// system could resume from sleep *during* an active recording — resetting those
// flags would leave the pill stuck in a processing state forever.
function ensureHotkeyRegistered() {
    // Only reset the hold-timer state (keyboard-level state, safe to reset)
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    repeatCount = 0;

    // Re-register the hotkey (registerHotkey calls unregisterAll internally)
    const success = registerHotkey(currentHotkey);
    console.log('[HOTKEY] Re-registered:', currentHotkey, '→', success);

    // Ensure pill window exists and is usable
    if (!mainWindow || mainWindow.isDestroyed()) {
        console.log('[HOTKEY] Pill window gone — recreating');
        createWindow();
    }

    return success;
}

function handleHoldModePress(key) {
    // Only log the first press, not the ~30/s repeats from Windows key-repeat
    if (repeatCount === 0) console.log('[HOTKEY] ✓ Callback triggered for', key, '(hold mode)');

    // Auto-recreate the Pill window if it was destroyed (crash, GC, etc.)
    if (!mainWindow || mainWindow.isDestroyed()) {
        if (repeatCount === 0) console.log('[HOTKEY] Pill window missing — recreating...');
        createWindow();
        mainWindow.webContents.once('did-finish-load', () => {
            if (processingAudio) return;
            isRecordingActive = true;
            showPill();
        });
        repeatCount = 1;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            if (isRecordingActive) {
                isRecordingActive = false;
                triggerStop();
            }
            holdTimer = null;
            repeatCount = 0;
        }, 2000); // longer timeout for first press after recreate
        return;
    }
    if (processingAudio) return;

    repeatCount++;

    if (repeatCount === 1) {
        isRecordingActive = true;
        showPill();
    }

    // Adaptive: 800ms on first press (>Windows repeat initial delay), 300ms after
    const timeout = repeatCount <= 1 ? 800 : 300;

    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
        if (isRecordingActive) {
            isRecordingActive = false;
            triggerStop();
        }
        holdTimer = null;
        repeatCount = 0;
    }, timeout);
}

function handleToggleModePress(key) {
    // Windows key-repeat fires this callback ~30×/s while held.
    // A fresh human press is separated by > ~250 ms from the previous callback,
    // so we use the gap to discriminate between repeats and genuine re-presses.
    const now = Date.now();
    const sinceLast = now - toggleLastCallbackTime;
    toggleLastCallbackTime = now;
    if (toggleLastCallbackTime > 0 && sinceLast < 250) return; // key-repeat → ignore

    console.log('[HOTKEY] ✓ Fresh press for', key, '(toggle mode) — isRecording:', isRecordingActive);

    // Auto-recreate the Pill window if it was destroyed
    if (!mainWindow || mainWindow.isDestroyed()) {
        console.log('[HOTKEY] Pill window missing — recreating...');
        createWindow();
        mainWindow.webContents.once('did-finish-load', () => {
            if (processingAudio) return;
            isRecordingActive = true;
            showPill();
        });
        return;
    }

    if (processingAudio) return; // ignore presses during transcription

    if (!isRecordingActive) {
        isRecordingActive = true;
        showPill();
    } else {
        isRecordingActive = false;
        triggerStop();
    }
}

function registerHotkey(key) {
    globalShortcut.unregisterAll();
    currentHotkey = key;
    if (tray) tray.setToolTip('Voixify');

    // Reset mode-specific transient state so a mode swap starts clean.
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    repeatCount = 0;
    toggleLastCallbackTime = 0;

    const mode = mainSettings.hotkeyMode === 'toggle' ? 'toggle' : 'hold';
    const handler = mode === 'toggle'
        ? () => handleToggleModePress(key)
        : () => handleHoldModePress(key);

    const success = globalShortcut.register(key, handler);

    console.log(`[HOTKEY] register("${key}", mode=${mode}) → ${success}`);
    if (!success) {
        console.error(`[HOTKEY] FAILED to register "${key}"`);
    }
    return success;
}

// ─── Tray ─────────────────────────────────────────────────────
function createTray() {
    const icon = getAppIcon();
    // For tray, resize to 16×16 (Windows tray standard)
    const trayIcon = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);

    const updateMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
        { label: '🎙 Voixify', enabled: false },
        { type: 'separator' },
        { label: '⚙️  Paramètres', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: 'Quitter', click: () => app.quit() },
    ]));

    updateMenu();
    tray.setToolTip('Voixify');
    tray.on('double-click', () => createSettingsWindow());
}

// ─── HTTP POST helper ─────────────────────────────────────────
function httpPost(urlStr, headers, bodyData, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(urlStr);
            const isHttps = urlObj.protocol === 'https:';
            const reqModule = isHttps ? https : http;
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers,
            };

            const req = reqModule.request(options, (res) => {
                let body = '';
                res.on('data', d => { body += d; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ statusCode: res.statusCode, body });
                    } else {
                        console.error('[HTTP ERROR]', res.statusCode, body.substring(0, 200));
                        reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                    }
                });
            });

            req.on('error', reject);

            // CRITICAL: timeout to prevent main process hangs
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                reject(new Error(`Request timeout (${timeoutMs}ms)`));
            });

            if (bodyData) req.write(bodyData);
            req.end();
        } catch (e) {
            reject(e);
        }
    });
}

// ─── Deepgram STT ─────────────────────────────────────────────
async function callDeepgram(audioBuffer, language, model = 'nova-3', apiKey = '') {
    const key = apiKey || DEEPGRAM_KEY_ENV;
    if (!key) {
        throw new Error('DEEPGRAM_KEY non configurée — ajoutez-la dans Paramètres > Transcription');
    }

    // Deepgram Nova-3 accepts 'multi' for automatic detection across languages.
    // For other models, 'multi' is not supported — fall back to 'en' so the call doesn't 400.
    const dgLang = language === 'auto'
        ? (model === 'nova-3' ? 'multi' : 'en')
        : language;
    const url = `https://api.deepgram.com/v1/listen?model=${model}&language=${dgLang}&smart_format=true`;

    const res = await httpPost(url, {
        'Authorization': `Token ${key}`,
        'Content-Type': 'audio/webm;codecs=opus',
        'Content-Length': Buffer.byteLength(audioBuffer),
    }, audioBuffer);

    let data;
    try {
        data = JSON.parse(res.body);
    } catch {
        throw new Error('Deepgram returned invalid JSON');
    }

    const alt = data?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alt?.transcript || '';
    return transcript;
}

// ─── IPC handlers ────────────────────────────────────────────

ipcMain.handle('renderer-ready', () => {
    // Ne cacher la fenêtre QUE si on n'est pas en train d'enregistrer.
    // Sinon, le renderer qui finit de charger pendant un enregistrement
    // masquerait la pill alors qu'elle devrait être visible.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !isRecordingActive) {
        mainWindow.hide();
    }
});

ipcMain.handle('log-error', (_, msg) => {
    fs.appendFileSync(getLogFile(), msg + '\n');
    return true;
});

// ─── Whisper STT (direct call from main, no backend hop) ────
// Posts the WebM buffer straight to the Whisper API (modern faster-whisper
// or OpenAI-compatible service). Same pattern as callDeepgram — eliminates
// the previous Express round-trip on localhost:3001 and removes the open-proxy
// SSRF surface that came with the X-Whisper-URL header relay.
async function callWhisperDirect(audioBuffer, language, whisperUrl, apiKey) {
    if (!whisperUrl) {
        throw new Error('Whisper URL non configurée — ajoutez-la dans Paramètres > Avancé');
    }
    // Strip trailing /transcribe if user pasted the full endpoint URL
    const base = whisperUrl.replace(/\/transcribe\/?$/, '');

    // Manual multipart body — field name 'file' matches modern faster-whisper
    // APIs (and the secured deployment described in the user's API doc).
    const boundary = '----VoixifyBoundary' + Date.now() + Math.random().toString(36).slice(2);
    const filename = 'audio.webm';
    const mimeType = 'audio/webm';

    const parts = [];
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    if (language && language !== 'auto') {
        parts.push(Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}`
        ));
    }
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // Cold start on large-v3 can take 30-60s. We give it 90s here; the renderer
    // wraps the whole IPC call in its own 120s ceiling so the UI never hangs.
    const res = await httpPost(`${base}/transcribe`, headers, body, 90_000);

    let data;
    try {
        data = JSON.parse(res.body);
    } catch {
        throw new Error('Whisper returned invalid JSON');
    }
    // Normalize: 'transcription' (faster-whisper legacy), 'text' (OpenAI-compat),
    // 'result' (some forks). All are equivalent.
    return data.text || data.transcription || data.result || '';
}

ipcMain.handle('process-audio', async (_, payload) => {
    if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'Payload invalide' };
    }
    if (processingAudio) {
        return { success: false, error: 'Déjà en cours de traitement' };
    }

    const { audio, lang, deepgramModel, deepgramApiKey, whisperApiKey, transcriptionSource, whisperUrl } = payload;

    // Audio is a Uint8Array (preferred) or Buffer over IPC structured clone.
    // Reject anything else early so we don't pay a Buffer.from() on garbage.
    if (!(audio instanceof Uint8Array) && !Buffer.isBuffer(audio)) {
        return { success: false, error: 'Audio absent ou format invalide' };
    }

    processingAudio = true;
    startWatchdog();

    // Settings: prefer renderer payload (Zustand), fall back to mainSettings.
    // Lang is validated against an allowlist so a malformed payload can't slip
    // arbitrary strings into the Deepgram/Whisper API URL.
    const src = transcriptionSource === 'whisper' ? 'whisper' : 'deepgram';
    const language = ALLOWED_LANGS.has(lang) ? lang : (mainSettings.lang || 'auto');
    const dgModel = (typeof deepgramModel === 'string' && deepgramModel) || mainSettings.deepgramModel;
    const dgKey = (typeof deepgramApiKey === 'string' && deepgramApiKey) || mainSettings.deepgramApiKey;
    const wKey = (typeof whisperApiKey === 'string' && whisperApiKey) || mainSettings.whisperApiKey;

    try {
        // Pre-validate audio size before any network call — saves a round-trip on
        // mute/empty recordings and short-circuits oversized payloads.
        if (audio.byteLength < MIN_AUDIO_BYTES) {
            return { success: false, error: 'Audio trop court — réessayez en parlant plus longtemps' };
        }
        if (audio.byteLength > MAX_AUDIO_BYTES) {
            return { success: false, error: `Audio trop volumineux (${Math.round(audio.byteLength / 1e6)} MB > 50 MB)` };
        }

        const raw = Buffer.isBuffer(audio) ? audio : Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
        const webmBuffer = fixWebmBuffer(raw);
        if (!webmBuffer) {
            return { success: false, error: 'Audio invalide (en-tête WebM introuvable)' };
        }

        let transcript;
        if (src === 'whisper') {
            try {
                const wUrl = (typeof whisperUrl === 'string' && whisperUrl)
                    || mainSettings.whisperUrl
                    || process.env.WHISPER_URL
                    || 'http://127.0.0.1:9990';
                console.log('[PROCESS] Whisper →', wUrl, '(auth:', wKey ? 'yes' : 'no', ',', webmBuffer.length, 'bytes)');
                transcript = await callWhisperDirect(webmBuffer, language, wUrl, wKey);
            } catch (err) {
                const msg = err.message || '';
                if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
                    return { success: false, error: 'Whisper injoignable — vérifiez l\'URL dans Paramètres > Avancé' };
                }
                if (msg.includes('timeout')) {
                    return { success: false, error: 'Whisper timeout — le modèle peut être en cold start, réessayez dans 30s' };
                }
                if (msg.includes('401') || msg.includes('403')) {
                    return { success: false, error: 'Clé API Whisper invalide ou manquante — ajoutez-la dans Paramètres > Transcription' };
                }
                return { success: false, error: `Whisper: ${msg}` };
            }
        } else {
            try {
                transcript = await callDeepgram(webmBuffer, language, dgModel, dgKey);
            } catch (err) {
                const msg = err.message || '';
                if (msg.includes('DEEPGRAM_KEY')) {
                    return { success: false, error: 'Clé API Deepgram manquante — ajoutez-la dans Paramètres > Transcription' };
                }
                if (msg.includes('401') || msg.includes('403')) {
                    return { success: false, error: 'Clé API Deepgram invalide ou expirée' };
                }
                if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
                    return { success: false, error: 'Deepgram injoignable — vérifiez votre connexion internet' };
                }
                return { success: false, error: `Deepgram: ${msg}` };
            }
        }

        if (!transcript.trim()) return { success: false, error: 'Aucun texte capté' };

        return { success: true, transcript };
    } catch (err) {
        console.error('[PROCESS ERROR]', err.message);
        return { success: false, error: err.message };
    } finally {
        processingAudio = false;
        stopWatchdog();
    }
});

ipcMain.handle('recording-ended', () => {
    isRecordingActive = false;
    processingAudio = false;

});

// ─── Settings sync ────────────────────────────────────────────
// Settings window lives in a separate renderer process; we keep
// mainSettings as the single source of truth so process-audio
// always knows the current configuration, no matter which window
// last changed a value.
ipcMain.handle('update-settings', (_, partial) => {
    // Drop any key not on the allowlist — prevents a malformed payload from
    // injecting arbitrary fields into mainSettings (e.g. fake hotkey strings).
    const safe = pickAllowedKeys(partial, ALLOWED_SETTINGS_KEYS);
    const modeChanged = safe.hotkeyMode !== undefined
        && safe.hotkeyMode !== mainSettings.hotkeyMode;

    Object.assign(mainSettings, safe);

    // Persist to disk so settings survive full app restarts
    savePersistedSettings(mainSettings);

    // Broadcast to the Pill window so its Zustand store stays in sync.
    // (Settings window and Pill window have separate localStorage/Zustand stores)
    safeSend('settings-changed', { ...mainSettings });

    // Switching between hold / toggle needs to swap the globalShortcut handler.
    if (modeChanged) {
        console.log('[SETTINGS] hotkeyMode changed → re-registering hotkey as', mainSettings.hotkeyMode);
        registerHotkey(currentHotkey);
    }

    return true;
});

ipcMain.handle('get-settings', () => ({ ...mainSettings }));

ipcMain.handle('hide-window', () => {
    isRecordingActive = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

ipcMain.handle('copy-to-clipboard', (_, text) => {
    clipboard.writeText(text);
    return true;
});

const vbsPastePath = path.join(os.tmpdir(), 'vx_paste.vbs');
ipcMain.handle('paste-text', (_, text) => {
    clipboard.writeText(text);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    // Respect the "Collage automatique" toggle: when OFF, only copy to clipboard.
    if (!mainSettings.autopasteEnabled) {
        console.log('[PASTE] Autopaste disabled — text copied to clipboard only');
        return;
    }
    fs.writeFileSync(vbsPastePath, 'WScript.Sleep 200\r\nCreateObject("WScript.Shell").SendKeys "^v"', 'utf8');
    exec(`wscript //nologo "${vbsPastePath}"`, (err) => {
        if (err) console.error('[PASTE]', err.message);
    });
});

// Settings IPC — update hotkey from Settings window
ipcMain.handle('update-hotkey', (_, newKey, showWarning = false) => {
    try {
        const success = registerHotkey(newKey);

        if (!success) {
            if (showWarning) {
                dialog.showErrorBox(
                    'Raccourci indisponible',
                    `Le raccourci ${newKey} n'a pas pu être enregistré.\n\nIl est probablement déjà utilisé par un autre programme sur votre système Windows (ex: raccourci langue, PowerToys, AMD/Nvidia, etc).\n\nVeuillez le changer depuis les paramètres de Voixify.`
                );
            }
            return { success: false, error: 'Raccourci déjà utilisé par le système' };
        }

        // Persister le nouveau raccourci dans le fichier JSON — source de vérité
        // pour le prochain redémarrage (et pour que get-settings retourne la bonne valeur)
        mainSettings.hotkey = newKey;
        savePersistedSettings(mainSettings);
        console.log('[HOTKEY] Persisted new hotkey:', newKey);

        return { success: true };
    } catch (e) {
        console.error('[SETTINGS] Invalid hotkey:', e.message);
        return { success: false, error: e.message };
    }
});

// Settings window control
ipcMain.handle('open-settings', () => createSettingsWindow());
ipcMain.handle('close-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

// ─── Backend Manager ──────────────────────────────────────────
let backendProcess = null;
const BACKEND_PORT = process.env.BACKEND_PORT || 3001;

// Kill any orphan process occupying BACKEND_PORT (e.g. leftover from a crash)
function killOrphanBackend() {
    return new Promise((resolve) => {
        // In dev, concurrently manages the backend — never kill it here
        if (isDev) { resolve(); return; }
        if (process.platform !== 'win32') { resolve(); return; }
        // IMPORTANT: use 'cmd /c' so that pipe characters work correctly in exec() on Windows
        exec(`cmd /c "netstat -ano | findstr LISTENING | findstr :${BACKEND_PORT}"`, (err, stdout) => {
            if (err || !stdout.trim()) { resolve(); return; }
            // Parse PID from netstat output (last column)
            const lines = stdout.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
            }
            if (pids.size === 0) { resolve(); return; }
            console.log('[BACKEND] Killing orphan process(es) on port', BACKEND_PORT, ':', [...pids].join(', '));
            const kills = [...pids].map(pid =>
                new Promise(r => exec(`taskkill /PID ${pid} /T /F`, () => r()))
            );
            Promise.all(kills).then(() => {
                // Give OS 1s to fully release the port before we start a new backend
                setTimeout(resolve, 1000);
            });
        });
    });
}

function startBackend() {
    if (isDev) return; // In dev, we use concurrently via npm run dev

    // extraResources copies backend to resources/backend/ (outside ASAR)
    const backendPath = app.isPackaged
        ? path.join(process.resourcesPath, 'backend', 'server.js')
        : path.join(__dirname, '..', 'backend', 'src', 'index.js');

    if (!fs.existsSync(backendPath)) {
        console.error('[BACKEND] Backend not found at:', backendPath, '— LLM correction will not work');
        return;
    }

    try {
        backendProcess = fork(backendPath, [], {
            env: { ...process.env, NODE_ENV: 'production' },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });

        backendProcess.stdout?.on('data', (d) => console.log('[BACKEND]', d.toString().trim()));
        backendProcess.stderr?.on('data', (d) => console.error('[BACKEND ERR]', d.toString().trim()));
        backendProcess.on('error', (err) => console.error('[BACKEND] Fork error:', err.message));
        backendProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) console.error('[BACKEND] Exited with code', code);
            backendProcess = null;
        });

        console.log('[BACKEND] Started (PID:', backendProcess.pid, ')');
    } catch (err) {
        console.error('[BACKEND] Failed to start:', err.message);
    }
}

function stopBackend() {
    return new Promise((resolve) => {
        if (!backendProcess) { resolve(); return; }

        const pid = backendProcess.pid;
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; backendProcess = null; resolve(); } };

        // 1) Ask the backend to shut down gracefully via IPC
        try {
            backendProcess.send('shutdown');
        } catch (_) { /* process may already be dead */ }

        // 2) Listen for clean exit
        backendProcess.once('exit', done);

        // 3) Timeout: force-kill after 2s if still alive
        setTimeout(() => {
            if (resolved) return;
            console.log('[BACKEND] Graceful shutdown timed out — force-killing PID', pid);
            if (process.platform === 'win32') {
                // cmd /c required for pipes/builtins in exec() on Windows
                exec(`cmd /c "taskkill /PID ${pid} /T /F"`, (err) => {
                    if (err) console.error('[BACKEND] taskkill error:', err.message);
                    done();
                });
            } else {
                try { backendProcess.kill('SIGKILL'); } catch (_) { }
                done();
            }
        }, 2000);
    });
}

// ─── Last-resort sync kill on brutal process termination ─────
// If Electron is killed via Task Manager or crashes, 'will-quit' never fires.
// process.on('exit') is the only hook that runs synchronously in that case.
// We use execFileSync (no shell needed) to kill the backend tree immediately.
process.on('exit', () => {
    if (backendProcess && backendProcess.pid) {
        try {
            const { execFileSync } = require('child_process');
            execFileSync('taskkill', ['/PID', String(backendProcess.pid), '/T', '/F'],
                { stdio: 'ignore', timeout: 2000 });
        } catch (_) { /* best effort */ }
    }
});

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(async () => {
    // Kill any orphan backend from a previous crash before starting a new one
    await killOrphanBackend();
    startBackend();
    createWindow();
    createTray();
    // ─── Register hotkey ──────────────────────────────────────────
    // On utilise le raccourci persisté dans settings.json (chargé dans currentHotkey).
    // Le single-instance lock garantit qu'aucune instance précédente ne bloque le raccourci.
    // On ne fait plus de fallback automatique : si le raccourci échoue (ex: conflit système),
    // l'utilisateur doit le changer manuellement dans les Paramètres.
    const hotkeySuccess = registerHotkey(currentHotkey);
    if (!hotkeySuccess) {
        console.error('[STARTUP] Hotkey registration failed for:', currentHotkey,
            '— probablement un conflit système. Merci de changer le raccourci dans les Paramètres.');
        // Ne PAS écraser le raccourci sauvegardé avec un fallback silencieux.
        // L'utilisateur verra que le raccourci ne fonctionne pas et pourra le changer.
    } else {
        console.log('[STARTUP] Hotkey registered:', currentHotkey);
        // S'assurer que mainSettings.hotkey est bien synchronisé
        mainSettings.hotkey = currentHotkey;
    }

    // ─── Power events: re-register hotkey after sleep/lock ────────
    // Windows can silently invalidate globalShortcut registrations
    // when the system resumes from sleep or the screen is unlocked.
    powerMonitor.on('resume', () => {
        console.log('[POWER] System resumed — re-registering hotkey in 2s');
        setTimeout(() => ensureHotkeyRegistered(), 2000);
    });
    powerMonitor.on('unlock-screen', () => {
        console.log('[POWER] Screen unlocked — re-registering hotkey in 1s');
        setTimeout(() => ensureHotkeyRegistered(), 1000);
    });

    // ─── Heartbeat: fast for first 60s, then every 30s ───────────
    // Fast heartbeat catches hotkeys silently lost during startup
    let heartbeatCount = 0;
    fastHeartbeatRef = setInterval(() => {
        heartbeatCount++;
        const isRegistered = globalShortcut.isRegistered(currentHotkey);
        console.log(`[HEARTBEAT] #${heartbeatCount} isRegistered=${isRegistered} key=${currentHotkey}`);
        if (!isRegistered) {
            console.log('[HEARTBEAT] Hotkey lost — re-registering');
            ensureHotkeyRegistered();
        }
        // Switch to slower heartbeat after 60s (12 × 5s)
        if (heartbeatCount >= 12) {
            clearInterval(fastHeartbeatRef);
            fastHeartbeatRef = null;
            slowHeartbeatRef = setInterval(() => {
                if (!globalShortcut.isRegistered(currentHotkey)) {
                    console.log('[HEARTBEAT] Hotkey lost — re-registering');
                    ensureHotkeyRegistered();
                }
            }, 30000);
        }
    }, 5000);

    // ─── Second instance: focus existing window ───────────────
    app.on('second-instance', () => {
        // L'utilisateur a tenté de lancer une 2ème instance — on focus notre fenêtre
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.focus();
        } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.showInactive();
        }
    });
});

app.on('window-all-closed', () => {
    // Intentionally empty — prevent default quit behavior (tray app)
});

function onWillQuit(e) {
    // Prevent default quit so we can do async cleanup
    e.preventDefault();

    // ① Libérer les raccourcis en PREMIER et de façon SYNCHRONE
    //    → garantit que Windows libère le binding avant toute autre opération async.
    //    Sur Windows, ne pas le faire avant un await laisse le raccourci "verrouillé"
    //    pour la prochaine instance.
    globalShortcut.unregisterAll();
    console.log('[QUIT] globalShortcut.unregisterAll() done');

    // ② Stopper les heartbeats et le watchdog
    if (fastHeartbeatRef) { clearInterval(fastHeartbeatRef); fastHeartbeatRef = null; }
    if (slowHeartbeatRef) { clearInterval(slowHeartbeatRef); slowHeartbeatRef = null; }
    stopWatchdog();

    // ③ Flush remaining log buffer synchronously so we don't lose final logs
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (logBuffer) {
        try { fs.appendFileSync(getLogFile(), logBuffer, 'utf8'); logBuffer = ''; } catch (_) { }
    }

    // ④ Cleanup async (backend + fichiers temporaires), puis quit final
    (async () => {
        await stopBackend();
        try {
            if (fs.existsSync(vbsPastePath)) fs.unlinkSync(vbsPastePath);
        } catch (_) { /* best effort */ }

        // Quitter définitivement — on désactive le listener pour éviter la boucle infinie
        app.off('will-quit', onWillQuit);
        app.quit();
    })();
}
app.on('will-quit', onWillQuit);
