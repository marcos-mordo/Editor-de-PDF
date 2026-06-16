import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyFormFields } from './form-fields';

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return doc;
}

describe('applyFormFields', () => {
  it('creates text, checkbox and dropdown fields', async () => {
    const doc = await blank();
    const n = await applyFormFields(doc, [
      { type: 'text', name: 'nombre', pageIndex: 0, x: 20, y: 300, width: 200, height: 24, value: 'hola' },
      { type: 'checkbox', name: 'acepto', pageIndex: 0, x: 20, y: 260, width: 16, height: 16 },
      { type: 'dropdown', name: 'pais', pageIndex: 0, x: 20, y: 220, width: 160, height: 24, options: ['ES', 'FR'] },
    ]);
    expect(n).toBe(3);

    const out = await doc.save();
    const reloaded = await PDFDocument.load(out);
    const form = reloaded.getForm();
    const names = form.getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['acepto', 'nombre', 'pais']);

    // The text field keeps its default value.
    expect(form.getTextField('nombre').getText()).toBe('hola');
    // The dropdown keeps its options.
    expect(form.getDropdown('pais').getOptions().sort()).toEqual(['ES', 'FR']);
  });

  it('de-duplicates field names', async () => {
    const doc = await blank();
    const n = await applyFormFields(doc, [
      { type: 'text', name: 'dup', pageIndex: 0, x: 10, y: 100, width: 100, height: 20 },
      { type: 'text', name: 'dup', pageIndex: 0, x: 10, y: 60, width: 100, height: 20 },
    ]);
    expect(n).toBe(2);
    const form = (await PDFDocument.load(await doc.save())).getForm();
    expect(form.getFields().length).toBe(2);
  });

  it('returns 0 for no fields', async () => {
    const doc = await blank();
    expect(await applyFormFields(doc, [])).toBe(0);
  });
});
