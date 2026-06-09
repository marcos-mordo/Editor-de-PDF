import { ipcMain as o, app as c, BrowserWindow as b, shell as P, Menu as d, dialog as u } from "electron";
import a from "node:path";
import p from "node:fs/promises";
import { fileURLToPath as C } from "node:url";
const h = a.dirname(C(import.meta.url));
process.env.APP_ROOT = a.join(h, "..");
const f = process.env.VITE_DEV_SERVER_URL, E = a.join(process.env.APP_ROOT, "dist-electron"), m = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = f ? a.join(process.env.APP_ROOT, "public") : m;
let e = null;
function g() {
  e = new b({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Editor de PDF",
    backgroundColor: "#0f172a",
    show: !1,
    webPreferences: {
      preload: a.join(h, "preload.cjs"),
      contextIsolation: !0,
      nodeIntegration: !1,
      sandbox: !1,
      webSecurity: !0
    }
  }), e.once("ready-to-show", () => {
    e == null || e.show();
  }), f ? (e.loadURL(f), e.webContents.openDevTools()) : e.loadFile(a.join(m, "index.html")), e.webContents.setWindowOpenHandler(({ url: r }) => (P.openExternal(r), { action: "deny" })), e.on("closed", () => {
    e = null;
  }), y();
}
function y() {
  const r = process.platform === "darwin", l = [
    ...r ? [
      {
        label: c.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    {
      label: "Archivo",
      submenu: [
        {
          label: "Abrir PDF...",
          accelerator: "CmdOrCtrl+O",
          click: () => e == null ? void 0 : e.webContents.send("menu:open-pdf")
        },
        {
          label: "Guardar",
          accelerator: "CmdOrCtrl+S",
          click: () => e == null ? void 0 : e.webContents.send("menu:save")
        },
        {
          label: "Guardar como...",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => e == null ? void 0 : e.webContents.send("menu:save-as")
        },
        { type: "separator" },
        {
          label: "Combinar PDFs...",
          click: () => e == null ? void 0 : e.webContents.send("menu:merge")
        },
        {
          label: "Dividir PDF...",
          click: () => e == null ? void 0 : e.webContents.send("menu:split")
        },
        { type: "separator" },
        r ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "Edición",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Ver",
      submenu: [
        {
          label: "Acercar",
          accelerator: "CmdOrCtrl+=",
          click: () => e == null ? void 0 : e.webContents.send("menu:zoom-in")
        },
        {
          label: "Alejar",
          accelerator: "CmdOrCtrl+-",
          click: () => e == null ? void 0 : e.webContents.send("menu:zoom-out")
        },
        {
          label: "Ajustar al ancho",
          accelerator: "CmdOrCtrl+0",
          click: () => e == null ? void 0 : e.webContents.send("menu:zoom-fit")
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" }
      ]
    },
    {
      label: "Herramientas",
      submenu: [
        {
          label: "OCR (reconocer texto)",
          click: () => e == null ? void 0 : e.webContents.send("menu:ocr")
        },
        {
          label: "Marca de agua...",
          click: () => e == null ? void 0 : e.webContents.send("menu:watermark")
        },
        {
          label: "Proteger con contraseña...",
          click: () => e == null ? void 0 : e.webContents.send("menu:encrypt")
        },
        { type: "separator" },
        {
          label: "Exportar a imágenes",
          click: () => e == null ? void 0 : e.webContents.send("menu:export-images")
        },
        {
          label: "Exportar a Word",
          click: () => e == null ? void 0 : e.webContents.send("menu:export-word")
        },
        {
          label: "Exportar a Excel",
          click: () => e == null ? void 0 : e.webContents.send("menu:export-excel")
        }
      ]
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Acerca de Editor de PDF",
          click: () => e == null ? void 0 : e.webContents.send("menu:about")
        }
      ]
    }
  ], t = d.buildFromTemplate(l);
  d.setApplicationMenu(t);
}
o.handle("dialog:open-pdf", async (r, l = {}) => {
  if (!e) return null;
  const t = await u.showOpenDialog(e, {
    title: "Abrir PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: l.multi ? ["openFile", "multiSelections"] : ["openFile"]
  });
  return t.canceled ? null : await Promise.all(
    t.filePaths.map(async (n) => {
      const i = await p.readFile(n);
      return {
        path: n,
        name: a.basename(n),
        size: i.byteLength,
        data: i.buffer.slice(i.byteOffset, i.byteOffset + i.byteLength)
      };
    })
  );
});
o.handle("dialog:open-image", async () => {
  if (!e) return null;
  const r = await u.showOpenDialog(e, {
    title: "Abrir imagen",
    filters: [
      { name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }
    ],
    properties: ["openFile"]
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  const l = r.filePaths[0], t = await p.readFile(l);
  return {
    path: l,
    name: a.basename(l),
    data: t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength)
  };
});
o.handle(
  "dialog:save-pdf",
  async (r, { defaultName: l, data: t }) => {
    if (!e) return null;
    const s = await u.showSaveDialog(e, {
      title: "Guardar PDF",
      defaultPath: l,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    return s.canceled || !s.filePath ? null : (await p.writeFile(s.filePath, Buffer.from(t)), s.filePath);
  }
);
o.handle(
  "dialog:save-binary",
  async (r, {
    defaultName: l,
    data: t,
    filters: s
  }) => {
    if (!e) return null;
    const n = await u.showSaveDialog(e, {
      title: "Guardar archivo",
      defaultPath: l,
      filters: s ?? [{ name: "Todos", extensions: ["*"] }]
    });
    return n.canceled || !n.filePath ? null : (await p.writeFile(n.filePath, Buffer.from(t)), n.filePath);
  }
);
o.handle(
  "dialog:save-folder",
  async (r, { defaultName: l }) => {
    if (!e) return null;
    const t = await u.showOpenDialog(e, {
      title: "Seleccionar carpeta de destino",
      defaultPath: l,
      properties: ["openDirectory", "createDirectory"]
    });
    return t.canceled || t.filePaths.length === 0 ? null : t.filePaths[0];
  }
);
o.handle(
  "fs:write-file",
  async (r, { filePath: l, data: t }) => (await p.writeFile(l, Buffer.from(t)), !0)
);
o.handle("app:get-version", () => c.getVersion());
o.handle("app:get-platform", () => process.platform);
c.whenReady().then(g);
c.on("window-all-closed", () => {
  process.platform !== "darwin" && c.quit();
});
c.on("activate", () => {
  b.getAllWindows().length === 0 && g();
});
export {
  E as MAIN_DIST,
  m as RENDERER_DIST,
  f as VITE_DEV_SERVER_URL
};
