/**
 * Creates interactive AcroForm fields (text inputs, checkboxes, dropdowns) in
 * a PDF using pdf-lib's native form API. These are real, fillable fields that
 * work in Adobe Acrobat, browsers and any PDF form reader.
 */
import { PDFDocument } from 'pdf-lib';

export type FormFieldType = 'text' | 'checkbox' | 'dropdown';

export interface FormFieldDef {
  type: FormFieldType;
  /** Unique field name. */
  name: string;
  pageIndex: number;
  /** PDF user-space rectangle (origin bottom-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Default text (text fields). */
  value?: string;
  /** Options (dropdowns). */
  options?: string[];
}

/** Ensures every field name is unique by suffixing duplicates. */
function uniqueName(base: string, used: Set<string>): string {
  let name = base.trim() || 'campo';
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

export async function applyFormFields(
  pdfDoc: PDFDocument,
  fields: FormFieldDef[],
): Promise<number> {
  if (fields.length === 0) return 0;
  const form = pdfDoc.getForm();
  const used = new Set<string>(form.getFields().map((f) => f.getName()));
  let created = 0;

  for (const def of fields) {
    if (def.pageIndex < 0 || def.pageIndex >= pdfDoc.getPageCount()) continue;
    const page = pdfDoc.getPage(def.pageIndex);
    const rect = {
      x: def.x,
      y: def.y,
      width: Math.max(8, def.width),
      height: Math.max(8, def.height),
    };
    const name = uniqueName(def.name, used);
    try {
      if (def.type === 'text') {
        const tf = form.createTextField(name);
        if (def.value) tf.setText(def.value);
        tf.addToPage(page, rect);
      } else if (def.type === 'checkbox') {
        const cb = form.createCheckBox(name);
        cb.addToPage(page, rect);
      } else if (def.type === 'dropdown') {
        const dd = form.createDropdown(name);
        dd.setOptions(def.options && def.options.length ? def.options : ['Opción 1']);
        dd.addToPage(page, rect);
      }
      created++;
    } catch (e) {
      console.warn('form field creation failed', name, e);
    }
  }
  return created;
}
