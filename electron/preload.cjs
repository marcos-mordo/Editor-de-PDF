// Hand-written CommonJS preload script.
// IMPORTANT: This file is NOT bundled by Vite. It must remain valid CJS so
// that Electron can load it via require() in the renderer's preload phase.
// Any ESM syntax (import/export) here will break window.api at runtime.

const { contextBridge, ipcRenderer } = require('electron');

// Log to a file we can inspect after a crash. Optional - only writes if FS works.
function tryLog(line) {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const logDir = path.join(os.homedir(), '.editor-de-pdf');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'preload.log'),
      `[${new Date().toISOString()}] ${line}\n`,
    );
  } catch (_) {
    /* noop */
  }
}

tryLog('preload.cjs loaded; setting up window.api bridge');

const api = {
  // File dialogs
  openPdf: (opts) => ipcRenderer.invoke('dialog:open-pdf', opts || {}),
  openImage: () => ipcRenderer.invoke('dialog:open-image'),
  savePdf: (defaultName, data) =>
    ipcRenderer.invoke('dialog:save-pdf', { defaultName, data }),
  saveBinary: (defaultName, data, filters) =>
    ipcRenderer.invoke('dialog:save-binary', { defaultName, data, filters }),
  saveFolder: (defaultName) =>
    ipcRenderer.invoke('dialog:save-folder', { defaultName }),
  writeFile: (filePath, data) =>
    ipcRenderer.invoke('fs:write-file', { filePath, data }),

  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),

  // Menu events
  onMenuEvent: (channel, callback) => {
    const handler = () => callback();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Diagnostics
  _diagnostics: () => ({
    preloadLoaded: true,
    timestamp: Date.now(),
    process: {
      versions: process.versions,
      platform: process.platform,
      arch: process.arch,
    },
  }),
};

try {
  contextBridge.exposeInMainWorld('api', api);
  tryLog('window.api bridge exposed successfully');
} catch (err) {
  tryLog('Failed to expose window.api: ' + (err && err.message ? err.message : err));
  throw err;
}
