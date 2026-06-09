import { create } from 'zustand';
import { useDocument } from './document';
import { useAnnotations, type Annotation } from './annotations';

interface Snapshot {
  pagesOrder: number[];
  pageRotations: Record<number, number>;
  annotations: Record<number, Annotation[]>;
}

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  setStacks: (past: Snapshot[], future: Snapshot[]) => void;
  clear: () => void;
}

const MAX_HISTORY = 100;

export const useHistory = create<HistoryState>((set) => ({
  past: [],
  future: [],
  setStacks: (past, future) => set({ past, future }),
  clear: () => set({ past: [], future: [] }),
}));

function capture(): Snapshot {
  const doc = useDocument.getState().doc;
  const annStore = useAnnotations.getState();
  return {
    pagesOrder: doc ? [...doc.pagesOrder] : [],
    pageRotations: doc ? { ...doc.pageRotations } : {},
    annotations: structuredClone(annStore.byPage),
  };
}

/**
 * Snapshots the current state BEFORE a mutation. Call this in component
 * handlers right before invoking a store action (rotate, reorder, delete,
 * add/update/remove annotation, etc.). Clears the redo stack — once you
 * make a new change, the previously undone actions are no longer
 * recoverable, which matches what users expect from undo/redo.
 */
export function pushHistory(): void {
  const snap = capture();
  const { past } = useHistory.getState();
  const newPast = [...past, snap];
  if (newPast.length > MAX_HISTORY) newPast.shift();
  useHistory.setState({ past: newPast, future: [] });
}

function applySnapshot(snap: Snapshot): void {
  const doc = useDocument.getState().doc;
  if (doc) {
    useDocument.setState({
      doc: {
        ...doc,
        pagesOrder: snap.pagesOrder,
        pageRotations: snap.pageRotations,
        isDirty: true,
      },
    });
  }
  useAnnotations.setState({ byPage: snap.annotations, selectedId: null });
}

export function undo(): boolean {
  const { past, future } = useHistory.getState();
  if (past.length === 0) return false;
  const current = capture();
  const previous = past[past.length - 1];
  useHistory.setState({
    past: past.slice(0, -1),
    future: [...future, current].slice(-MAX_HISTORY),
  });
  applySnapshot(previous);
  return true;
}

export function redo(): boolean {
  const { past, future } = useHistory.getState();
  if (future.length === 0) return false;
  const current = capture();
  const next = future[future.length - 1];
  useHistory.setState({
    past: [...past, current].slice(-MAX_HISTORY),
    future: future.slice(0, -1),
  });
  applySnapshot(next);
  return true;
}
