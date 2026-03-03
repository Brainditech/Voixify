const {
    app, BrowserWindow, globalShortcut, Tray, Menu,
    clipboard, ipcMain, nativeImage, screen
} = require('electron');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

// ─── Load .env from project root ─────────────────────────────
const envPaths = [
    path.resolve(__dirname, '..', '..', '.env'),   // dev: project root
    path.resolve(__dirname, '..', '.env'),          // alt: one level up
    path.resolve(__dirname, '.env'),                // packaged: same dir
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        console.log(`[ENV] Loaded: ${envPath}`);
        break;
    }
}

// ─── Config ──────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PILL_W = 180;
const PILL_H = 56;
const SETTINGS_W = 500;
const SETTINGS_H = 580;

// App icon path — used for tray and settings window
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Deepgram key MUST come from environment — never hardcode API keys
const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
if (!DEEPGRAM_KEY) {
    console.error('[FATAL] DEEPGRAM_KEY is not set in .env — Voixify cannot transcribe without it.');
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
    console.warn('[ICON] icon.png not found, using placeholder');
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
    console.log('[PILL] Shown — recording');
}

// ─── Stop recording and hide ─────────────────────────────────
function triggerStop() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    safeSend('state-change', 'processing');
    safeSend('stop-recording');
    console.log('[PILL] Stop triggered');
}

// ─── Hotkey registration — hold-to-talk mode ─────────────────
let holdTimer = null;
let repeatCount = 0;

function registerHotkey(key) {
    globalShortcut.unregisterAll();
    currentHotkey = key;
    if (tray) tray.setToolTip(`Voixify — ${key}`);

    globalShortcut.register(key, () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (processingAudio) return;

        repeatCount++;

        if (repeatCount === 1) {
            isRecordingActive = true;
            showPill();
        }

        // Adaptive: 800ms on first press (> Windows repeat initial delay), 300ms after
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

    console.log(`[HOTKEY] Registered: ${key} (hold-to-talk)`);
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
    tray.setToolTip(`Voixify — ${currentHotkey}`);
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

// ─── Deepgram Nova-3 ──────────────────────────────────────────
async function callDeepgram(audioBuffer, language) {
    if (!DEEPGRAM_KEY) {
        throw new Error('DEEPGRAM_KEY not configured — add it to your .env file');
    }

    const url = `https://api.deepgram.com/v1/listen?model=nova-3&language=${language}&smart_format=true`;
    const res = await httpPost(url, {
        'Authorization': `Token ${DEEPGRAM_KEY}`,
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
    console.log('[DEEPGRAM] duration:', data?.metadata?.duration, 's | confidence:', alt?.confidence, '| chars:', transcript.length);
    if (!transcript) console.log('[DEEPGRAM] Empty response:', JSON.stringify(data).substring(0, 300));
    return transcript;
}

// ─── IPC handlers ────────────────────────────────────────────

ipcMain.handle('renderer-ready', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
    }
    console.log('[MAIN] Renderer ready');
});

ipcMain.handle('process-audio', async (_, { audioBase64, lang, duration }) => {
    if (processingAudio) {
        console.log('[PROCESS] Skipping — already processing');
        return { success: false, error: 'Already processing' };
    }
    processingAudio = true;

    try {
        console.log('[PROCESS] Duration:', duration, 'ms');

        const raw = Buffer.from(audioBase64, 'base64');
        console.log('[PROCESS] Raw buffer:', raw.length, 'bytes, first 8:', raw.slice(0, 8).toString('hex'));

        const webmBuffer = fixWebmBuffer(raw);
        if (!webmBuffer) {
            console.error('[PROCESS] No EBML header found, size:', raw.length);
            return { success: false, error: 'Audio invalide (trop court ou corrompu)' };
        }
        console.log('[PROCESS] Sending', webmBuffer.length, 'bytes to Deepgram');

        const transcript = await callDeepgram(webmBuffer, lang || 'fr');
        console.log('[PROCESS] Transcript:', transcript.substring(0, 100));
        if (!transcript.trim()) return { success: false, error: 'Aucun texte capté' };

        // Save audio (best-effort)
        let audioPath = null;
        try {
            const recordingsDir = path.join(app.getPath('userData'), 'recordings');
            fs.mkdirSync(recordingsDir, { recursive: true });
            audioPath = path.join(recordingsDir, `recording-${Date.now()}.webm`);
            fs.writeFileSync(audioPath, webmBuffer);
            console.log('[PROCESS] Audio saved:', audioPath);
        } catch (e) {
            console.warn('[PROCESS] Could not save audio:', e.message);
        }

        return { success: true, transcript, audioPath };
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
    console.log('[MAIN] Recording cycle ended — state reset');
});

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
ipcMain.handle('update-hotkey', (_, newKey) => {
    try {
        registerHotkey(newKey);
        console.log('[SETTINGS] Hotkey updated to:', newKey);
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

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    createTray();
    registerHotkey('CommandOrControl+Space');
    console.log('🎙 Voixify ready — hold Ctrl+Space to dictate');
});

app.on('window-all-closed', () => {
    // Intentionally empty — prevent default quit behavior (tray app)
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try {
        if (fs.existsSync(vbsPastePath)) {
            fs.unlinkSync(vbsPastePath);
        }
    } catch (e) {
        // Best effort cleanup
    }
});
