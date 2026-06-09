import { useState } from 'react';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import toast from 'react-hot-toast';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';

function WatermarkView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const setWorkingBytes = useDocument((s) => s.setWorkingBytes);
  const [text, setText] = useState('CONFIDENCIAL');
  const [fontSize, setFontSize] = useState(60);
  const [opacity, setOpacity] = useState(0.2);
  const [color, setColor] = useState('#ef4444');
  const [rotation, setRotation] = useState(-30);
  const [position, setPosition] = useState<'center' | 'diagonal-tile'>('center');
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  function hexToRgb(hex: string) {
    const m = hex.replace('#', '');
    return rgb(
      parseInt(m.slice(0, 2), 16) / 255,
      parseInt(m.slice(2, 4), 16) / 255,
      parseInt(m.slice(4, 6), 16) / 255,
    );
  }

  async function apply() {
    if (!doc) return;
    setBusy(true);
    try {
      const source = await PDFDocument.load(doc.workingBytes.slice(0), {
        ignoreEncryption: true,
      });
      const font = await source.embedFont(StandardFonts.HelveticaBold);
      const pages = source.getPages();
      for (const page of pages) {
        const { width, height } = page.getSize();
        if (position === 'diagonal-tile') {
          const step = fontSize * 4;
          for (let y = 0; y < height + step; y += step) {
            for (let x = -step; x < width + step; x += step) {
              page.drawText(text, {
                x,
                y,
                size: fontSize,
                font,
                color: hexToRgb(color),
                opacity,
                rotate: degrees(rotation),
              });
            }
          }
        } else {
          // center
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          page.drawText(text, {
            x: (width - textWidth) / 2,
            y: height / 2,
            size: fontSize,
            font,
            color: hexToRgb(color),
            opacity,
            rotate: degrees(rotation),
          });
        }
      }
      const bytes = await source.save();
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await setWorkingBytes(ab);
      toast.success('Marca de agua aplicada');
      api.close();
    } catch (e: any) {
      console.error(e);
      toast.error('Error: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Añade un texto como marca de agua a todas las páginas. Para revertir, cierra
        sin guardar o reabre el documento.
      </p>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Texto</label>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Tamaño</label>
          <input
            type="number"
            className="input"
            min={8}
            max={200}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Rotación</label>
          <input
            type="number"
            className="input"
            min={-90}
            max={90}
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Opacidad</label>
          <input
            type="range"
            min={5}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            className="w-full"
          />
          <div className="text-right text-xs text-ink-secondary">
            {Math.round(opacity * 100)}%
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-full cursor-pointer rounded border border-page-border bg-transparent"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">Posición</label>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={position === 'center'}
              onChange={() => setPosition('center')}
            />
            Centrada
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={position === 'diagonal-tile'}
              onChange={() => setPosition('diagonal-tile')}
            />
            Mosaico diagonal
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy || !text.trim()}>
          {busy ? 'Aplicando…' : 'Aplicar marca de agua'}
        </button>
      </div>
    </div>
  );
}

export function showWatermarkDialog() {
  openModal('Marca de agua', (api) => <WatermarkView api={api} />);
}
