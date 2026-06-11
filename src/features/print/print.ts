import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { savePdfWithEdits } from '../save/save';

/**
 * Triggers a print dialog. Builds the final PDF with all annotations
 * flattened, then asks the browser/Electron to print it. This way the
 * printed output matches the saved PDF exactly.
 */
export async function printDocument(): Promise<void> {
  const doc = useDocument.getState().doc;
  if (!doc) {
    toast.error('Abre un PDF primero');
    return;
  }
  const tt = toast.loading('Preparando impresión…');
  try {
    const bytes = await savePdfWithEdits();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    // Open the PDF in a hidden iframe and trigger print
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    document.body.appendChild(iframe);
    await new Promise<void>((resolve) => {
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          /* electron may block, fallback to window.print */
          window.print();
        }
        // Clean up after a delay (print dialog needs the iframe alive)
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
            URL.revokeObjectURL(url);
          } catch {
            /* noop */
          }
          resolve();
        }, 30000);
      };
    });
    toast.dismiss(tt);
    toast.success('Diálogo de impresión abierto');
  } catch (e: any) {
    toast.dismiss(tt);
    console.error(e);
    toast.error('Error al imprimir: ' + (e?.message ?? 'desconocido'));
  }
}
