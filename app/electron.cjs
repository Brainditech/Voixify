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
// In dev, .env is at ../../.env relative to app/electron.cjs
// In production (packaged), fall back to the app directory
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

// Deepgram key MUST come from environment — never hardcode API keys
const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
if (!DEEPGRAM_KEY) {
    console.error('[FATAL] DEEPGRAM_KEY is not set in .env — Voixify cannot transcribe without it.');
    // Don't exit immediately — let the app start so the user sees the tray icon
}

// ─── WebM repair ────────────────────────────────────────────
// Chromium live WebM has EBML header at a non-zero offset; strip leading garbage.
// Returns null if no valid EBML header found.
function fixWebmBuffer(buf) {
    // We read 4 bytes (i, i+1, i+2, i+3), so stop at buf.length - 4
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
let tray = null;
let currentHotkey = 'CommandOrControl+Space';
let isRecordingActive = false;
let processingAudio = false;

// ─── Safe IPC send ───────────────────────────────────────────
// Guards against sending to a destroyed window (race condition crash)
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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            // webSecurity: true (default) — never disable same-origin policy
        },
    });

    if (isDev) mainWindow.loadURL('http://localhost:5173');
    else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

    mainWindow.on('closed', () => { mainWindow = null; });
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
// Hold the shortcut key to record, release to stop and paste.
// Detection: keyboard repeat events fire while key is held;
// when repeats stop, we know the key was released.
// IMPORTANT: Windows keyboard repeat initial delay is 250–1000ms (default ~500ms).
// We use a longer timeout for the first keydown, then a shorter one once repeats arrive.
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
            // First keydown — start recording
            isRecordingActive = true;
            showPill();
        }

        // Adaptive timeout:
        // - First press: 800ms (must survive Windows keyboard repeat initial delay)
        // - After repeat detected: 300ms for responsive release detection
        const timeout = repeatCount <= 1 ? 800 : 300;

        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
            // No more repeat events → key released
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
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAc0lEQVQ4jWNgYGD4z0A+YGRgYGBiIFMzIwMDAwsDmZoZGBgYWBjI1MzAwMDAwkCmZgYGBgYWBjI1MzAwMLAwkKmZgYGBgYWBTM0MDAwMLAxkamZgYGBgYSBTMwMDAwMLI5maGRgYGFgYyNTMwMDAAACGGwqFr4Nf+QAAAABJRU5ErkJggg=='
    );
    tray = new Tray(icon);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '🎙 Voixify', enabled: false },
        { type: 'separator' },
        { label: 'Quitter', click: () => app.quit() },
    ]));
    tray.setToolTip(`Voixify — ${currentHotkey}`);
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

// Renderer signals it is fully mounted — hide window if still visible from load flash
ipcMain.handle('renderer-ready', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
    }
    console.log('[MAIN] Renderer ready');
});

ipcMain.handle('process-audio', async (_, { audioBase64, lang, duration }) => {
    // Reject duplicate concurrent calls
    if (processingAudio) {
        console.log('[PROCESS] Skipping — already processing');
        return { success: false, error: 'Already processing' };
    }
    processingAudio = true;

    try {
        // No minimum duration check — even short phrases should be transcribed
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

        // Save audio to disk (best-effort, don't fail the whole request if disk write fails)
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

// Renderer signals the recording→processing cycle is fully done (success or failure)
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

// Paste: write clipboard, hide window, then let WScript send Ctrl+V to the foreground app
const vbsPastePath = path.join(os.tmpdir(), 'vx_paste.vbs');
ipcMain.handle('paste-text', (_, text) => {
    clipboard.writeText(text);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    // 200ms sleep inside VBS lets Windows restore focus to the previous app
    fs.writeFileSync(vbsPastePath, 'WScript.Sleep 200\r\nCreateObject("WScript.Shell").SendKeys "^v"', 'utf8');
    exec(`wscript //nologo "${vbsPastePath}"`, (err) => {
        if (err) console.error('[PASTE]', err.message);
    });
});

// ─── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    createTray();
    registerHotkey('CommandOrControl+Space');
    console.log('🎙 Voixify ready — hold Ctrl+Space to dictate');
});

// Keep the app alive when all windows are closed (tray app behavior)
app.on('window-all-closed', () => {
    // Intentionally empty — prevent default quit behavior
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // Clean up temporary VBS paste script
    try {
        if (fs.existsSync(vbsPastePath)) {
            fs.unlinkSync(vbsPastePath);
            console.log('[CLEANUP] Removed temp VBS file');
        }
    } catch (e) {
        // Best effort — don't crash on cleanup failure
    }
});
