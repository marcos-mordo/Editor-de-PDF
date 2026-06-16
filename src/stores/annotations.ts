import { create } from 'zustand';
import { generateId } from '../lib/utils';

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'rect'
  | 'circle'
  | 'arrow'
  | 'draw'
  | 'text'
  | 'note'
  | 'image'
  | 'signature'
  | 'text-replace'
  | 'redact'
  | 'form-field'
  | 'measure';

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 1-based original page number */
  pageNumber: number;
  /** Coordinates in PDF user space (origin bottom-left) */
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  strokeWidth?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  points?: Point[];
  /** For image / signature annotations */
  imageData?: string;
  imageType?: 'png' | 'jpg';
  /** For text-replace annotations: the original text in the PDF content stream. */
  oldText?: string;
  /** Background colour sampled around the original text (used for fallback cover). */
  backgroundColor?: string;
  /** For form-field annotations. */
  fieldType?: 'text' | 'checkbox' | 'dropdown';
  fieldName?: string;
  fieldOptions?: string[];
  /** For measure annotations: kind + formatted label. */
  measureKind?: 'distance' | 'area';
}

interface AnnotationsState {
  byPage: Record<number, Annotation[]>;
  selectedId: string | null;
  add: (a: Omit<Annotation, 'id'>) => string;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  clearPage: (pageNumber: number) => void;
  clearAll: () => void;
  select: (id: string | null) => void;
  getAll: () => Annotation[];
}

export const useAnnotations = create<AnnotationsState>((set, get) => ({
  byPage: {},
  selectedId: null,

  add: (a) => {
    const id = generateId();
    const annotation: Annotation = { ...a, id };
    set((s) => {
      const list = s.byPage[a.pageNumber] ?? [];
      return {
        byPage: { ...s.byPage, [a.pageNumber]: [...list, annotation] },
      };
    });
    return id;
  },

  update: (id, patch) => {
    set((s) => {
      const next: Record<number, Annotation[]> = { ...s.byPage };
      for (const page of Object.keys(next)) {
        const idx = next[Number(page)].findIndex((a) => a.id === id);
        if (idx >= 0) {
          const updated = { ...next[Number(page)][idx], ...patch };
          next[Number(page)] = [
            ...next[Number(page)].slice(0, idx),
            updated,
            ...next[Number(page)].slice(idx + 1),
          ];
          break;
        }
      }
      return { byPage: next };
    });
  },

  remove: (id) => {
    set((s) => {
      const next: Record<number, Annotation[]> = {};
      for (const [page, list] of Object.entries(s.byPage)) {
        next[Number(page)] = list.filter((a) => a.id !== id);
      }
      return { byPage: next, selectedId: s.selectedId === id ? null : s.selectedId };
    });
  },

  clearPage: (pageNumber) => {
    set((s) => {
      const next = { ...s.byPage };
      delete next[pageNumber];
      return { byPage: next };
    });
  },

  clearAll: () => set({ byPage: {}, selectedId: null }),
  select: (id) => set({ selectedId: id }),
  getAll: () => {
    const { byPage } = get();
    return Object.values(byPage).flat();
  },
}));
