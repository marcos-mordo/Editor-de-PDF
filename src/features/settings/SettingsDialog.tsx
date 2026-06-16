import { openModal } from '../../components/Modal/modal';
import { useSettings, type DefaultZoom } from '../../stores/settings';

function SettingsView() {
  const defaultZoom = useSettings((s) => s.defaultZoom);
  const setDefaultZoom = useSettings((s) => s.setDefaultZoom);
  const sidebarOnOpen = useSettings((s) => s.sidebarOnOpen);
  const setSidebarOnOpen = useSettings((s) => s.setSidebarOnOpen);
  const confirmOnClose = useSettings((s) => s.confirmOnClose);
  const setConfirmOnClose = useSettings((s) => s.setConfirmOnClose);

  const zoomOptions: { value: DefaultZoom; label: string }[] = [
    { value: 'actual', label: 'Tamaño real (100%)' },
    { value: 'fit-width', label: 'Ajustar al ancho' },
    { value: 'fit-page', label: 'Ajustar a la página' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-ink">
          Vista al abrir un documento
        </label>
        <select
          className="input"
          value={defaultZoom}
          onChange={(e) => setDefaultZoom(e.target.value as DefaultZoom)}
        >
          {zoomOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-muted">
          Se aplica automáticamente cada vez que abres un PDF.
        </p>
      </div>

      <label className="flex items-center justify-between">
        <span className="text-sm text-ink">Mostrar el panel de páginas al abrir</span>
        <input
          type="checkbox"
          checked={sidebarOnOpen}
          onChange={(e) => setSidebarOnOpen(e.target.checked)}
          className="h-4 w-4"
        />
      </label>

      <label className="flex items-center justify-between">
        <span className="text-sm text-ink">
          Confirmar al cerrar con cambios sin guardar
        </span>
        <input
          type="checkbox"
          checked={confirmOnClose}
          onChange={(e) => setConfirmOnClose(e.target.checked)}
          className="h-4 w-4"
        />
      </label>

      <p className="border-t border-page-border pt-3 text-xs text-ink-muted">
        Las preferencias se guardan en tu equipo y se recuerdan entre sesiones.
      </p>
    </div>
  );
}

export function showSettingsDialog() {
  openModal('Preferencias', () => <SettingsView />, 'max-w-md');
}
