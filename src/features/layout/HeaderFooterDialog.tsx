import { useState } from 'react';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

function HeaderFooterView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('');
  const [headerRight, setHeaderRight] = useState('');
  const [footerLeft, setFooterLeft] = useState('');
  const [footerCenter, setFooterCenter] = useState('');
  const [footerRight, setFooterRight] = useState('');
  const [pageNumberPos, setPageNumberPos] = useState<'none' | 'footer-center' | 'footer-right' | 'header-right'>('footer-center');
  const [pageNumberFormat, setPageNumberFormat] = useState('Página {n} de {total}');
  const [fontSize, setFontSize] = useState(11);
  const [color, setColor] = useState('#565959');
  const [margin, setMargin] = useState(30);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  function resolveText(template: string, n: number, total: number): string {
    return template
      .replace(/\{n\}/g, String(n))
      .replace(/\{total\}/g, String(total))
      .replace(/\{date\}/g, new Date().toLocaleDateString())
      .replace(/\{time\}/g, new Date().toLocaleTimeString());
  }

  async function apply() {
    if (!doc) return;
    const pages = doc.pagesOrder.slice();
    const total = pages.length;
    pushHistory();
    for (let i = 0; i < pages.length; i++) {
      const origPage = pages[i];
      const page = await doc.proxy.getPage(origPage);
      const view = page.view;
      const pageW = view[2] - view[0];
      const pageH = view[3] - view[1];

      function addText(text: string, x: number, y: number, width: number) {
        if (!text.trim()) return;
        const resolved = resolveText(text, i + 1, total);
        addAnnotation({
          type: 'text',
          pageNumber: origPage,
          x,
          y,
          width,
          height: fontSize + 4,
          color,
          opacity: 1,
          text: resolved,
          fontSize,
          fontFamily: 'Helvetica',
        });
      }

      const headerY = pageH - margin - fontSize;
      const footerY = margin;
      const colWidth = (pageW - margin * 2) / 3;

      addText(headerLeft, margin, headerY, colWidth);
      addText(headerCenter, margin + colWidth, headerY, colWidth);
      addText(headerRight, margin + colWidth * 2, headerY, colWidth);
      addText(footerLeft, margin, footerY, colWidth);
      addText(footerCenter, margin + colWidth, footerY, colWidth);
      addText(footerRight, margin + colWidth * 2, footerY, colWidth);

      if (pageNumberPos !== 'none') {
        const pn = resolveText(pageNumberFormat, i + 1, total);
        const w = pn.length * fontSize * 0.55;
        let nx = (pageW - w) / 2;
        let ny = footerY;
        switch (pageNumberPos) {
          case 'footer-center':
            nx = (pageW - w) / 2;
            ny = footerY;
            break;
          case 'footer-right':
            nx = pageW - margin - w;
            ny = footerY;
            break;
          case 'header-right':
            nx = pageW - margin - w;
            ny = headerY;
            break;
        }
        addAnnotation({
          type: 'text',
          pageNumber: origPage,
          x: nx,
          y: ny,
          width: w,
          height: fontSize + 4,
          color,
          opacity: 1,
          text: pn,
          fontSize,
          fontFamily: 'Helvetica',
        });
      }
    }
    toast.success(`Añadido a ${total} página${total !== 1 ? 's' : ''}`);
    api.close();
  }

  const fieldHelp = (
    <p className="text-xs text-ink-muted">
      Variables: <code>{'{n}'}</code> número de página · <code>{'{total}'}</code>{' '}
      total · <code>{'{date}'}</code> · <code>{'{time}'}</code>
    </p>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Añade encabezado y pie de página a todas las páginas. Cada zona tiene
        tres celdas (izquierda, centro, derecha).
      </p>

      <div>
        <label className="mb-2 block text-sm font-semibold text-ink">Encabezado</label>
        <div className="grid grid-cols-3 gap-2">
          <input
            className="input"
            placeholder="Izquierda"
            value={headerLeft}
            onChange={(e) => setHeaderLeft(e.target.value)}
          />
          <input
            className="input"
            placeholder="Centro"
            value={headerCenter}
            onChange={(e) => setHeaderCenter(e.target.value)}
          />
          <input
            className="input"
            placeholder="Derecha"
            value={headerRight}
            onChange={(e) => setHeaderRight(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-ink">Pie de página</label>
        <div className="grid grid-cols-3 gap-2">
          <input
            className="input"
            placeholder="Izquierda"
            value={footerLeft}
            onChange={(e) => setFooterLeft(e.target.value)}
          />
          <input
            className="input"
            placeholder="Centro"
            value={footerCenter}
            onChange={(e) => setFooterCenter(e.target.value)}
          />
          <input
            className="input"
            placeholder="Derecha"
            value={footerRight}
            onChange={(e) => setFooterRight(e.target.value)}
          />
        </div>
        {fieldHelp}
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-page-border pt-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Número de página</label>
          <select
            className="input"
            value={pageNumberPos}
            onChange={(e) => setPageNumberPos(e.target.value as any)}
          >
            <option value="none">No añadir</option>
            <option value="footer-center">Pie centrado</option>
            <option value="footer-right">Pie derecha</option>
            <option value="header-right">Encabezado derecha</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Formato</label>
          <input
            className="input"
            value={pageNumberFormat}
            onChange={(e) => setPageNumberFormat(e.target.value)}
            disabled={pageNumberPos === 'none'}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Tamaño</label>
          <input
            type="number"
            className="input"
            min={6}
            max={32}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Color</label>
          <input
            type="color"
            className="h-9 w-full cursor-pointer rounded border border-page-border bg-transparent"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Margen (pts)</label>
          <input
            type="number"
            className="input"
            min={5}
            max={100}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply}>
          Aplicar a todas las páginas
        </button>
      </div>
    </div>
  );
}

export function showHeaderFooterDialog() {
  openModal('Encabezado y pie de página', (api) => <HeaderFooterView api={api} />, 'max-w-2xl');
}
