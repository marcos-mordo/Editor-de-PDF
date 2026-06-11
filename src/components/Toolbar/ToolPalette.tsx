import {
  MousePointer2,
  Hand,
  Highlighter,
  Underline,
  Strikethrough,
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  StickyNote,
  Image as ImageIcon,
  PenLine,
  TextCursorInput,
  Eraser,
} from 'lucide-react';
import { useTools, type ToolId } from '../../stores/tools';
import { cn } from '../../lib/utils';
import { showInsertImageDialog } from '../../features/edit/InsertImageDialog';
import { showSignatureDialog } from '../../features/forms/SignatureDialog';

interface ToolDef {
  id: ToolId | 'insert-image' | 'signature-pad';
  icon: React.ReactNode;
  label: string;
  group: 'nav' | 'markup' | 'shapes' | 'content';
}

const TOOLS: ToolDef[] = [
  { id: 'select', icon: <MousePointer2 size={17} />, label: 'Seleccionar', group: 'nav' },
  { id: 'hand', icon: <Hand size={17} />, label: 'Mano', group: 'nav' },
  { id: 'highlight', icon: <Highlighter size={17} />, label: 'Resaltar', group: 'markup' },
  { id: 'underline', icon: <Underline size={17} />, label: 'Subrayar', group: 'markup' },
  { id: 'strikethrough', icon: <Strikethrough size={17} />, label: 'Tachar', group: 'markup' },
  { id: 'rect', icon: <Square size={17} />, label: 'Rectángulo', group: 'shapes' },
  { id: 'circle', icon: <Circle size={17} />, label: 'Elipse', group: 'shapes' },
  { id: 'arrow', icon: <ArrowRight size={17} />, label: 'Flecha', group: 'shapes' },
  { id: 'draw', icon: <Pencil size={17} />, label: 'Dibujar', group: 'shapes' },
  { id: 'edit-text', icon: <TextCursorInput size={17} />, label: 'Editor de texto (click sobre cualquier palabra del PDF para editarla)', group: 'content' },
  { id: 'text', icon: <Type size={17} />, label: 'Añadir texto nuevo', group: 'content' },
  { id: 'eraser', icon: <Eraser size={17} />, label: 'Borrador (cubrir con blanco)', group: 'content' },
  { id: 'note', icon: <StickyNote size={17} />, label: 'Nota', group: 'content' },
  { id: 'insert-image', icon: <ImageIcon size={17} />, label: 'Insertar imagen', group: 'content' },
  { id: 'signature-pad', icon: <PenLine size={17} />, label: 'Firma', group: 'content' },
];

const COLORS = [
  '#FFD814', '#FF9900', '#C40000', '#E91E63',
  '#9C27B0', '#007185', '#067D62', '#0F1111',
];

export function ToolPalette() {
  const active = useTools((s) => s.active);
  const setActive = useTools((s) => s.setActive);
  const color = useTools((s) => s.color);
  const setColor = useTools((s) => s.setColor);
  const strokeWidth = useTools((s) => s.strokeWidth);
  const setStrokeWidth = useTools((s) => s.setStrokeWidth);
  const opacity = useTools((s) => s.opacity);
  const setOpacity = useTools((s) => s.setOpacity);
  const fontSize = useTools((s) => s.fontSize);
  const setFontSize = useTools((s) => s.setFontSize);

  const groups: Array<[string, ToolDef[]]> = [
    ['Navegación', TOOLS.filter((t) => t.group === 'nav')],
    ['Marcas', TOOLS.filter((t) => t.group === 'markup')],
    ['Formas', TOOLS.filter((t) => t.group === 'shapes')],
    ['Contenido', TOOLS.filter((t) => t.group === 'content')],
  ];

  return (
    <div className="flex items-center gap-3 border-b border-page-border bg-amazon-nav-light px-3 py-1.5 text-white">
      {groups.map(([label, tools], idx) => (
        <div key={label} className="flex items-center gap-1">
          {idx > 0 && <div className="mr-2 h-6 w-px bg-amazon-nav-hover" />}
          {tools.map((t) => (
            <button
              key={t.id}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded text-white/90 transition-colors hover:bg-amazon-nav-hover hover:text-white',
                active === t.id && '!bg-amazon-yellow !text-ink shadow-md',
              )}
              onClick={() => {
                if (t.id === 'insert-image') {
                  showInsertImageDialog();
                  return;
                }
                if (t.id === 'signature-pad') {
                  showSignatureDialog();
                  return;
                }
                setActive(t.id as ToolId);
              }}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>
      ))}

      <div className="mx-2 h-6 w-px bg-amazon-nav-hover" />

      {/* Color swatches */}
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            className={cn(
              'h-6 w-6 rounded border-2 transition-transform hover:scale-110',
              color === c ? 'border-amazon-yellow' : 'border-white/20',
            )}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
            title={c}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="ml-1 h-6 w-7 cursor-pointer rounded border border-white/20 bg-transparent"
          title="Color personalizado"
        />
      </div>

      <div className="mx-2 h-6 w-px bg-amazon-nav-hover" />

      <div className="flex items-center gap-2 text-xs text-white/80">
        <span>Grosor</span>
        <input
          type="range"
          min={1}
          max={12}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-20 accent-amazon-orange"
        />
        <span className="w-4 text-right text-white">{strokeWidth}</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-white/80">
        <span>Opacidad</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          className="w-20 accent-amazon-orange"
        />
        <span className="w-8 text-right text-white">{Math.round(opacity * 100)}%</span>
      </div>

      {(active === 'text' || active === 'note') && (
        <div className="flex items-center gap-2 text-xs text-white/80">
          <span>Fuente</span>
          <input
            type="number"
            min={6}
            max={72}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-14 rounded border border-amazon-nav-hover bg-amazon-nav-light px-1 py-0.5 text-center text-white"
          />
        </div>
      )}
    </div>
  );
}
