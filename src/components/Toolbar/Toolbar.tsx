import { useState } from 'react';
import {
  FolderOpen,
  Save,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Files,
  Scissors,
  ScanText,
  ShieldCheck,
  Stamp,
  FileImage,
  FileType2,
  FileSpreadsheet,
  Info,
  X,
  ChevronDown,
  Undo2,
  Redo2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { useTools } from '../../stores/tools';
import { useHistory, undo, redo, pushHistory } from '../../stores/history';
import { savePdfWithEdits } from '../../features/save/save';
import { showMergeDialog } from '../../features/pages/MergeDialog';
import { showSplitDialog } from '../../features/pages/SplitDialog';
import { showOcrDialog } from '../../features/ocr/OcrDialog';
import { showWatermarkDialog } from '../../features/security/WatermarkDialog';
import { showEncryptDialog } from '../../features/security/EncryptDialog';
import { exportToImages } from '../../features/convert/exportImages';
import { exportToWord } from '../../features/convert/exportWord';
import { exportToExcel } from '../../features/convert/exportExcel';
import { Logo } from '../Logo/Logo';

export function Toolbar({ onAbout }: { onAbout: () => void }) {
  const doc = useDocument((s) => s.doc);
  const currentPage = useDocument((s) => s.currentPage);
  const zoom = useDocument((s) => s.zoom);
  const setZoom = useDocument((s) => s.setZoom);
  const zoomIn = useDocument((s) => s.zoomIn);
  const zoomOut = useDocument((s) => s.zoomOut);
  const zoomFit = useDocument((s) => s.zoomFit);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const rotateAll = useDocument((s) => s.rotateAll);
  const loadFromBytes = useDocument((s) => s.loadFromBytes);
  const close = useDocument((s) => s.close);

  const showSidebar = useTools((s) => s.showSidebar);
  const toggleSidebar = useTools((s) => s.toggleSidebar);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);

  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  async function handleOpen() {
    try {
      if (!window.api?.openPdf) {
        toast.error('Bridge no disponible. Reinstala la aplicación.');
        return;
      }
      const files = await window.api.openPdf();
      if (!files || files.length === 0) return;
      const f = files[0];
      await loadFromBytes(f.data, f.name, f.path);
      toast.success(`Abierto: ${f.name}`);
    } catch (e: any) {
      console.error(e);
      toast.error('Error al abrir: ' + (e?.message ?? 'desconocido'));
    }
  }

  async function handleSave() {
    if (!doc) return;
    setBusy(true);
    try {
      const bytes = await savePdfWithEdits();
      const defaultName = doc.name.endsWith('.pdf') ? doc.name : `${doc.name}.pdf`;
      const saved = await window.api.savePdf(defaultName, bytes);
      if (saved) toast.success('Guardado correctamente');
    } catch (e: any) {
      console.error(e);
      toast.error('Error al guardar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  const totalPages = doc?.pagesOrder.length ?? 0;

  return (
    <>
      {/* Top Amazon-style navy header */}
      <div className="flex items-center gap-3 bg-amazon-nav px-3 py-1.5 text-white">
        {doc && (
          <button
            className="tool-btn-nav"
            onClick={toggleSidebar}
            title={showSidebar ? 'Ocultar panel' : 'Mostrar panel'}
          >
            {showSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>
        )}

        <button
          onClick={onAbout}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-2 py-1 hover:bg-amazon-nav-light"
          title="Acerca de"
        >
          <Logo size={28} />
          <span className="text-sm font-bold leading-none">
            Editor de <span className="text-amazon-orange">PDF</span>
          </span>
        </button>

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

        {/* File operations - main CTAs */}
        <button
          className="btn-cta"
          onClick={handleOpen}
          title="Abrir PDF (Ctrl+O)"
        >
          <FolderOpen size={16} />
          <span>Abrir</span>
        </button>
        <button
          className="btn-orange"
          onClick={handleSave}
          disabled={!doc || busy}
          title="Guardar (Ctrl+S)"
        >
          <Save size={16} />
          <span>Guardar</span>
        </button>
        {doc && (
          <button
            className="tool-btn-nav"
            onClick={close}
            title="Cerrar documento"
          >
            <X size={18} />
          </button>
        )}

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

        {/* Undo / Redo — yellow accent so they always stand out */}
        <button
          className="tool-btn-history"
          onClick={() => undo()}
          disabled={!canUndo}
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
        >
          <Undo2 size={18} strokeWidth={2.5} />
        </button>
        <button
          className="tool-btn-history"
          onClick={() => redo()}
          disabled={!canRedo}
          title="Rehacer (Ctrl+Y)"
          aria-label="Rehacer"
        >
          <Redo2 size={18} strokeWidth={2.5} />
        </button>

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

        {/* Multi-doc */}
        <button
          className="btn-nav"
          onClick={() => showMergeDialog()}
          title="Combinar varios PDFs"
        >
          <Files size={16} />
          <span>Combinar</span>
        </button>
        <button
          className="btn-nav"
          onClick={() => showSplitDialog()}
          disabled={!doc}
          title="Dividir el PDF actual"
        >
          <Scissors size={16} />
          <span>Dividir</span>
        </button>

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

        {/* Tools */}
        <button
          className="btn-nav"
          onClick={() => showOcrDialog()}
          disabled={!doc}
          title="Reconocer texto (OCR)"
        >
          <ScanText size={16} />
          <span>OCR</span>
        </button>
        <button
          className="btn-nav"
          onClick={() => showWatermarkDialog()}
          disabled={!doc}
          title="Marca de agua"
        >
          <Stamp size={16} />
          <span>Marca</span>
        </button>
        <button
          className="btn-nav"
          onClick={() => showEncryptDialog()}
          disabled={!doc}
          title="Proteger con contraseña"
        >
          <ShieldCheck size={16} />
          <span>Proteger</span>
        </button>

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

        {/* Export dropdown */}
        <div className="relative">
          <button
            className="btn-nav"
            disabled={!doc}
            onClick={() => setExportOpen((s) => !s)}
            onBlur={() => setTimeout(() => setExportOpen(false), 150)}
          >
            <Download size={16} />
            <span>Exportar</span>
            <ChevronDown size={14} />
          </button>
          {doc && exportOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded border border-page-border bg-page p-1 shadow-amazon-card">
              <button
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink hover:bg-page-alt"
                onClick={() => {
                  setExportOpen(false);
                  exportToImages();
                }}
              >
                <FileImage size={16} className="text-amazon-orange" /> Imágenes (PNG)
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink hover:bg-page-alt"
                onClick={() => {
                  setExportOpen(false);
                  exportToWord();
                }}
              >
                <FileType2 size={16} className="text-amazon-link" /> Word (.docx)
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-ink hover:bg-page-alt"
                onClick={() => {
                  setExportOpen(false);
                  exportToExcel();
                }}
              >
                <FileSpreadsheet size={16} className="text-green-700" /> Excel (.xlsx)
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Page navigation */}
        {doc && (
          <>
            <div className="flex items-center gap-1 text-white">
              <button
                className="tool-btn-nav"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => setCurrentPage(Number(e.target.value))}
                  className="w-14 rounded border border-amazon-nav-hover bg-amazon-nav-light px-1 py-0.5 text-center text-white"
                />
                <span className="text-white/70">/ {totalPages}</span>
              </div>
              <button
                className="tool-btn-nav"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

            {/* Zoom */}
            <div className="flex items-center gap-1">
              <button className="tool-btn-nav" onClick={zoomOut} title="Alejar">
                <ZoomOut size={18} />
              </button>
              <select
                className="rounded border border-amazon-nav-hover bg-amazon-nav-light px-1 py-0.5 text-sm text-white"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                <option value={0.5}>50%</option>
                <option value={0.75}>75%</option>
                <option value={1}>100%</option>
                <option value={1.25}>125%</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
                <option value={3}>300%</option>
              </select>
              <button className="tool-btn-nav" onClick={zoomIn} title="Acercar">
                <ZoomIn size={18} />
              </button>
              <button
                className="tool-btn-nav"
                onClick={zoomFit}
                title="Restablecer (100%)"
              >
                <Maximize size={18} />
              </button>
            </div>

            <div className="h-7 w-px bg-amazon-nav-hover mx-1" />

            <button
              className="tool-btn-nav"
              onClick={() => {
                pushHistory();
                rotateAll(90);
              }}
              title="Rotar todo 90°"
            >
              <RotateCw size={18} />
            </button>
          </>
        )}

        <div className="h-7 w-px bg-amazon-nav-hover mx-1" />
        <button className="tool-btn-nav" onClick={onAbout} title="Acerca de">
          <Info size={18} />
        </button>
      </div>
    </>
  );
}
