import { create } from 'zustand';
import type { MeasureUnit } from '../features/measure/measure';

interface MeasureState {
  unit: MeasureUnit;
  /** Drawing scale: real units represented per page unit (1 = true size). */
  scale: number;
  setUnit: (u: MeasureUnit) => void;
  setScale: (s: number) => void;
}

export const useMeasure = create<MeasureState>((set) => ({
  unit: 'cm',
  scale: 1,
  setUnit: (u) => set({ unit: u }),
  setScale: (s) => set({ scale: s > 0 ? s : 1 }),
}));
