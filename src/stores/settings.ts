import { create } from 'zustand';

export type DefaultZoom = 'actual' | 'fit-width' | 'fit-page';

interface Settings {
  /** View applied automatically when a document opens. */
  defaultZoom: DefaultZoom;
  /** Show the page thumbnails sidebar by default. */
  sidebarOnOpen: boolean;
  /** Confirm before closing a document with unsaved changes. */
  confirmOnClose: boolean;
  setDefaultZoom: (z: DefaultZoom) => void;
  setSidebarOnOpen: (v: boolean) => void;
  setConfirmOnClose: (v: boolean) => void;
}

const STORAGE_KEY = 'editor-pdf:settings';

function load(): Pick<
  Settings,
  'defaultZoom' | 'sidebarOnOpen' | 'confirmOnClose'
> {
  const defaults = {
    defaultZoom: 'fit-width' as DefaultZoom,
    sidebarOnOpen: true,
    confirmOnClose: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function persist(s: Partial<Settings>): void {
  try {
    const current = load();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...s }));
  } catch {
    /* ignore */
  }
}

export const useSettings = create<Settings>((set) => ({
  ...load(),
  setDefaultZoom: (z) => {
    persist({ defaultZoom: z });
    set({ defaultZoom: z });
  },
  setSidebarOnOpen: (v) => {
    persist({ sidebarOnOpen: v });
    set({ sidebarOnOpen: v });
  },
  setConfirmOnClose: (v) => {
    persist({ confirmOnClose: v });
    set({ confirmOnClose: v });
  },
}));
