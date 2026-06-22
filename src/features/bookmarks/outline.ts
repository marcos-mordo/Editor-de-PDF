/**
 * Writes a PDF document outline (bookmarks / "Marcadores") into a pdf-lib
 * document. pdf-lib has no high-level outline API, so this builds the
 * /Outlines dictionary tree by hand per ISO 32000-1 §12.3.3 — each item with
 * /Title, /Parent, /Prev, /Next, /First, /Last, /Count and a /Dest that points
 * at the target page (fit-to-page).
 */
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFRef,
} from 'pdf-lib';

export interface BookmarkItem {
  title: string;
  /** 0-based page index the bookmark jumps to. */
  pageIndex: number;
  children?: BookmarkItem[];
}

/**
 * Replace the document outline with `items`. Returns the number of bookmark
 * nodes written. Passing an empty array removes any existing outline.
 */
export function applyOutline(pdfDoc: PDFDocument, items: BookmarkItem[]): number {
  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;

  // Drop any previous outline so we never leave dangling references.
  catalog.delete(PDFName.of('Outlines'));

  if (!items || items.length === 0) return 0;

  const pages = pdfDoc.getPages();
  const lastIndex = pages.length - 1;
  const pageRefFor = (idx: number): PDFRef =>
    pages[Math.max(0, Math.min(lastIndex, idx))].ref;

  let written = 0;

  // Builds a sibling list and returns its first/last refs plus the count of
  // visible descendants (positive — every node is created "open").
  function build(
    siblings: BookmarkItem[],
    parentRef: PDFRef,
  ): { firstRef: PDFRef; lastRef: PDFRef; count: number } {
    const refs = siblings.map(() => context.nextRef());
    let visible = 0;

    siblings.forEach((item, i) => {
      const entries: Record<string, any> = {
        Title: PDFHexString.fromText(item.title || ''),
        Parent: parentRef,
        Dest: context.obj([pageRefFor(item.pageIndex), PDFName.of('Fit')]),
      };
      if (i > 0) entries.Prev = refs[i - 1];
      if (i < refs.length - 1) entries.Next = refs[i + 1];

      let childCount = 0;
      if (item.children && item.children.length > 0) {
        const sub = build(item.children, refs[i]);
        entries.First = sub.firstRef;
        entries.Last = sub.lastRef;
        childCount = sub.count;
        entries.Count = PDFNumber.of(childCount); // open node
      }

      context.assign(refs[i], context.obj(entries));
      written += 1;
      visible += 1 + childCount;
    });

    return { firstRef: refs[0], lastRef: refs[refs.length - 1], count: visible };
  }

  const rootRef = context.nextRef();
  const top = build(items, rootRef);
  context.assign(
    rootRef,
    context.obj({
      Type: PDFName.of('Outlines'),
      First: top.firstRef,
      Last: top.lastRef,
      Count: PDFNumber.of(top.count),
    }),
  );
  catalog.set(PDFName.of('Outlines'), rootRef);

  return written;
}

/**
 * Convert a flat list of bookmarks with indent `level`s (0 = top) into the
 * nested {@link BookmarkItem} tree {@link applyOutline} expects. An item
 * attaches to the most recent item whose level is exactly one less; if none
 * exists it falls back to the top level.
 */
export function nestByLevel(
  flat: Array<{ title: string; pageIndex: number; level: number }>,
): BookmarkItem[] {
  const roots: BookmarkItem[] = [];
  // stack[l] = the last item created at level l
  const stack: BookmarkItem[] = [];

  for (const row of flat) {
    const level = Math.max(0, Math.floor(row.level));
    const node: BookmarkItem = { title: row.title, pageIndex: row.pageIndex };
    if (level === 0 || stack.length === 0) {
      roots.push(node);
      stack.length = 0;
      stack[0] = node;
    } else {
      const parentLevel = Math.min(level - 1, stack.length - 1);
      const parent = stack[parentLevel];
      (parent.children ||= []).push(node);
      stack.length = parentLevel + 1;
      stack[parentLevel + 1] = node;
    }
  }
  return roots;
}
