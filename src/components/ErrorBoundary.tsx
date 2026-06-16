import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Copy } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render-time crashes anywhere below it so a single broken component
 * can't white-screen the whole app. Shows a recoverable error panel with the
 * details (and writes them to the persistent log via console.error, which the
 * main process captures).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    console.error('React render error:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null, info: null });

  copyDetails = () => {
    const { error, info } = this.state;
    const text = `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}\n\nComponent stack:${info?.componentStack ?? ''}`;
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* noop */
    }
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-page-alt p-6">
        <div className="w-full max-w-2xl rounded-lg border border-page-border bg-page p-6 shadow-amazon-card">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">Algo salió mal</h1>
              <p className="text-sm text-ink-secondary">
                La aplicación encontró un error. Tu documento no se ha perdido.
              </p>
            </div>
          </div>

          <pre className="max-h-48 overflow-auto rounded border border-page-border bg-page-alt p-3 text-xs text-ink-secondary">
            {error.name}: {error.message}
            {'\n'}
            {error.stack}
            {info?.componentStack}
          </pre>

          <div className="mt-4 flex items-center justify-between">
            <button className="btn-secondary" onClick={this.copyDetails}>
              <Copy size={14} /> Copiar detalles
            </button>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => location.reload()}
                title="Recargar la aplicación"
              >
                Recargar app
              </button>
              <button className="btn-primary" onClick={this.reset}>
                <RotateCcw size={14} /> Reintentar
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Si el problema persiste, abre Menú Ayuda → Abrir carpeta de logs y
            comparte el archivo <code>main.log</code>.
          </p>
        </div>
      </div>
    );
  }
}
