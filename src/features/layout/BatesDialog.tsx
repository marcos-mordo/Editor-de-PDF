import { useState } from 'react';
import toast from 'react-hot-toast';
import { Hash } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';
import { formatBates, batesRangePreview } from './bates';

type Corner =
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'top-right'
  | 'top-left';

function BatesView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [digits, setDigits] = useState(6);
  const [start, setStart] = useState(1);
  const [corner, setCorner] = useState<Corner>('bottom-right');
  const [fontSize, setFontSize] = useState(10);
  const [color, setColor] = useState('#C40000');
  const [margin, setMargin] = useState(24);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  const opts = { prefix, suffix, digits, start };

  async function apply() {
    if (!doc) return;
    const pages = doc.pagesOrder.slice();
    pushHistory();
    for (let i = 0; i < pages.length; i++) {
      const origPage = pages[i];
      const page = await doc.proxy.getPage(origPage);
      const view = page.view;
      const pageW = view[2] - view[0];
      const pageH = view[3] - view[1];
      const label = formatBates(i, opts);
      const w = label.length * fontSize * 0.6;

      let x = pageW - margin - w;
      let y = margin;
      switch (corner) {
        case 'bottom-right':
          x = pageW - margin - w;
          y = margin;
          break;
        case 'bottom-left':
          x = margin;
          y = margin;
          break;
        case 'bottom-center':
          x = (pageW - w) / 2;
          y = margin;
          break;
        case 'top-right':
          x = pageW - margin - w;
          y = pageH - margin - fontSize;
          break;
        case 'top-left':
          x = margin;
          y = pageH - margin - fontSize;
          break;
      }

      addAnnotation({
        type: 'text',
        pageNumber: origPage,
        x,
        y,
        width: w,
        height: fontSize + 4,
        color,
        opacity: 1,
        text: label,
        fontSize,
        fontFamily: 'Helvetica',
      });
    }
    toast.success(`Numeración Bates añadida a ${pages.length} página(s)`);
    api.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-red-600/20 bg-red-50 p-3 text-sm text-red-900">
        <Hash size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          Numeración <strong>Bates</strong>: identificadores secuenciales de ancho
          fijo para expedientes legales y empresariales. Se aplican a todas las
          páginas en el orden actual.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Prefijo</label>
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ACME-" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Sufijo</label>
          <input className="input" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Nº inicial</label>
          <input type="number" className="input" value={start} min={0} onChange={(e) => setStart(Number(e.target.value))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Dígitos</label>
          <input type="number" className="input" value={digits} min={1} max={12} onChange={(e) => setDigits(Number(e.target.value))} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
          <select className="input" value={corner} onChange={(e) => setCorner(e.target.value as Corner)}>
            <option value="bottom-right">Abajo derecha</option>
            <option value="bottom-center">Abajo centro</option>
            <option value="bottom-left">Abajo izquierda</option>
            <option value="top-right">Arriba derecha</option>
            <option value="top-left">Arriba izquierda</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Tamaño</label>
          <input type="number" className="input" value={fontSize} min={6} max={36} onChange={(e) => setFontSize(Number(e.target.value))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Color · Margen</label>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-page-border" />
            <input type="number" className="input" value={margin} min={4} max={120} onChange={(e) => setMargin(Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="rounded border border-page-border bg-page-alt p-2 text-center text-sm">
        Vista previa:{' '}
        <span className="font-mono font-semibold" style={{ color }}>
          {batesRangePreview(doc.pagesOrder.length, opts)}
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary" onClick={api.close}>Cancelar</button>
        <button className="btn-primary" onClick={apply}>
          <Hash size={16} />
          Aplicar a {doc.pagesOrder.length} página(s)
        </button>
      </div>
    </div>
  );
}

export function showBatesDialog() {
  openModal('Numeración Bates', (api) => <BatesView api={api} />);
}
