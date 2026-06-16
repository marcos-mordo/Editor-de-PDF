import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import toast from 'react-hot-toast';
import { Eye, EyeOff, ShieldCheck, Lock } from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { stripPdfExt, toArrayBuffer } from '../../lib/utils';
import { savePdfWithEdits } from '../save/save';
import { encryptPdf } from './pdf-encrypt';

function EncryptView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [userPassword, setUserPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [aes256, setAes256] = useState(true);
  const [permissions, setPermissions] = useState({
    printing: true,
    copying: true,
    modifying: false,
    annotating: true,
  });
  const [busy, setBusy] = useState(false);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function apply() {
    if (!doc) return;
    if (userPassword.length < 4) {
      toast.error('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    if (userPassword !== confirmPwd) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    const tt = toast.loading(`Cifrando con ${aes256 ? 'AES-256' : 'AES-128'}…`);
    try {
      // Build the final edited PDF (annotations/edits flattened), then encrypt.
      const editedBytes = await savePdfWithEdits();
      const pdfDoc = await PDFDocument.load(editedBytes, { ignoreEncryption: true });
      await encryptPdf(pdfDoc, {
        userPassword,
        ownerPassword: ownerPassword || userPassword,
        permissions,
        aes256,
      });
      // useObjectStreams:false → every object is a plain, encrypted indirect object.
      const out = await pdfDoc.save({ useObjectStreams: false });
      const ab = toArrayBuffer(out);
      const name = `${stripPdfExt(doc.name)}_protegido.pdf`;
      const saved = await window.api.savePdf(name, ab);
      toast.dismiss(tt);
      if (saved) {
        toast.success('PDF cifrado y guardado', { duration: 4000 });
        api.close();
      }
    } catch (e: any) {
      toast.dismiss(tt);
      console.error(e);
      toast.error('Error al cifrar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-green-600/30 bg-green-50 p-3 text-sm text-green-800">
        <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          <strong>Cifrado {aes256 ? 'AES-256' : 'AES-128'} real.</strong> El PDF se
          protege con el estándar de seguridad de PDF (mismo que Adobe Acrobat).
          Pedirá la contraseña para abrirse en cualquier lector. Guárdala bien: sin
          ella no podrás recuperar el documento.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Nivel de cifrado
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAes256(true)}
            className={
              'flex-1 rounded border px-3 py-2 text-sm transition-colors ' +
              (aes256
                ? 'border-amazon-orange bg-amazon-orange/10 font-medium text-ink'
                : 'border-page-border text-ink-secondary hover:bg-gray-50')
            }
          >
            AES-256 (PDF 2.0)
            <span className="block text-[11px] text-ink-secondary">
              Máxima seguridad — recomendado
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAes256(false)}
            className={
              'flex-1 rounded border px-3 py-2 text-sm transition-colors ' +
              (!aes256
                ? 'border-amazon-orange bg-amazon-orange/10 font-medium text-ink'
                : 'border-page-border text-ink-secondary hover:bg-gray-50')
            }
          >
            AES-128 (R4)
            <span className="block text-[11px] text-ink-secondary">
              Compatibilidad máxima
            </span>
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Contraseña de apertura
        </label>
        <div className="relative">
          <input
            type={showPwd ? 'text' : 'password'}
            className="input pr-10"
            value={userPassword}
            onChange={(e) => setUserPassword(e.target.value)}
            placeholder="Mínimo 4 caracteres"
          />
          <button
            type="button"
            onClick={() => setShowPwd((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-secondary hover:text-ink"
          >
            {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Confirmar contraseña
        </label>
        <input
          type={showPwd ? 'text' : 'password'}
          className="input"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Contraseña de propietario (opcional)
        </label>
        <input
          type={showPwd ? 'text' : 'password'}
          className="input"
          value={ownerPassword}
          onChange={(e) => setOwnerPassword(e.target.value)}
          placeholder="Para cambiar permisos sin la contraseña de apertura"
        />
      </div>

      <div>
        <label className="mb-2 block text-xs text-ink-secondary">
          Permisos (requieren la contraseña de propietario para cambiarse)
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(
            [
              ['printing', 'Permitir imprimir'],
              ['copying', 'Permitir copiar texto'],
              ['modifying', 'Permitir modificar'],
              ['annotating', 'Permitir anotar'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={permissions[k]}
                onChange={(e) =>
                  setPermissions((p) => ({ ...p, [k]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy}>
          <Lock size={16} />
          {busy ? 'Cifrando…' : 'Cifrar y guardar'}
        </button>
      </div>
    </div>
  );
}

export function showEncryptDialog() {
  openModal('Proteger con contraseña', (api) => <EncryptView api={api} />);
}
