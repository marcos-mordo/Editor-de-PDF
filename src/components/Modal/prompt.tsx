import { useEffect, useRef, useState } from 'react';
import { openModal } from './modal';

interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  /** Mask the input (for passwords). Ignored when multiline. */
  password?: boolean;
  width?: string;
}

/**
 * Drop-in replacement for window.prompt() that works inside Electron.
 * Returns the entered string, or null if the user cancelled.
 */
export function showPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = openModal(
      opts.title,
      (api) => (
        <PromptForm
          opts={opts}
          onSubmit={(v) => {
            api.close();
            resolve(v);
          }}
          onCancel={() => {
            api.close();
            resolve(null);
          }}
        />
      ),
      opts.width ?? 'max-w-md',
    );
    // safety: if modal closes via Escape, treat as cancel
    const origClose = modal.close;
    modal.close = () => {
      origClose();
      resolve(null);
    };
  });
}

function PromptForm({
  opts,
  onSubmit,
  onCancel,
}: {
  opts: PromptOptions;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(opts.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if ('select' in el) {
      try {
        (el as HTMLInputElement).select();
      } catch {
        /* noop */
      }
    }
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (opts.multiline) {
      // multiline: Ctrl/Cmd+Enter to submit, Enter inserts newline
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSubmit(value);
      }
    } else {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSubmit(value);
      }
    }
  }

  return (
    <div className="space-y-4">
      {opts.message && (
        <p className="text-sm text-ink-secondary">{opts.message}</p>
      )}
      {opts.multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="input h-32 resize-y leading-normal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={opts.placeholder}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={opts.password ? 'password' : 'text'}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={opts.placeholder}
        />
      )}
      {opts.multiline && (
        <p className="text-xs text-ink-muted">
          Pulsa <kbd className="rounded bg-page-alt-2 px-1">Ctrl</kbd> +{' '}
          <kbd className="rounded bg-page-alt-2 px-1">Enter</kbd> para confirmar
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel}>
          {opts.cancelLabel ?? 'Cancelar'}
        </button>
        <button
          className="btn-cta"
          onClick={() => onSubmit(value)}
        >
          {opts.okLabel ?? 'Aceptar'}
        </button>
      </div>
    </div>
  );
}
