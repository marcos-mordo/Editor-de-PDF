import { useRef, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Eraser } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

function SignatureView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const addAnnotation = useAnnotations((s) => s.add);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [color, setColor] = useState('#1e3a8a');
  const [width, setWidth] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
    setEmpty(false);
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  }

  function place() {
    if (empty) {
      toast.error('Dibuja tu firma primero');
      return;
    }
    if (!doc) return;
    // Crop transparent borders is complex; use full canvas as signature
    const canvas = canvasRef.current!;
    // Build a PNG with white→transparent for cleaner output
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    const wctx = work.getContext('2d')!;
    wctx.drawImage(canvas, 0, 0);
    const imgData = wctx.getImageData(0, 0, work.width, work.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      if (r > 240 && g > 240 && b > 240) imgData.data[i + 3] = 0;
    }
    wctx.putImageData(imgData, 0, 0);
    const dataUrl = work.toDataURL('image/png');

    const cp = useDocument.getState().currentPage;
    const origPage = doc.pagesOrder[cp - 1] ?? doc.pagesOrder[0];
    // Place at bottom-right
    doc.proxy.getPage(origPage).then((page) => {
      const view = page.view;
      const pageW = view[2] - view[0];
      const w = pageW * 0.3;
      const h = w * (work.height / work.width);
      pushHistory();
      addAnnotation({
        type: 'signature',
        pageNumber: origPage,
        x: pageW - w - 40,
        y: 40,
        width: w,
        height: h,
        color: '#000000',
        opacity: 1,
        imageData: dataUrl,
        imageType: 'png',
      });
      toast.success('Firma colocada en la página actual');
      api.close();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">
        Dibuja tu firma con el ratón o con un lápiz/touch, luego colócala en la página actual.
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-sm">
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-page-border bg-transparent"
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          Grosor
          <input
            type="range"
            min={1}
            max={8}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-24"
          />
        </label>
        <button className="btn-ghost ml-auto" onClick={clear}>
          <Eraser size={14} /> Limpiar
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={800}
        height={250}
        className="w-full rounded border border-page-border-strong bg-white"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={api.close}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={place} disabled={empty}>
          Colocar en página actual
        </button>
      </div>
    </div>
  );
}

export function showSignatureDialog() {
  openModal('Firma', (api) => <SignatureView api={api} />, 'max-w-2xl');
}
