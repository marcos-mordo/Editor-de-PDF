import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFArray,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { editTextInPage } from './engine';

function bytesToStr(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

async function pageContent(doc: PDFDocument, i: number): Promise<string> {
  const ctx = doc.context;
  const page = doc.getPage(i);
  const contents = ctx.lookup(page.node.get(PDFName.of('Contents')));
  let out = '';
  if (contents instanceof PDFArray) {
    for (let k = 0; k < contents.size(); k++) {
      const s = ctx.lookup(contents.get(k));
      if (s instanceof PDFRawStream) out += bytesToStr(decodePDFRawStream(s).decode());
    }
  } else if (contents instanceof PDFRawStream) {
    out += bytesToStr(decodePDFRawStream(contents).decode());
  }
  return out;
}

function readable(content: string): string {
  return content.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => {
    let s = '';
    for (let i = 0; i + 2 <= hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return s;
  });
}

async function roundTrip(
  draw: (doc: PDFDocument) => Promise<void>,
  oldText: string,
  newText: string,
  near?: { x: number; y: number },
) {
  const doc = await PDFDocument.create();
  await draw(doc);
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const result = await editTextInPage(reloaded, 0, oldText, newText, near);
  const editedBytes = await reloaded.save();
  const finalDoc = await PDFDocument.load(editedBytes);
  const content = readable(await pageContent(finalDoc, 0));
  return { result, content, editedBytes };
}

describe('editTextInPage', () => {
  it('edits standard-font text in place (same font preserved)', async () => {
    const { result, content } = await roundTrip(
      async (doc) => {
        const f = await doc.embedFont(StandardFonts.HelveticaBold);
        doc.addPage([600, 200]).drawText('Marcos Morales Doello', {
          x: 50,
          y: 120,
          size: 24,
          font: f,
          color: rgb(0.1, 0.2, 0.6),
        });
      },
      'Marcos Morales Doello',
      'Pedro Garcia Lopez',
    );
    expect(result.success).toBe(true);
    expect(result.mode).toBe('inplace');
    expect(content).toContain('Pedro Garcia Lopez');
    expect(content).not.toContain('Marcos Morales Doello');
  });

  it('fixes a typo preserving the rest', async () => {
    const { result, content } = await roundTrip(
      async (doc) => {
        const f = await doc.embedFont(StandardFonts.TimesRoman);
        doc.addPage([400, 150]).drawText('Helllo World', { x: 40, y: 80, size: 18, font: f });
      },
      'Helllo World',
      'Hello World',
    );
    expect(result.success).toBe(true);
    expect(content).toContain('Hello World');
    expect(content).not.toContain('Helllo World');
  });

  it('edits a substring WITHOUT deleting neighbouring text', async () => {
    const { result, content } = await roundTrip(
      async (doc) => {
        const f = await doc.embedFont(StandardFonts.Helvetica);
        doc.addPage([500, 150]).drawText('Hello World Foo Bar', { x: 30, y: 80, size: 16, font: f });
      },
      'World',
      'Planet',
    );
    expect(result.success).toBe(true);
    expect(content).toContain('Hello Planet Foo Bar');
    expect(content).toContain('Foo Bar');
    expect(content).not.toContain('World');
  });

  it('returns failure when the text is not present', async () => {
    const { result } = await roundTrip(
      async (doc) => {
        const f = await doc.embedFont(StandardFonts.Helvetica);
        doc.addPage([300, 100]).drawText('Something', { x: 20, y: 50, size: 14, font: f });
      },
      'NotThere',
      'X',
    );
    expect(result.success).toBe(false);
  });

  it('does nothing when old and new text are identical', async () => {
    const { result } = await roundTrip(
      async (doc) => {
        const f = await doc.embedFont(StandardFonts.Helvetica);
        doc.addPage([300, 100]).drawText('Same', { x: 20, y: 50, size: 14, font: f });
      },
      'Same',
      'Same',
    );
    expect(result.success).toBe(false);
  });

  it('survives a subsequent crop + metadata edit', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.HelveticaBold);
    doc.addPage([600, 800]).drawText('Marcos Morales Doello', { x: 40, y: 720, size: 28, font: f });
    let bytes = await doc.save();

    const d1 = await PDFDocument.load(bytes);
    await editTextInPage(d1, 0, 'Marcos Morales Doello', 'Pedro Garcia Lopez', { x: 40, y: 720 });
    bytes = await d1.save();

    const d2 = await PDFDocument.load(bytes);
    d2.getPage(0).setCropBox(0, 600, 600, 200);
    bytes = await d2.save();

    const d3 = await PDFDocument.load(bytes);
    d3.setTitle('X');
    bytes = await d3.save();

    const content = readable(await pageContent(await PDFDocument.load(bytes), 0));
    expect(content).toContain('Pedro Garcia Lopez');
  });
});
