const {
    app, BrowserWindow, globalShortcut, Tray, Menu,
    clipboard, ipcMain, nativeImage, screen, dialog, session
} = require('electron');
const path = require('path');
const os = require('os');
const { exec, fork } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

const logFile = path.join(os.tmpdir(), 'voixify_debug.log');
fs.appendFileSync(logFile, '\n--- MAIN PROCESS START ---\n');
const originalMainLog = console.log;
console.log = (...args) => {
    fs.appendFileSync(logFile, '[MAIN LOG] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n');
    originalMainLog(...args);
};
const originalMainError = console.error;
console.error = (...args) => {
    fs.appendFileSync(logFile, '[MAIN ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n');
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
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

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
    lang: 'fr',
    deepgramModel: 'nova-3',
    deepgramApiKey: DEEPGRAM_KEY_ENV,
    correctionLevel: 'off',
    autopasteEnabled: true,
    llmCorrectionEnabled: false,
    ollamaModel: 'kimi-k2.5:cloud',
    selectedMicId: '',
    // Override defaults with persisted settings (if any)
    ...persistedSettings,
    // Env var takes priority only if it's actually set
    ...(DEEPGRAM_KEY_ENV ? { deepgramApiKey: DEEPGRAM_KEY_ENV } : {}),
};

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
let currentHotkey = 'CommandOrControl+Space';
let isRecordingActive = false;
let processingAudio = false;

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
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

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
            preload: path.join(__dirname, 'preload.cjs'),
        },
    });

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
    mainWindow.showInactive();
    safeSend('state-change', 'recording');

}

// ─── Stop recording and hide ─────────────────────────────────
function triggerStop() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    safeSend('state-change', 'processing');
    safeSend('stop-recording');

}

// ─── Hotkey registration — hold-to-talk mode ─────────────────
let holdTimer = null;
let repeatCount = 0;

function registerHotkey(key) {
    globalShortcut.unregisterAll();
    currentHotkey = key;
    if (tray) tray.setToolTip('Voixify');

    const success = globalShortcut.register(key, () => {
        // Auto-recreate the Pill window if it was destroyed (crash, GC, etc.)
        if (!mainWindow || mainWindow.isDestroyed()) {
            console.log('[HOTKEY] Pill window missing — recreating...');
            createWindow();
            // Wait for window to be ready before showing pill
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
    });

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
function httpPost(urlStr, headers, bodyData) {
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

    const url = `https://api.deepgram.com/v1/listen?model=${model}&language=${language}&smart_format=true`;

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
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
    }
});

ipcMain.handle('log-error', (_, msg) => {
    fs.appendFileSync(logFile, msg + '\n');
    return true;
});

// ─── Whisper local (via backend proxy) ───────────────────────
// Sends the WebM buffer to the Express backend at localhost:3001,
// which forwards it to the Whisper Docker (JSON or multipart).
function callWhisperLocal(audioBuffer, language) {
    return new Promise((resolve, reject) => {
        const BACKEND_URL = 'http://127.0.0.1:3001';
        const boundary = '----VoixifyBoundary' + Date.now();
        const filename = 'audio.webm';
        const mimeType = 'audio/webm';

        // Build multipart body manually (no external deps in main process)
        const pre = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
        );
        const langField = Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="lang"\r\n\r\n${language}\r\n--${boundary}--\r\n`
        );
        const body = Buffer.concat([pre, audioBuffer, langField]);

        const urlObj = new URL(`${BACKEND_URL}/api/transcribe`);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 3001,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', d => { data += d; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json.transcript || '');
                    } else {
                        reject(new Error(`Backend ${res.statusCode}: ${json.error || data}`));
                    }
                } catch {
                    reject(new Error(`Backend invalid JSON: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(60_000, () => {
            req.destroy();
            reject(new Error('Whisper local timeout (60s)'));
        });
        req.write(body);
        req.end();
    });
}

ipcMain.handle('process-audio', async (_, { audioBase64, duration, lang, deepgramModel, deepgramApiKey, transcriptionSource }) => {
    if (processingAudio) {
        return { success: false, error: 'Déjà en cours de traitement' };
    }
    processingAudio = true;

    // Use values from the renderer payload (Zustand store = persisted source of truth).
    // Fall back to mainSettings only if payload is missing values (legacy compat).
    const src = transcriptionSource || mainSettings.transcriptionSource;
    const language = lang || mainSettings.lang;
    const dgModel = deepgramModel || mainSettings.deepgramModel;
    const dgKey = deepgramApiKey || mainSettings.deepgramApiKey;

    try {
        const raw = Buffer.from(audioBase64, 'base64');

        const webmBuffer = fixWebmBuffer(raw);
        if (!webmBuffer) {
            return { success: false, error: 'Audio invalide (trop court ou corrompu)' };
        }

        let transcript;
        if (src === 'whisper') {
            try {
                transcript = await callWhisperLocal(webmBuffer, language);
            } catch (err) {
                if (err.message?.includes('ECONNREFUSED')) {
                    return { success: false, error: 'Whisper local injoignable — vérifiez que le backend Docker est lancé' };
                }
                if (err.message?.includes('timeout')) {
                    return { success: false, error: 'Whisper local timeout (60s) — le modèle est peut-être surchargé' };
                }
                return { success: false, error: `Whisper: ${err.message}` };
            }
        } else {
            try {
                transcript = await callDeepgram(webmBuffer, language, dgModel, dgKey);
            } catch (err) {
                if (err.message?.includes('DEEPGRAM_KEY')) {
                    return { success: false, error: 'Clé API Deepgram manquante — ajoutez-la dans Paramètres > Transcription' };
                }
                if (err.message?.includes('401') || err.message?.includes('403')) {
                    return { success: false, error: 'Clé API Deepgram invalide ou expirée' };
                }
                if (err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
                    return { success: false, error: 'Deepgram injoignable — vérifiez votre connexion internet' };
                }
                return { success: false, error: `Deepgram: ${err.message}` };
            }
        }

        if (!transcript.trim()) return { success: false, error: 'Aucun texte capté' };

        return { success: true, transcript };
    } catch (err) {
        console.error('[PROCESS ERROR]', err.message);
        return { success: false, error: err.message };
    } finally {
        processingAudio = false;
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
    Object.assign(mainSettings, partial);

    // Persist to disk so settings survive full app restarts
    savePersistedSettings(mainSettings);

    // Broadcast to the Pill window so its Zustand store stays in sync.
    // (Settings window and Pill window have separate localStorage/Zustand stores)
    safeSend('settings-changed', { ...mainSettings });

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

function startBackend() {
    if (isDev) return; // In dev, we use concurrently via npm run dev

    // extraResources copies backend to resources/backend/ (outside ASAR)
    const backendPath = app.isPackaged
        ? path.join(process.resourcesPath, 'backend', 'src', 'index.js')
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
        });

        console.log('[BACKEND] Started (PID:', backendProcess.pid, ')');
    } catch (err) {
        console.error('[BACKEND] Failed to start:', err.message);
    }
}

function stopBackend() {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
}

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
    startBackend();
    createWindow();
    createTray();
    registerHotkey('CommandOrControl+Space');

});

app.on('window-all-closed', () => {
    // Intentionally empty — prevent default quit behavior (tray app)
});

app.on('will-quit', () => {
    stopBackend();
    globalShortcut.unregisterAll();
    try {
        if (fs.existsSync(vbsPastePath)) {
            fs.unlinkSync(vbsPastePath);
        }
    } catch (e) {
        // Best effort cleanup
    }
});
