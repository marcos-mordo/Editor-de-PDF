import { create } from 'zustand';

export type ToolId =
  | 'select'
  | 'hand'
  | 'text'
  | 'image'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'rect'
  | 'circle'
  | 'arrow'
  | 'draw'
  | 'note'
  | 'signature'
  | 'eraser'
  | 'edit-text';

interface ToolsState {
  active: ToolId;
  color: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  fontFamily: string;
  showSidebar: boolean;
  sidebarTab: 'thumbnails' | 'outline' | 'annotations';
  setActive: (tool: ToolId) => void;
  setColor: (c: string) => void;
  setStrokeWidth: (w: number) => void;
  setOpacity: (o: number) => void;
  setFontSize: (s: number) => void;
  setFontFamily: (f: string) => void;
  toggleSidebar: () => void;
  setSidebarTab: (t: ToolsState['sidebarTab']) => void;
}

export const useTools = create<ToolsState>((set) => ({
  active: 'select',
  color: '#fbbf24',
  strokeWidth: 2,
  opacity: 0.45,
  fontSize: 14,
  fontFamily: 'Helvetica',
  showSidebar: true,
  sidebarTab: 'thumbnails',
  setActive: (tool) => set({ active: tool }),
  setColor: (c) => set({ color: c }),
  setStrokeWidth: (w) => set({ strokeWidth: w }),
  setOpacity: (o) => set({ opacity: o }),
  setFontSize: (s) => set({ fontSize: s }),
  setFontFamily: (f) => set({ fontFamily: f }),
  toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),
  setSidebarTab: (t) => set({ sidebarTab: t }),
}));
