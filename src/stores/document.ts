import { create } from 'zustand';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { pdfjsLib } from '../lib/pdfjs';
import { generateId, toArrayBuffer } from '../lib/utils';
import { editTextInPage } from '../features/textedit/engine';
import { pickStandardFont } from '../features/textedit/font-match';

export type WorkingPdfMutator = (pdf: PDFDocument) => void | Promise<void>;

export interface PdfDoc {
  id: string;
  name: string;
  filePath?: string;
  originalBytes: ArrayBuffer;
  workingBytes: ArrayBuffer;
  proxy: PDFDocumentProxy;
  numPages: number;
  /** Visible pages in display order. Numbers are 1-based original page numbers. */
  pagesOrder: number[];
  /** Rotation in degrees per original page number (0, 90, 180, 270). */
  pageRotations: Record<number, number>;
  isDirty: boolean;
}

interface DocumentState {
  doc: PdfDoc | null;
  currentPage: number;
  zoom: number;
  loading: boolean;
  /** Size of the scrollable viewer area in CSS px (set by PdfViewer). */
  viewerSize: { w: number; h: number };
  setViewerSize: (w: number, h: number) => void;
  fitWidth: () => Promise<void>;
  fitPage: () => Promise<void>;
  loadFromBytes: (
    bytes: ArrayBuffer,
    name: string,
    filePath?: string,
  ) => Promise<void>;
  close: () => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  rotatePage: (originalPageNumber: number, delta: number) => void;
  rotateAll: (delta: number) => void;
  reorderPages: (newOrder: number[]) => void;
  deletePages: (originalPageNumbers: number[]) => void;
  markDirty: () => void;
  setWorkingBytes: (bytes: ArrayBuffer) => Promise<void>;
  /** Reload the PDF.js proxy from new bytes WITHOUT resetting page order/rotations. */
  reloadProxy: (bytes: ArrayBuffer) => Promise<void>;
  /**
   * Edit existing PDF text in place by rewriting the page content stream.
   * No overlay, no cover — the original glyphs are re-encoded (same font) or
   * removed and repainted with a weight-matched font. Re-renders on success.
   */
  applyTextEdit: (
    originalPageNumber: number,
    oldText: string,
    newText: string,
    pos: { x: number; y: number; size: number; fontFamily: string },
  ) => Promise<boolean>;
  /**
   * Loads the working PDF, lets a callback mutate it (crop, metadata, etc.),
   * saves and re-renders — WITHOUT resetting the user's page order/rotations.
   */
  applyToWorkingPdf: (mutator: WorkingPdfMutator) => Promise<boolean>;
}

/**
 * Detects whether the bytes are an encrypted PDF and, if so, prompts the user
 * for the password (retrying on mistakes) and returns the decrypted bytes.
 * Returns the original bytes when not encrypted, or null when the user cancels.
 */
async function maybeDecryptOnOpen(
  bytes: ArrayBuffer,
): Promise<ArrayBuffer | null> {
  try {
    const { decryptPdf } = await import('../features/security/pdf-decrypt');
    const u8 = new Uint8Array(bytes);
    // Try with an empty password first (covers unencrypted + empty-password docs).
    let res = await decryptPdf(u8, '');
    if (!res.encrypted) return bytes;
    if (res.ok && res.bytes) return toArrayBuffer(res.bytes);

    const { showPrompt } = await import('../components/Modal/prompt');
    const toast = (await import('react-hot-toast')).default;
    for (let attempt = 0; attempt < 6; attempt++) {
      const pw = await showPrompt({
        title: '🔒 PDF protegido',
        message:
          attempt === 0
            ? 'Este documento está cifrado. Introduce la contraseña para abrirlo.'
            : 'Contraseña incorrecta. Inténtalo de nuevo.',
        placeholder: 'Contraseña',
        password: true,
        okLabel: 'Abrir',
      });
      if (pw === null) return null; // cancelled
      res = await decryptPdf(u8, pw);
      if (res.ok && res.bytes) {
        toast.success('PDF desbloqueado');
        return toArrayBuffer(res.bytes);
      }
      if (res.reason && !res.needsPassword) {
        toast.error(res.reason);
        return null;
      }
    }
    toast.error('Demasiados intentos. Cancelado.');
    return null;
  } catch (e) {
    console.error('decrypt-on-open failed', e);
    // Fall through and let the normal load attempt proceed.
    return bytes;
  }
}

export const useDocument = create<DocumentState>((set, get) => ({
  doc: null,
  currentPage: 1,
  zoom: 1.5,
  loading: false,
  viewerSize: { w: 0, h: 0 },

  setViewerSize: (w, h) => set({ viewerSize: { w, h } }),

  fitWidth: async () => {
    const { doc, currentPage, viewerSize } = get();
    if (!doc || viewerSize.w <= 0) return;
    const origPage = doc.pagesOrder[currentPage - 1] ?? doc.pagesOrder[0];
    const page = await doc.proxy.getPage(origPage);
    const rot = doc.pageRotations[origPage] ?? 0;
    const vp = page.getViewport({ scale: 1, rotation: rot });
    const padding = 48; // matches viewer px-4 + scrollbar
    const z = (viewerSize.w - padding) / vp.width;
    set({ zoom: Math.max(0.25, Math.min(5, z)) });
  },

  fitPage: async () => {
    const { doc, currentPage, viewerSize } = get();
    if (!doc || viewerSize.w <= 0 || viewerSize.h <= 0) return;
    const origPage = doc.pagesOrder[currentPage - 1] ?? doc.pagesOrder[0];
    const page = await doc.proxy.getPage(origPage);
    const rot = doc.pageRotations[origPage] ?? 0;
    const vp = page.getViewport({ scale: 1, rotation: rot });
    const zW = (viewerSize.w - 48) / vp.width;
    const zH = (viewerSize.h - 60) / vp.height;
    set({ zoom: Math.max(0.25, Math.min(5, Math.min(zW, zH))) });
  },

  loadFromBytes: async (bytes, name, filePath) => {
    set({ loading: true });
    try {
      // If the PDF is password-protected, prompt and decrypt before loading so
      // it can be both viewed AND edited as a normal document.
      const ready = await maybeDecryptOnOpen(bytes);
      if (ready === null) {
        // User cancelled the password prompt.
        set({ loading: false });
        return;
      }
      bytes = ready;

      // Clone so pdf.js doesn't detach our buffer
      const clone = bytes.slice(0);
      const proxy = await pdfjsLib.getDocument({ data: clone }).promise;
      const numPages = proxy.numPages;
      const pagesOrder = Array.from({ length: numPages }, (_, i) => i + 1);
      const pageRotations: Record<number, number> = {};
      for (const p of pagesOrder) pageRotations[p] = 0;

      // Close any previous doc
      const prev = get().doc;
      if (prev) await prev.proxy.destroy();

      // Lazy-import history to avoid circular dep; reset annotations + history
      const { useAnnotations } = await import('./annotations');
      const { useHistory } = await import('./history');
      useAnnotations.setState({ byPage: {}, selectedId: null });
      useHistory.setState({ past: [], future: [] });

      // Save to recent files list
      if (filePath) {
        try {
          const { useRecent } = await import('./recent');
          useRecent.getState().add(filePath, name);
        } catch {
          /* noop */
        }
      }

      set({
        doc: {
          id: generateId(),
          name,
          filePath,
          originalBytes: bytes,
          workingBytes: bytes,
          proxy,
          numPages,
          pagesOrder,
          pageRotations,
          isDirty: false,
        },
        currentPage: 1,
        zoom: 1.5,
        loading: false,
      });
    } catch (e) {
      console.error('Failed to load PDF', e);
      set({ loading: false });
      throw e;
    }
  },

  close: () => {
    const { doc } = get();
    if (doc) doc.proxy.destroy();
    import('./annotations').then(({ useAnnotations }) =>
      useAnnotations.setState({ byPage: {}, selectedId: null }),
    );
    import('./history').then(({ useHistory }) =>
      useHistory.setState({ past: [], future: [] }),
    );
    set({ doc: null, currentPage: 1, zoom: 1.5 });
  },

  setCurrentPage: (page) => {
    const { doc } = get();
    if (!doc) return;
    const clamped = Math.max(1, Math.min(doc.pagesOrder.length, page));
    set({ currentPage: clamped });
  },

  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(5, zoom)) }),
  zoomIn: () => set((s) => ({ zoom: Math.min(5, s.zoom * 1.25) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.25, s.zoom / 1.25) })),
  zoomFit: () => set({ zoom: 1.5 }),

  rotatePage: (pageNumber, delta) => {
    const { doc } = get();
    if (!doc) return;
    const current = doc.pageRotations[pageNumber] ?? 0;
    const next = ((current + delta) % 360 + 360) % 360;
    set({
      doc: {
        ...doc,
        pageRotations: { ...doc.pageRotations, [pageNumber]: next },
        isDirty: true,
      },
    });
  },

  rotateAll: (delta) => {
    const { doc } = get();
    if (!doc) return;
    const rotations: Record<number, number> = {};
    for (const p of doc.pagesOrder) {
      const cur = doc.pageRotations[p] ?? 0;
      rotations[p] = ((cur + delta) % 360 + 360) % 360;
    }
    set({ doc: { ...doc, pageRotations: rotations, isDirty: true } });
  },

  reorderPages: (newOrder) => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: { ...doc, pagesOrder: newOrder, isDirty: true } });
  },

  deletePages: (toDelete) => {
    const { doc } = get();
    if (!doc) return;
    const toDeleteSet = new Set(toDelete);
    const newOrder = doc.pagesOrder.filter((p) => !toDeleteSet.has(p));
    if (newOrder.length === 0) return;
    set({ doc: { ...doc, pagesOrder: newOrder, isDirty: true } });
  },

  markDirty: () => {
    const { doc } = get();
    if (!doc) return;
    set({ doc: { ...doc, isDirty: true } });
  },

  setWorkingBytes: async (bytes) => {
    const { doc } = get();
    if (!doc) return;
    const clone = bytes.slice(0);
    const newProxy = await pdfjsLib.getDocument({ data: clone }).promise;
    await doc.proxy.destroy();
    const numPages = newProxy.numPages;
    const pagesOrder = Array.from({ length: numPages }, (_, i) => i + 1);
    const pageRotations: Record<number, number> = {};
    for (const p of pagesOrder) pageRotations[p] = 0;
    set({
      doc: {
        ...doc,
        workingBytes: bytes,
        originalBytes: bytes,
        proxy: newProxy,
        numPages,
        pagesOrder,
        pageRotations,
        isDirty: false,
      },
    });
  },

  reloadProxy: async (bytes) => {
    const { doc } = get();
    if (!doc) return;
    const clone = bytes.slice(0);
    const newProxy = await pdfjsLib.getDocument({ data: clone }).promise;
    const oldProxy = doc.proxy;
    set({
      doc: { ...doc, workingBytes: bytes, proxy: newProxy, isDirty: true },
    });
    try {
      await oldProxy.destroy();
    } catch {
      /* noop */
    }
  },

  applyTextEdit: async (originalPageNumber, oldText, newText, pos) => {
    const { doc } = get();
    if (!doc) return false;
    if (!originalPageNumber) return false;
    try {
      const pdfDoc = await PDFDocument.load(doc.workingBytes.slice(0), {
        ignoreEncryption: true,
      });
      const pageIndex = originalPageNumber - 1;
      const result = await editTextInPage(
        pdfDoc,
        pageIndex,
        oldText,
        newText,
        { x: pos.x, y: pos.y },
      );
      if (!result.success) return false;

      if (result.mode === 'redraw' && newText.trim() !== '') {
        const font = await pdfDoc.embedFont(pickStandardFont(pos.fontFamily));
        const page = pdfDoc.getPage(pageIndex);
        const c = result.color ?? { r: 0, g: 0, b: 0 };
        page.drawText(newText, {
          x: pos.x,
          y: pos.y,
          size: pos.size,
          font,
          color: rgb(c.r, c.g, c.b),
        });
      }

      const saved = await pdfDoc.save();
      const ab = toArrayBuffer(saved);
      await get().reloadProxy(ab);
      return true;
    } catch (e) {
      console.error('applyTextEdit failed', e);
      return false;
    }
  },

  applyToWorkingPdf: async (mutator) => {
    const { doc } = get();
    if (!doc) return false;
    try {
      const pdfDoc = await PDFDocument.load(doc.workingBytes.slice(0), {
        ignoreEncryption: true,
      });
      await mutator(pdfDoc);
      const saved = await pdfDoc.save();
      const ab = toArrayBuffer(saved);
      await get().reloadProxy(ab);
      return true;
    } catch (e) {
      console.error('applyToWorkingPdf failed', e);
      return false;
    }
  },
}));
