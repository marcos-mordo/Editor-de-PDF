import { create } from 'zustand';

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

const STORAGE_KEY = 'editor-pdf:recent-files';
const MAX_RECENT = 10;

function load(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x &&
        typeof x.path === 'string' &&
        typeof x.name === 'string' &&
        typeof x.openedAt === 'number',
    );
  } catch {
    return [];
  }
}

function save(items: RecentFile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    /* quota or disabled */
  }
}

interface RecentState {
  items: RecentFile[];
  add: (path: string, name: string) => void;
  clear: () => void;
}

export const useRecent = create<RecentState>((set, get) => ({
  items: load(),
  add: (path, name) => {
    if (!path) return;
    const items = get().items.filter((x) => x.path !== path);
    const next = [{ path, name, openedAt: Date.now() }, ...items].slice(0, MAX_RECENT);
    save(next);
    set({ items: next });
  },
  clear: () => {
    save([]);
    set({ items: [] });
  },
}));
