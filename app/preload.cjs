const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voixify', {
    // IPC events from main → renderer (replace any previous listener)
    onStateChange: (cb) => {
        ipcRenderer.removeAllListeners('state-change');
        ipcRenderer.on('state-change', (_, state) => cb(state));
    },
    onStopRecording: (cb) => {
        ipcRenderer.removeAllListeners('stop-recording');
        ipcRenderer.on('stop-recording', cb);
    },

    // Renderer → main
    rendererReady: () => ipcRenderer.invoke('renderer-ready'),
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    copyToClipboard: (t) => ipcRenderer.invoke('copy-to-clipboard', t),
    pasteText: (t) => ipcRenderer.invoke('paste-text', t),
    processAudio: (payload) => ipcRenderer.invoke('process-audio', payload),

    // Signal that the recording→processing cycle is fully done
    recordingEnded: () => ipcRenderer.invoke('recording-ended'),
});
