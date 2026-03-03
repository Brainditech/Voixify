const { contextBridge, ipcRenderer } = require('electron');

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
    updateHotkey: (key) => ipcRenderer.invoke('update-hotkey', key),
    updateSettings: (partial) => ipcRenderer.invoke('update-settings', partial),
    getSettings: () => ipcRenderer.invoke('get-settings'),

    // Events from main → renderer
    onStateChange: (cb) => ipcRenderer.on('state-change', (_, s) => cb(s)),
    onStopRecording: (cb) => ipcRenderer.on('stop-recording', () => cb()),
    onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_, settings) => cb(settings)),
});
