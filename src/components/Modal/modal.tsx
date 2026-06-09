import { createRoot, type Root } from 'react-dom/client';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

let containerEl: HTMLDivElement | null = null;
let root: Root | null = null;

function ensureContainer(): HTMLDivElement {
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'modal-root';
    document.body.appendChild(containerEl);
    root = createRoot(containerEl);
  }
  return containerEl;
}

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

function ModalShell({ title, onClose, children, width = 'max-w-lg' }: ModalShellProps) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`${width} w-full overflow-hidden rounded-lg border border-page-border bg-page shadow-2xl animate-slide-up`}
        style={{ opacity: show ? 1 : 0 }}
      >
        <div className="flex items-center justify-between border-b border-page-border bg-page-alt px-5 py-3">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-secondary hover:bg-page-alt-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export interface ModalApi {
  close: () => void;
}

export function openModal(
  title: string,
  render: (api: ModalApi) => ReactNode,
  width?: string,
): ModalApi {
  ensureContainer();
  const api: ModalApi = {
    close: () => {
      root?.render(null);
    },
  };
  root!.render(
    <ModalShell title={title} onClose={api.close} width={width}>
      {render(api)}
    </ModalShell>,
  );
  return api;
}
