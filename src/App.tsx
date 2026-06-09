import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useDocument } from './stores/document';
import { useTools } from './stores/tools';
import { undo, redo } from './stores/history';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ToolPalette } from './components/Toolbar/ToolPalette';
import { Sidebar } from './components/Sidebar/Sidebar';
import { PdfViewer } from './components/Viewer/PdfViewer';
import { Welcome } from './components/Welcome/Welcome';
import { openModal } from './components/Modal/modal';
import { Logo } from './components/Logo/Logo';
import { savePdfWithEdits } from './features/save/save';
import { showMergeDialog } from './features/pages/MergeDialog';
import { showSplitDialog } from './features/pages/SplitDialog';
import { showOcrDialog } from './features/ocr/OcrDialog';
import { showWatermarkDialog } from './features/security/WatermarkDialog';
import { showEncryptDialog } from './features/security/EncryptDialog';
import { exportToImages } from './features/convert/exportImages';
import { exportToWord } from './features/convert/exportWord';
import { exportToExcel } from './features/convert/exportExcel';

export default function App() {
  const doc = useDocument((s) => s.doc);
  const loading = useDocument((s) => s.loading);
  const showSidebar = useTools((s) => s.showSidebar);
  const loadFromBytes = useDocument((s) => s.loadFromBytes);
  const zoomIn = useDocument((s) => s.zoomIn);
  const zoomOut = useDocument((s) => s.zoomOut);
  const zoomFit = useDocument((s) => s.zoomFit);

  const [version, setVersion] = useState<string>('');

  // Global keyboard shortcuts for undo/redo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inForm =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      // Ctrl+Z (undo) and Ctrl+Shift+Z / Ctrl+Y (redo)
      if (e.key === 'z' || e.key === 'Z') {
        if (inForm) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (redo()) toast.success('Rehecho', { duration: 1200 });
        } else {
          if (undo()) toast.success('Deshecho', { duration: 1200 });
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        if (inForm) return;
        e.preventDefault();
        if (redo()) toast.success('Rehecho', { duration: 1200 });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Global error visibility — surfaces any silent failure
  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      console.error('Unhandled rejection:', e.reason);
      const msg = e.reason?.message ?? String(e.reason ?? 'desconocido');
      toast.error('Error: ' + msg, { duration: 6000 });
    }
    function onError(e: ErrorEvent) {
      console.error('Window error:', e.error || e.message);
      toast.error('Error: ' + (e.message || 'desconocido'), { duration: 6000 });
    }
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
    };
  }, []);

  // Sanity check on bridge availability
  useEffect(() => {
    if (typeof window.api === 'undefined') {
      console.error('window.api is undefined — preload no se cargó');
      toast.error(
        'No se pudo conectar con el sistema de archivos. Reinstala la app.',
        { duration: 10000 },
      );
    }
  }, []);

  useEffect(() => {
    if (!window.api) return;
    window.api.getVersion().then(setVersion).catch(() => setVersion('dev'));
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const offs = [
      window.api.onMenuEvent('menu:open-pdf', async () => {
        try {
          const files = await window.api.openPdf();
          if (!files || files.length === 0) return;
          await loadFromBytes(files[0].data, files[0].name, files[0].path);
          toast.success(`Abierto: ${files[0].name}`);
        } catch (e: any) {
          toast.error('Error: ' + (e?.message ?? 'desconocido'));
        }
      }),
      window.api.onMenuEvent('menu:save', async () => {
        if (!doc) return;
        const bytes = await savePdfWithEdits();
        await window.api.savePdf(doc.name, bytes);
        toast.success('Guardado');
      }),
      window.api.onMenuEvent('menu:save-as', async () => {
        if (!doc) return;
        const bytes = await savePdfWithEdits();
        await window.api.savePdf(doc.name, bytes);
        toast.success('Guardado');
      }),
      window.api.onMenuEvent('menu:merge', () => showMergeDialog()),
      window.api.onMenuEvent('menu:split', () => showSplitDialog()),
      window.api.onMenuEvent('menu:ocr', () => showOcrDialog()),
      window.api.onMenuEvent('menu:watermark', () => showWatermarkDialog()),
      window.api.onMenuEvent('menu:encrypt', () => showEncryptDialog()),
      window.api.onMenuEvent('menu:export-images', () => exportToImages()),
      window.api.onMenuEvent('menu:export-word', () => exportToWord()),
      window.api.onMenuEvent('menu:export-excel', () => exportToExcel()),
      window.api.onMenuEvent('menu:zoom-in', () => zoomIn()),
      window.api.onMenuEvent('menu:zoom-out', () => zoomOut()),
      window.api.onMenuEvent('menu:zoom-fit', () => zoomFit()),
      window.api.onMenuEvent('menu:about', () => showAbout(version)),
    ];
    return () => offs.forEach((off) => off?.());
  }, [doc, loadFromBytes, zoomIn, zoomOut, zoomFit, version]);

  return (
    <div className="flex h-full flex-col bg-page-alt text-ink">
      <Toolbar onAbout={() => showAbout(version)} />
      {doc && <ToolPalette />}
      <div className="relative flex flex-1 overflow-hidden">
        {doc && showSidebar && <Sidebar />}
        <div className="flex-1 overflow-hidden">
          {doc ? <PdfViewer /> : <Welcome />}
        </div>
      </div>
      <StatusBar version={version} />
      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-amazon-nav/40 backdrop-blur-sm">
          <div className="rounded-lg border border-page-border bg-page px-6 py-4 text-ink shadow-2xl">
            <div className="mb-2 h-1 w-48 overflow-hidden rounded bg-page-alt-2">
              <div className="h-full w-1/2 animate-pulse bg-amazon-orange" />
            </div>
            <p className="text-sm">Cargando PDF…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBar({ version }: { version: string }) {
  const doc = useDocument((s) => s.doc);
  return (
    <div className="flex items-center justify-between border-t border-page-border bg-page-alt px-3 py-1 text-xs text-ink-secondary">
      <div>
        {doc ? (
          <>
            <span className="font-medium text-ink">{doc.name}</span>
            <span className="mx-2">·</span>
            <span>{doc.pagesOrder.length} páginas</span>
            {doc.isDirty && (
              <>
                <span className="mx-2">·</span>
                <span className="font-medium text-amazon-orange-hover">Sin guardar</span>
              </>
            )}
          </>
        ) : (
          <span>Sin documento abierto</span>
        )}
      </div>
      <div>Editor de PDF v{version || '0.1.0'}</div>
    </div>
  );
}

function showAbout(version: string) {
  openModal('Acerca de Editor de PDF', () => (
    <div className="space-y-4 text-sm text-ink">
      <div className="flex items-center gap-3">
        <Logo size={56} />
        <div>
          <div className="text-lg font-bold">Editor de PDF</div>
          <div className="text-ink-secondary">v{version || '0.1.0'}</div>
        </div>
      </div>
      <p>
        Editor profesional de PDFs construido como alternativa libre y privada
        a Adobe Acrobat, Foxit y Nitro.
      </p>
      <p className="text-ink-secondary">
        Todo se procesa <strong className="text-ink">localmente</strong> en tu
        equipo. Tus archivos no se envían a ningún servidor.
      </p>
      <p className="text-xs text-ink-muted">
        Construido con Electron, React, TypeScript, pdf-lib, PDF.js y
        Tesseract.js.
      </p>
    </div>
  ));
}
