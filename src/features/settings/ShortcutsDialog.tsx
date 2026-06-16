import { openModal } from '../../components/Modal/modal';

interface Shortcut {
  keys: string[];
  desc: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Archivo',
    items: [
      { keys: ['Ctrl', 'O'], desc: 'Abrir PDF' },
      { keys: ['Ctrl', 'S'], desc: 'Guardar' },
      { keys: ['Ctrl', 'Shift', 'S'], desc: 'Guardar como' },
      { keys: ['Ctrl', 'P'], desc: 'Imprimir' },
    ],
  },
  {
    title: 'Edición',
    items: [
      { keys: ['Ctrl', 'Z'], desc: 'Deshacer' },
      { keys: ['Ctrl', 'Y'], desc: 'Rehacer' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Rehacer (alternativa)' },
      { keys: ['Ctrl', 'F'], desc: 'Buscar y reemplazar' },
      { keys: ['Supr'], desc: 'Eliminar anotación seleccionada' },
    ],
  },
  {
    title: 'Vista',
    items: [
      { keys: ['Ctrl', '+'], desc: 'Acercar' },
      { keys: ['Ctrl', '−'], desc: 'Alejar' },
      { keys: ['Ctrl', '0'], desc: 'Tamaño real (100%)' },
      { keys: ['Ctrl', '1'], desc: 'Ajustar al ancho' },
      { keys: ['Ctrl', '2'], desc: 'Ajustar a la página' },
      { keys: ['Ctrl', 'rueda'], desc: 'Zoom con la rueda del ratón' },
      { keys: ['Click rueda'], desc: 'Mano temporal (desplazar)' },
    ],
  },
  {
    title: 'Editor de texto',
    items: [
      { keys: ['Click'], desc: 'Editar la palabra/línea bajo el cursor' },
      { keys: ['Enter'], desc: 'Confirmar la edición' },
      { keys: ['Esc'], desc: 'Cancelar la edición' },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-block min-w-[1.6rem] rounded border border-page-border bg-page-alt px-1.5 py-0.5 text-center text-xs font-medium text-ink shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutsView() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-secondary">
            {g.title}
          </h3>
          <div className="space-y-1.5">
            {g.items.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{s.desc}</span>
                <span className="flex flex-shrink-0 items-center gap-1">
                  {s.keys.map((k, j) => (
                    <span key={j} className="flex items-center gap-1">
                      {j > 0 && <span className="text-xs text-ink-muted">+</span>}
                      <Key>{k}</Key>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function showShortcutsDialog() {
  openModal('Atajos de teclado', () => <ShortcutsView />, 'max-w-2xl');
}
