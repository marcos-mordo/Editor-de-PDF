import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// ============================================================
// Persistent logger — survives crashes, useful for debugging
// production builds where DevTools may be closed.
// ============================================================
const LOG_DIR = path.join(os.homedir(), '.editor-de-pdf');
const LOG_FILE = path.join(LOG_DIR, 'main.log');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* noop */
  }
  // also stdout for --enable-logging
  console.log(line.trim());
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION: ' + (err.stack || err.message || String(err)));
});
process.on('unhandledRejection', (reason: any) => {
  log('UNHANDLED REJECTION: ' + (reason?.stack || reason?.message || String(reason)));
});

log(`main starting; __dirname=${__dirname}; isPackaged=${app.isPackaged}`);
log(`APP_ROOT=${process.env.APP_ROOT}`);
log(`MAIN_DIST=${MAIN_DIST}; RENDERER_DIST=${RENDERER_DIST}`);

// Resolve preload path with fallbacks — paranoid against asar / packaged layouts.
function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.cjs'),
    path.join(MAIN_DIST, 'preload.cjs'),
    path.join(process.env.APP_ROOT!, 'dist-electron', 'preload.cjs'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        log('preload found at: ' + p);
        return p;
      }
    } catch (e) {
      log('error checking ' + p + ': ' + (e as Error).message);
    }
  }
  log('WARN: no preload.cjs found in any candidate path. Tried: ' + candidates.join(', '));
  // Return primary candidate even if missing so Electron logs the error clearly.
  return candidates[0];
}

let mainWindow: BrowserWindow | null = null;

/** Resolve the window icon — in dev, build/icon.ico; in production, extraResources. */
function resolveWindowIcon(): string {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'icon.png'),
      ]
    : [
        path.join(process.env.APP_ROOT!, 'build', 'icon.ico'),
        path.join(process.env.APP_ROOT!, 'build', 'icon.png'),
      ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        log('window icon found at: ' + p);
        return p;
      }
    } catch (e) {
      log('error checking icon ' + p + ': ' + (e as Error).message);
    }
  }
  log('WARN: no window icon found in any candidate path');
  return candidates[0];
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  const iconPath = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Editor de PDF',
    backgroundColor: '#F3F3F3',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  log('BrowserWindow created with preload=' + preloadPath);

  mainWindow.once('ready-to-show', () => {
    log('window ready-to-show');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  mainWindow.webContents.on('preload-error', (_e, preload, err) => {
    log(`PRELOAD ERROR for ${preload}: ${err.stack || err.message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  if (VITE_DEV_SERVER_URL) {
    log('loading dev URL: ' + VITE_DEV_SERVER_URL);
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(RENDERER_DIST, 'index.html');
    log('loading file: ' + indexPath + ' (exists=' + fs.existsSync(indexPath) + ')');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-pdf'),
        },
        {
          label: 'Guardar',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Guardar como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Imprimir...',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:print'),
        },
        { type: 'separator' },
        {
          label: 'Combinar PDFs...',
          click: () => mainWindow?.webContents.send('menu:merge'),
        },
        {
          label: 'Dividir PDF...',
          click: () => mainWindow?.webContents.send('menu:split'),
        },
        {
          label: 'Insertar página en blanco...',
          click: () => mainWindow?.webContents.send('menu:insert-blank'),
        },
        {
          label: 'Recortar páginas...',
          click: () => mainWindow?.webContents.send('menu:crop'),
        },
        { type: 'separator' },
        {
          label: 'Propiedades del documento...',
          click: () => mainWindow?.webContents.send('menu:properties'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        {
          label: 'Deshacer',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Rehacer',
          accelerator: 'CmdOrCtrl+Y',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
        {
          label: 'Rehacer (alternativa)',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
        { type: 'separator' },
        {
          label: 'Buscar / Reemplazar...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        {
          label: 'Acercar',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow?.webContents.send('menu:zoom-in'),
        },
        {
          label: 'Alejar',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow?.webContents.send('menu:zoom-out'),
        },
        {
          label: 'Tamaño real (100%)',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('menu:zoom-fit'),
        },
        {
          label: 'Ajustar al ancho',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:fit-width'),
        },
        {
          label: 'Ajustar a la página',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:fit-page'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Herramientas',
      submenu: [
        {
          label: 'OCR (reconocer texto)',
          click: () => mainWindow?.webContents.send('menu:ocr'),
        },
        { type: 'separator' },
        {
          label: 'Sellos (Aprobado, Confidencial...)',
          click: () => mainWindow?.webContents.send('menu:stamps'),
        },
        {
          label: 'Encabezado / Pie / Números de página',
          click: () => mainWindow?.webContents.send('menu:header-footer'),
        },
        { type: 'separator' },
        {
          label: 'Marca de agua...',
          click: () => mainWindow?.webContents.send('menu:watermark'),
        },
        {
          label: 'Quitar marca de agua...',
          click: () => mainWindow?.webContents.send('menu:remove-watermark'),
        },
        {
          label: 'Proteger con contraseña...',
          click: () => mainWindow?.webContents.send('menu:encrypt'),
        },
        {
          label: 'Reducir tamaño del PDF...',
          click: () => mainWindow?.webContents.send('menu:compress'),
        },
        { type: 'separator' },
        {
          label: 'Exportar a imágenes',
          click: () => mainWindow?.webContents.send('menu:export-images'),
        },
        {
          label: 'Exportar a Word',
          click: () => mainWindow?.webContents.send('menu:export-word'),
        },
        {
          label: 'Exportar a Excel',
          click: () => mainWindow?.webContents.send('menu:export-excel'),
        },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Preferencias...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
        {
          label: 'Atajos de teclado',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('menu:shortcuts'),
        },
        { type: 'separator' },
        {
          label: 'Acerca de Editor de PDF',
          click: () => mainWindow?.webContents.send('menu:about'),
        },
        {
          label: 'Abrir carpeta de logs',
          click: () => shell.openPath(LOG_DIR),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============================================================
// IPC HANDLERS — file system bridge
// Wrapped in safeHandle so an error in any handler is logged
// and returned as null instead of crashing the bridge.
// ============================================================

function safeHandle(channel: string, fn: (...args: any[]) => Promise<any>): void {
  ipcMain.handle(channel, async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err: any) {
      log(`IPC handler ${channel} failed: ${err.stack || err.message}`);
      return null;
    }
  });
}

safeHandle('dialog:open-pdf', async (_e, opts: { multi?: boolean } = {}) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (result.canceled) return null;
  const files = await Promise.all(
    result.filePaths.map(async (p) => {
      const data = await fsp.readFile(p);
      return {
        path: p,
        name: path.basename(p),
        size: data.byteLength,
        data: data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ),
      };
    }),
  );
  return files;
});

safeHandle('dialog:open-image', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir imagen',
    filters: [
      { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const p = result.filePaths[0];
  const data = await fsp.readFile(p);
  return {
    path: p,
    name: path.basename(p),
    data: data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ),
  };
});

safeHandle(
  'dialog:save-pdf',
  async (_e, { defaultName, data }: { defaultName: string; data: ArrayBuffer }) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, Buffer.from(data));
    return result.filePath;
  },
);

safeHandle(
  'dialog:save-binary',
  async (
    _e,
    {
      defaultName,
      data,
      filters,
    }: { defaultName: string; data: ArrayBuffer; filters?: Electron.FileFilter[] },
  ) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar archivo',
      defaultPath: defaultName,
      filters: filters ?? [{ name: 'Todos', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, Buffer.from(data));
    return result.filePath;
  },
);

safeHandle(
  'dialog:save-folder',
  async (_e, { defaultName }: { defaultName: string }) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar carpeta de destino',
      defaultPath: defaultName,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  },
);

safeHandle(
  'fs:write-file',
  async (_e, { filePath, data }: { filePath: string; data: ArrayBuffer }) => {
    await fsp.writeFile(filePath, Buffer.from(data));
    return true;
  },
);

safeHandle('fs:read-pdf', async (_e, { filePath }: { filePath: string }) => {
  try {
    const data = await fsp.readFile(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: data.byteLength,
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ),
    };
  } catch (err: any) {
    log(`fs:read-pdf failed: ${err.message}`);
    return null;
  }
});

safeHandle('app:get-version', async () => app.getVersion());
safeHandle('app:get-platform', async () => process.platform);

// ============================================================
// LIFECYCLE
// ============================================================

app
  .whenReady()
  .then(() => {
    log('app ready, creating window');
    createWindow();
  })
  .catch((err) => {
    log('app.whenReady failed: ' + (err.stack || err.message));
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
