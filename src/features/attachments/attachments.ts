/**
 * Embedded file attachments — the PDF equivalent of e-mail attachments
 * (ISO 32000-1 §7.11). Lets a PDF carry arbitrary companion files (a
 * spreadsheet, the source document, evidence, …) that travel inside the PDF
 * and show up in Acrobat's "Attachments" panel.
 */
import type { PDFDocument } from 'pdf-lib';

export interface AttachmentInput {
  name: string;
  data: Uint8Array | ArrayBuffer;
  mimeType?: string;
  description?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

export function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Embed each file into `pdfDoc`. Returns the number attached. */
export async function attachFilesToPdf(
  pdfDoc: PDFDocument,
  files: AttachmentInput[],
): Promise<number> {
  let count = 0;
  for (const f of files) {
    const bytes = f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data;
    await pdfDoc.attach(bytes, f.name, {
      mimeType: f.mimeType ?? guessMimeType(f.name),
      description: f.description,
      creationDate: new Date(),
      modificationDate: new Date(),
    });
    count++;
  }
  return count;
}
