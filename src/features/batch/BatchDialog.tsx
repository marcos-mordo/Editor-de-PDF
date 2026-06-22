import { useState } from 'react';
import toast from 'react-hot-toast';
import { PDFDocument } from 'pdf-lib';
import { Layers, FolderOpen, Files, Play } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { stripPdfExt } from '../../lib/utils';
import { encryptPdf } from '../security/pdf-encrypt';
import { watermarkPdf, batesPdf, type BatesCorner } from './batch';

type Op = 'watermark' | 'bates' | 'encrypt';
interface InFile {
  name: string;
  data: ArrayBuffer;
}

function BatchView({ api }: { api: ModalApi }) {
  const [files, setFiles] = useState<InFile[]>([]);
  const [op, setOp] = useState<Op>('watermark');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Watermark options
  const [wmText, setWmText] = useState('CONFIDENCIAL');
  const [wmTile, setWmTile] = useState(false);
  const [wmColor, setWmColor] = useState('#C40000');

  // Bates options
  const [prefix, setPrefix] = useState('');
  const [digits, setDigits] = useState(6);
  const [start, setStart] = useState(1);
  const [corner, setCorner] = useState<BatesCorner>('bottom-right');
  const [continuous, setContinuous] = useState(true);

  // Encrypt options
  const [password, setPassword] = useState('');
  const [aes256, setAes256] = useState(true);

  async function pickFiles() {
    const picked = await window.api.openPdf({ multi: true });
    if (picked && picked.length) {
      setFiles(picked.map((f) => ({ name: f.name, data: f.data })));
    }
  }

  function suffix(): string {
    return op === 'watermark' ? '_marca' : op === 'bates' ? '_bates' : '_protegido';
  }

  async function transform(bytes: ArrayBuffer, runningIndex: number): Promise<{ out: Uint8Array; pages: number }> {
    if (op === 'watermark') {
      const out = await watermarkPdf(bytes, { text: wmText, tile: wmTile, color: wmColor });
      return { out, pages: 0 };
    }
    if (op === 'bates') {
      const r = await batesPdf(bytes, { prefix, digits, start, corner }, continuous ? runningIndex : 0);
      return { out: r.bytes, pages: r.pages };
    }
    // encrypt
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    await encryptPdf(pdfDoc, { userPassword: password, aes256 });
    const out = await pdfDoc.save({ useObjectStreams: false });
    return { out, pages: 0 };
  }

  async function run() {
    if (files.length === 0) {
      toast.error('Selecciona al menos un PDF');
      return;
    }
    if (op === 'encrypt' && password.length < 4) {
      toast.error('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    const folder = await window.api.saveFolder('PDFs procesados');
    if (!folder) return;

    setBusy(true);
    setProgress({ done: 0, total: files.length });
    let runningIndex = 0;
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const { out, pages } = await transform(f.data, runningIndex);
          runningIndex += pages;
          const outPath = `${folder}/${stripPdfExt(f.name)}${suffix()}.pdf`;
          const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
          await window.api.writeFile(outPath, ab);
          ok++;
        } catch (e) {
          console.error('batch file failed', f.name, e);
        }
        setProgress({ done: i + 1, total: files.length });
      }
      toast.success(`Procesados ${ok}/${files.length} en la carpeta elegida`, { duration: 5000 });
      if (ok > 0) api.close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-amazon-orange/20 bg-amber-50 p-3 text-sm text-ink">
        <Layers size={18} className="mt-0.5 flex-shrink-0 text-amazon-orange" />
        <div>
          Aplica una misma operación a <strong>varios PDFs de golpe</strong> y
          guarda los resultados en una carpeta. Sin abrirlos uno a uno.
        </div>
      </div>

      <div>
        <button className="btn-secondary" onClick={pickFiles} disabled={busy}>
          <Files size={15} />
          {files.length ? `${files.length} archivo(s) seleccionados` : 'Seleccionar PDFs…'}
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Operación</label>
        <div className="flex gap-2">
          <OpBtn active={op === 'watermark'} onClick={() => setOp('watermark')} label="Marca de agua" />
          <OpBtn active={op === 'bates'} onClick={() => setOp('bates')} label="Numeración Bates" />
          <OpBtn active={op === 'encrypt'} onClick={() => setOp('encrypt')} label="Cifrar" />
        </div>
      </div>

      {op === 'watermark' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-ink-secondary">Texto</label>
            <input className="input" value={wmText} onChange={(e) => setWmText(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wmTile} onChange={(e) => setWmTile(e.target.checked)} />
            Mosaico diagonal
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-secondary">Color</span>
            <input type="color" value={wmColor} onChange={(e) => setWmColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-page-border" />
          </div>
        </div>
      )}

      {op === 'bates' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary">Prefijo</label>
            <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ACME-" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-ink-secondary">Inicio</label>
              <input type="number" className="input" value={start} onChange={(e) => setStart(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-secondary">Dígitos</label>
              <input type="number" className="input" value={digits} min={1} max={12} onChange={(e) => setDigits(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
            <select className="input" value={corner} onChange={(e) => setCorner(e.target.value as BatesCorner)}>
              <option value="bottom-right">Abajo derecha</option>
              <option value="bottom-center">Abajo centro</option>
              <option value="bottom-left">Abajo izquierda</option>
              <option value="top-right">Arriba derecha</option>
              <option value="top-left">Arriba izquierda</option>
            </select>
          </div>
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
            Numeración continua entre archivos
          </label>
        </div>
      )}

      {op === 'encrypt' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-ink-secondary">Contraseña de apertura</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 4 caracteres" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aes256} onChange={(e) => setAes256(e.target.checked)} />
            AES-256 (recomendado)
          </label>
        </div>
      )}

      {progress && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-page-alt">
            <div
              className="h-full bg-amazon-orange transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-center text-xs text-ink-secondary">
            {progress.done} / {progress.total}
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={run} disabled={busy || files.length === 0}>
          {busy ? <FolderOpen size={16} /> : <Play size={16} />}
          {busy ? 'Procesando…' : 'Procesar y guardar'}
        </button>
      </div>
    </div>
  );
}

function OpBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex-1 rounded border px-3 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-amazon-orange bg-amazon-orange/10 font-medium text-ink'
          : 'border-page-border text-ink-secondary hover:bg-gray-50')
      }
    >
      {label}
    </button>
  );
}

export function showBatchDialog() {
  openModal('Procesamiento por lotes', (api) => <BatchView api={api} />, 'max-w-2xl');
}
