const { contextBridge, ipcRenderer } = require('electron');

const originalError = console.error;
console.error = (...args) => {
    ipcRenderer.invoke('log-error', '[RENDERER ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
    originalError(...args);
};
const originalLog = console.log;
console.log = (...args) => {
    ipcRenderer.invoke('log-error', '[RENDERER LOG] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
    originalLog(...args);
};

window.addEventListener('error', (event) => {
    ipcRenderer.invoke('log-error', '[UNHANDLED ERROR] ' + event.message + ' at ' + event.filename + ':' + event.lineno);
});
window.addEventListener('unhandledrejection', (event) => {
    ipcRenderer.invoke('log-error', '[UNHANDLED REJECTION] ' + event.reason);
});
contextBridge.exposeInMainWorld('voixify', {
    // Pill lifecycle
    rendererReady: () => ipcRenderer.invoke('renderer-ready'),
    processAudio: (payload) => ipcRenderer.invoke('process-audio', payload),
    recordingEnded: () => ipcRenderer.invoke('recording-ended'),
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    pasteText: (text) => ipcRenderer.invoke('paste-text', text),
    copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

    // Settings
    openSettings: () => ipcRenderer.invoke('open-settings'),
    closeSettings: () => ipcRenderer.invoke('close-settings'),
    updateHotkey: (key, showWarning) => ipcRenderer.invoke('update-hotkey', key, showWarning),
    updateSettings: (partial) => ipcRenderer.invoke('update-settings', partial),
    getSettings: () => ipcRenderer.invoke('get-settings'),

    // Events from main → renderer
    onStateChange: (cb) => ipcRenderer.on('state-change', (_, s) => cb(s)),
    onStopRecording: (cb) => ipcRenderer.on('stop-recording', () => cb()),
    onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_, settings) => cb(settings)),
});
