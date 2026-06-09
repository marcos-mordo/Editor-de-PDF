import { useState } from 'react';
import {
  FolderOpen,
  Files,
  ScanText,
  ShieldCheck,
  Scissors,
  Stamp,
  Highlighter,
  Pencil,
  Languages,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { showMergeDialog } from '../../features/pages/MergeDialog';
import { showOcrDialog } from '../../features/ocr/OcrDialog';
import { showEncryptDialog } from '../../features/security/EncryptDialog';
import { Logo } from '../Logo/Logo';

export function Welcome() {
  const loadFromBytes = useDocument((s) => s.loadFromBytes);
  const [dragging, setDragging] = useState(false);

  async function handleOpen() {
    try {
      if (!window.api?.openPdf) {
        toast.error('Bridge no disponible. Reinstala la aplicación.');
        return;
      }
      const files = await window.api.openPdf();
      if (!files || files.length === 0) return;
      await loadFromBytes(files[0].data, files[0].name, files[0].path);
      toast.success(`Abierto: ${files[0].name}`);
    } catch (e: any) {
      console.error(e);
      toast.error('Error al abrir: ' + (e?.message ?? 'desconocido'));
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith('.pdf'),
    );
    if (!file) {
      toast.error('Arrastra un archivo PDF.');
      return;
    }
    file.arrayBuffer().then((buf) => {
      loadFromBytes(buf, file.name).then(() => toast.success(`Abierto: ${file.name}`));
    });
  }

  const features = [
    { icon: <Highlighter size={20} />, title: 'Anotaciones', desc: 'Resaltado, subrayado, formas y dibujo libre' },
    { icon: <Pencil size={20} />, title: 'Edición', desc: 'Añade texto e imágenes sobre tus PDFs' },
    { icon: <Files size={20} />, title: 'Combinar PDFs', desc: 'Une varios documentos en uno solo' },
    { icon: <Scissors size={20} />, title: 'Dividir', desc: 'Extrae páginas o trozos de un PDF' },
    { icon: <ScanText size={20} />, title: 'OCR', desc: 'Reconoce texto en escaneos (es/en/fr)' },
    { icon: <Stamp size={20} />, title: 'Marcas de agua', desc: 'Texto o imagen como watermark' },
    { icon: <ShieldCheck size={20} />, title: 'Contraseñas', desc: 'Protege tus PDFs con cifrado' },
    { icon: <Languages size={20} />, title: 'Exportar', desc: 'A imágenes, Word o Excel' },
  ];

  return (
    <div
      className="h-full overflow-auto bg-page"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Hero (Amazon-style) */}
      <div className="bg-gradient-to-b from-amazon-nav-light to-amazon-nav px-6 py-12 text-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <Logo size={84} />
          <h1 className="mt-4 text-3xl font-bold">
            Editor de <span className="text-amazon-orange">PDF</span>
          </h1>
          <p className="mt-2 max-w-lg text-base text-white/80">
            Una alternativa libre, completa y privada a Adobe Acrobat. Todo se procesa
            localmente en tu PC.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button className="btn-cta px-5 py-2.5 text-base" onClick={handleOpen}>
              <FolderOpen size={18} />
              Abrir PDF
            </button>
            <button
              className="btn-orange px-5 py-2.5 text-base"
              onClick={() => showMergeDialog()}
            >
              <Files size={18} />
              Combinar PDFs
            </button>
            <button
              className="btn-secondary px-5 py-2.5 text-base"
              onClick={() => showOcrDialog()}
            >
              <ScanText size={18} />
              OCR
            </button>
            <button
              className="btn-secondary px-5 py-2.5 text-base"
              onClick={() => showEncryptDialog()}
            >
              <ShieldCheck size={18} />
              Proteger
            </button>
          </div>

          <p className="mt-4 text-xs text-white/60">
            Atajo: <kbd className="rounded bg-white/10 px-1.5 py-0.5">Ctrl</kbd> +{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5">O</kbd> · o arrastra un PDF a esta ventana
          </p>
        </div>
      </div>

      {/* Drop zone (visible state) */}
      {dragging && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-amazon-yellow/30 backdrop-blur-sm">
          <div className="rounded-lg border-4 border-dashed border-amazon-orange bg-page px-12 py-8 text-center shadow-2xl">
            <FolderOpen size={48} className="mx-auto text-amazon-orange" />
            <p className="mt-3 text-lg font-bold text-ink">
              Suelta el PDF para abrirlo
            </p>
          </div>
        </div>
      )}

      {/* Features grid */}
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h2 className="mb-1 text-xl font-bold text-ink">Todo lo que puedes hacer</h2>
        <p className="mb-6 text-sm text-ink-secondary">
          Las herramientas profesionales de los editores premium, sin suscripción.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-page-border bg-page p-4 text-left shadow-amazon-card transition-all hover:-translate-y-0.5 hover:border-amazon-orange hover:shadow-lg"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-amazon-yellow/30 text-amazon-orange-hover">
                {f.icon}
              </div>
              <div className="text-sm font-semibold text-ink">{f.title}</div>
              <div className="text-xs text-ink-secondary">{f.desc}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-amazon-orange/30 bg-amazon-yellow/10 p-4 text-center">
          <p className="text-sm text-ink">
            🔒 <strong>Privacidad total:</strong> tus archivos nunca salen de tu
            computadora. Sin servidores, sin telemetría, sin cuentas.
          </p>
        </div>
      </div>
    </div>
  );
}
