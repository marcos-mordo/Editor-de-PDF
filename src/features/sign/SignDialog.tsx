import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  PenTool,
  ShieldCheck,
  ShieldAlert,
  FileSignature,
  BadgePlus,
  Upload,
} from 'lucide-react';
import { openModal, type ModalApi } from '../../components/Modal/modal';
import { useDocument } from '../../stores/document';
import { stripPdfExt } from '../../lib/utils';
import { savePdfWithEdits } from '../save/save';

type SignatureVerifyResult = NonNullable<
  Awaited<ReturnType<Window['api']['verifySignature']>>
>;

// ---------------------------------------------------------------------------
// Sign a PDF with a PKCS#12 digital ID (.p12/.pfx)
// ---------------------------------------------------------------------------

function SignView({ api }: { api: ModalApi }) {
  const doc = useDocument((s) => s.doc);
  const [cert, setCert] = useState<{ name: string; data: ArrayBuffer } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [reason, setReason] = useState('He revisado este documento');
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  async function pickCert() {
    const c = await window.api.openCert();
    if (c) setCert(c);
  }

  async function apply() {
    if (!doc) return;
    if (!cert) {
      toast.error('Selecciona una identidad digital (.p12/.pfx)');
      return;
    }
    if (!passphrase) {
      toast.error('Introduce la contraseña de la identidad digital');
      return;
    }
    setBusy(true);
    const tt = toast.loading('Firmando digitalmente…');
    try {
      const pdfAb = await savePdfWithEdits();
      const signed = await window.api.signPdf(pdfAb, cert.data, passphrase, {
        reason,
        location,
        name,
      });
      toast.dismiss(tt);
      if (!signed) {
        toast.error('No se pudo firmar. ¿Contraseña correcta?');
        return;
      }
      const outName = `${stripPdfExt(doc.name)}_firmado.pdf`;
      const saved = await window.api.savePdf(outName, signed);
      if (saved) {
        toast.success('PDF firmado digitalmente y guardado', { duration: 4000 });
        api.close();
      }
    } catch (e: any) {
      toast.dismiss(tt);
      console.error(e);
      toast.error('Error al firmar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  if (showCreate) {
    return <CreateIdView onBack={() => setShowCreate(false)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-blue-600/30 bg-blue-50 p-3 text-sm text-blue-800">
        <FileSignature size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          <strong>Firma digital con certificado (PKCS#7).</strong> Vincula
          criptográficamente el documento a tu identidad: cualquier cambio
          posterior invalidará la firma. Reconocida por Adobe Acrobat y otros
          lectores.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Identidad digital (.p12 / .pfx)
        </label>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={pickCert} type="button">
            <Upload size={15} />
            {cert ? 'Cambiar…' : 'Seleccionar archivo…'}
          </button>
          {cert && <span className="text-sm text-ink">{cert.name}</span>}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-2 flex items-center gap-1 text-xs text-amazon-link hover:underline"
        >
          <BadgePlus size={14} />
          No tengo una — crear identidad digital autofirmada
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-ink-secondary">
          Contraseña de la identidad digital
        </label>
        <input
          type="password"
          className="input"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-ink-secondary">Motivo</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Nombre (opcional)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Lugar (opcional)</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={api.close} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={apply} disabled={busy}>
          <PenTool size={16} />
          {busy ? 'Firmando…' : 'Firmar y guardar'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create a self-signed digital ID (like Acrobat's "self-signed digital ID")
// ---------------------------------------------------------------------------

function CreateIdView({ onBack }: { onBack: () => void }) {
  const [commonName, setCommonName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (commonName.trim().length < 2) {
      toast.error('Introduce tu nombre');
      return;
    }
    if (passphrase.length < 4) {
      toast.error('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    setBusy(true);
    const tt = toast.loading('Generando certificado RSA-2048…');
    try {
      const path = await window.api.createDigitalId(
        { commonName, organization, email, country },
        passphrase,
      );
      toast.dismiss(tt);
      if (path) {
        toast.success('Identidad digital creada. Selecciónala para firmar.', {
          duration: 5000,
        });
        onBack();
      }
    } catch (e: any) {
      toast.dismiss(tt);
      toast.error('Error al crear la identidad: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-50 p-3 text-sm text-amber-800">
        <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          Una identidad <strong>autofirmada</strong> es válida para uso personal,
          pero no la respalda una autoridad de certificación. Guárdala en un lugar
          seguro junto con su contraseña.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-ink-secondary">Nombre completo *</label>
          <input className="input" value={commonName} onChange={(e) => setCommonName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">Organización</label>
          <input className="input" value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-secondary">País (código)</label>
          <input className="input" value={country} maxLength={2} placeholder="ES" onChange={(e) => setCountry(e.target.value.toUpperCase())} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-ink-secondary">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-ink-secondary">Contraseña para la identidad *</label>
          <input type="password" className="input" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onBack} disabled={busy}>
          Atrás
        </button>
        <button className="btn-primary" onClick={create} disabled={busy}>
          <BadgePlus size={16} />
          {busy ? 'Generando…' : 'Crear y guardar (.p12)'}
        </button>
      </div>
    </div>
  );
}

export function showSignDialog() {
  openModal('Firmar digitalmente', (api) => <SignView api={api} />);
}

// ---------------------------------------------------------------------------
// Verify an existing signature
// ---------------------------------------------------------------------------

function VerifyView() {
  const doc = useDocument((s) => s.doc);
  const [result, setResult] = useState<SignatureVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function run() {
    if (!doc) return;
    setBusy(true);
    try {
      // Verify the bytes as opened — re-saving would alter the signed range.
      const res = await window.api.verifySignature(doc.originalBytes);
      setResult(res);
      setDone(true);
    } catch (e: any) {
      toast.error('Error al verificar: ' + (e?.message ?? 'desconocido'));
    } finally {
      setBusy(false);
    }
  }

  if (!doc) {
    return <div className="text-sm text-ink-secondary">Abre un PDF primero.</div>;
  }

  if (!done) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-secondary">
          Comprueba si este PDF tiene una firma digital y si es válida
          (la firma se corresponde con el certificado y el documento no se ha
          alterado desde que se firmó).
        </p>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={run} disabled={busy}>
            <ShieldCheck size={16} />
            {busy ? 'Verificando…' : 'Verificar firma'}
          </button>
        </div>
      </div>
    );
  }

  if (!result || !result.signed) {
    return (
      <div className="flex items-start gap-2 rounded border border-gray-300 bg-gray-50 p-3 text-sm text-ink">
        <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-gray-500" />
        <div>Este documento <strong>no contiene una firma digital</strong>.</div>
      </div>
    );
  }

  const fullyValid = result.valid && result.digestMatches;
  return (
    <div className="space-y-3">
      <div
        className={
          'flex items-start gap-2 rounded border p-3 text-sm ' +
          (fullyValid
            ? 'border-green-600/30 bg-green-50 text-green-800'
            : 'border-red-600/30 bg-red-50 text-red-800')
        }
      >
        {fullyValid ? (
          <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
        ) : (
          <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
        )}
        <div>
          {fullyValid ? (
            <strong>Firma válida.</strong>
          ) : (
            <strong>Firma no válida o documento alterado.</strong>
          )}
        </div>
      </div>

      <dl className="space-y-1 text-sm">
        <Row label="Firmante" value={result.signerCommonName || '—'} />
        <Row label="Firma criptográfica" value={result.valid ? '✓ Correcta' : '✗ Incorrecta'} />
        <Row
          label="Integridad del documento"
          value={result.digestMatches ? '✓ Intacto desde la firma' : '✗ Modificado tras firmar'}
        />
        <Row
          label="Cobertura"
          value={result.coversWholeFile ? '✓ Todo el archivo' : '⚠ Parcial'}
        />
        {result.error && <Row label="Detalle" value={result.error} />}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-page-border py-1">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

export function showVerifySignatureDialog() {
  openModal('Verificar firma digital', () => <VerifyView />);
}
