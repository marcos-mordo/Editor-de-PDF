import { create } from 'zustand';
import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { pdfjsLib } from '../lib/pdfjs';
import { generateId, toArrayBuffer } from '../lib/utils';
import { editTextInPage } from '../features/textedit/engine';
import { pickStandardFont } from '../features/textedit/font-match';

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
}

export const useDocument = create<DocumentState>((set, get) => ({
  doc: null,
  currentPage: 1,
  zoom: 1.5,
  loading: false,

  loadFromBytes: async (bytes, name, filePath) => {
    set({ loading: true });
    try {
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
}));
