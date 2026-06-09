import * as pdfjsLib from 'pdfjs-dist';
// Import the worker file content as a raw string. Vite bundles it inline
// so we can construct a Blob URL at runtime. This avoids Chromium's
// restriction on loading ES module workers from `file://` origins
// (which was causing PDF rendering to hang silently in packaged builds).
import pdfjsWorkerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

const workerBlob = new Blob([pdfjsWorkerSource], {
  type: 'application/javascript',
});
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export { pdfjsLib };
export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;
