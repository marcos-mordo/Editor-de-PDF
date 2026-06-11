import { useState } from 'react';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

interface StampPreset {
  text: string;
  color: string;
  rotation: number;
  fontSize: number;
  borderColor?: string;
}

const PRESETS: StampPreset[] = [
  { text: 'APROBADO', color: '#067D62', rotation: -8, fontSize: 36, borderColor: '#067D62' },
  { text: 'RECHAZADO', color: '#C40000', rotation: -8, fontSize: 36, borderColor: '#C40000' },
  { text: 'CONFIDENCIAL', color: '#C40000', rotation: 0, fontSize: 32, borderColor: '#C40000' },
  { text: 'BORRADOR', color: '#565959', rotation: -10, fontSize: 36, borderColor: '#565959' },
  { text: 'URGENTE', color: '#C40000', rotation: 5, fontSize: 36 },
  { text: 'PAGADO', color: '#067D62', rotation: 0, fontSize: 32, borderColor: '#067D62' },
  { text: 'REVISADO', color: '#007185', rotation: -5, fontSize: 32, borderColor: '#007185' },
  { text: 'COPIA', color: '#888888', rotation: -15, fontSize: 36, borderColor: '#888888' },
  { text: 'ORIGINAL', color: '#0F1111', rotation: 0, fontSize: 32, borderColor: '#0F1111' },
  { text: 'ANULADO', color: '#C40000', rotation: -8, fontSize: 36, borderColor: '#C40000' },
  { text: 'PRIVADO', color: '#9C27B0', rotation: 0, fontSize: 30, borderColor: '#9C27B0' },
  { text: 'FIRMADO', color: '#067D62', rotation: 0, fontSize: 30, borderColor: '#067D62' },
];

function StampsView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const [customText, setCustomText] = useState('PERSONALIZADO');
  const [customColor, setCustomColor] = useState('#C40000');
  const [pageMode, setPageMode] = useState<'current' | 'all'>('current');
  const [position, setPosition] = useState<'tr' | 'tl' | 'br' | 'bl' | 'center'>('tr');

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  function targetPages(): number[] {
    if (!doc) return [];
    if (pageMode === 'all') return doc.pagesOrder.slice();
    const cp = useDocument.getState().currentPage;
    return [doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0]];
  }

  function place(preset: StampPreset) {
    if (!doc) return;
    const pages = targetPages();
    pushHistory();
    let placed = 0;
    Promise.all(
      pages.map(async (origPage) => {
        const page = await doc.proxy.getPage(origPage);
        const view = page.view;
        const pageW = view[2] - view[0];
        const pageH = view[3] - view[1];
        // Estimate text width: ~0.6 * fontSize per character
        const textWidth = preset.text.length * preset.fontSize * 0.62;
        const textHeight = preset.fontSize * 1.4;
        const margin = 24;
        let x = pageW - textWidth - margin;
        let y = pageH - textHeight - margin;
        switch (position) {
          case 'tl':
            x = margin;
            y = pageH - textHeight - margin;
            break;
          case 'tr':
            x = pageW - textWidth - margin;
            y = pageH - textHeight - margin;
            break;
          case 'bl':
            x = margin;
            y = margin;
            break;
          case 'br':
            x = pageW - textWidth - margin;
            y = margin;
            break;
          case 'center':
            x = (pageW - textWidth) / 2;
            y = (pageH - textHeight) / 2;
            break;
        }
        // Add a border rectangle (if set)
        if (preset.borderColor) {
          addAnnotation({
            type: 'rect',
            pageNumber: origPage,
            x: x - 8,
            y: y - 4,
            width: textWidth + 16,
            height: textHeight + 8,
            color: preset.borderColor,
            opacity: 0.95,
            strokeWidth: 3,
          });
        }
        addAnnotation({
          type: 'text',
          pageNumber: origPage,
          x,
          y,
          width: textWidth,
          height: textHeight,
          color: preset.color,
          opacity: 0.95,
          text: preset.text,
          fontSize: preset.fontSize,
          fontFamily: 'Helvetica-Bold',
        });
        placed++;
      }),
    ).then(() => {
      toast.success(`Sello "${preset.text}" añadido a ${placed} página${placed !== 1 ? 's' : ''}`);
      api.close();
    });
  }

  function placeCustom() {
    place({
      text: customText.toUpperCase() || 'TEXTO',
      color: customColor,
      rotation: 0,
      fontSize: 32,
      borderColor: customColor,
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Click sobre un sello para colocarlo. Quedará en la posición elegida y se
        podrá mover después seleccionándolo.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PRESETS.map((preset, i) => (
          <button
            key={i}
            onClick={() => place(preset)}
            className="group rounded-lg border-2 border-page-border bg-page p-3 transition-all hover:border-amazon-orange hover:shadow-md"
          >
            <div
              className="inline-block whitespace-nowrap rounded border-2 px-2 py-1 font-bold tracking-wider transition-transform group-hover:scale-105"
              style={{
                color: preset.color,
                borderColor: preset.borderColor ?? 'transparent',
                fontSize: 18,
                transform: `rotate(${preset.rotation}deg)`,
              }}
            >
              {preset.text}
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-page-border pt-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Sello personalizado</h3>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            placeholder="Tu texto"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            maxLength={40}
          />
          <input
            type="color"
            className="h-9 w-12 cursor-pointer rounded border border-page-border bg-transparent"
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
          />
          <button className="btn-secondary" onClick={placeCustom}>
            Colocar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-page-border pt-4">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
          <select
            className="input"
            value={position}
            onChange={(e) => setPosition(e.target.value as any)}
          >
            <option value="tr">Superior derecha</option>
            <option value="tl">Superior izquierda</option>
            <option value="center">Centro</option>
            <option value="br">Inferior derecha</option>
            <option value="bl">Inferior izquierda</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Páginas</label>
          <div className="flex gap-3 pt-1.5 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={pageMode === 'current'}
                onChange={() => setPageMode('current')}
              />
              Actual
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={pageMode === 'all'}
                onChange={() => setPageMode('all')}
              />
              Todas
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export function showStampsDialog() {
  openModal('Sellos', (api) => <StampsView api={api} />, 'max-w-3xl');
}
