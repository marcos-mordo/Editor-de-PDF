import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace as ReplaceIcon,
  CheckCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useDocument } from '../../stores/document';
import { useAnnotations } from '../../stores/annotations';
import { pushHistory } from '../../stores/history';

interface Match {
  pageNumber: number;
  /** PDF coords */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Original text item bounds (whole item, possibly more than the match) */
  itemX: number;
  itemY: number;
  itemWidth: number;
  itemHeight: number;
  fontSize: number;
  /** The actual matched text */
  text: string;
  /** Full item text */
  itemText: string;
  /** Character offset of match in item */
  startInItem: number;
}

interface SearchState {
  open: boolean;
  query: string;
  replaceWith: string;
  matches: Match[];
  currentIdx: number;
  caseSensitive: boolean;
  setOpen: (v: boolean) => void;
  setQuery: (v: string) => void;
  setReplaceWith: (v: string) => void;
  setMatches: (m: Match[]) => void;
  setCurrentIdx: (i: number) => void;
  setCaseSensitive: (v: boolean) => void;
  reset: () => void;
}

export const useSearch = create<SearchState>((set) => ({
  open: false,
  query: '',
  replaceWith: '',
  matches: [],
  currentIdx: 0,
  caseSensitive: false,
  setOpen: (v) => set({ open: v, ...(v ? {} : { matches: [], currentIdx: 0 }) }),
  setQuery: (v) => set({ query: v }),
  setReplaceWith: (v) => set({ replaceWith: v }),
  setMatches: (m) => set({ matches: m, currentIdx: 0 }),
  setCurrentIdx: (i) => set({ currentIdx: i }),
  setCaseSensitive: (v) => set({ caseSensitive: v }),
  reset: () => set({ matches: [], currentIdx: 0 }),
}));

async function runSearch(
  query: string,
  caseSensitive: boolean,
): Promise<Match[]> {
  const doc = useDocument.getState().doc;
  if (!doc || !query) return [];
  const haystack = caseSensitive ? null : query.toLowerCase();
  const matches: Match[] = [];
  for (const origPage of doc.pagesOrder) {
    const page = await doc.proxy.getPage(origPage);
    const tc = await page.getTextContent();
    for (const item of tc.items as any[]) {
      if (!item.str || !item.transform) continue;
      const itemStr = item.str;
      const search = caseSensitive ? itemStr : itemStr.toLowerCase();
      const needle = caseSensitive ? query : haystack!;
      let idx = 0;
      while ((idx = search.indexOf(needle, idx)) !== -1) {
        // Estimate bounds of the matched substring within the item
        const fontH = item.height ?? 12;
        const totalLen = itemStr.length || 1;
        const xPerChar = (item.width ?? 0) / totalLen;
        const matchX = item.transform[4] + xPerChar * idx;
        const matchY = item.transform[5];
        const matchW = xPerChar * needle.length;
        matches.push({
          pageNumber: origPage,
          x: matchX,
          y: matchY,
          width: matchW,
          height: fontH,
          itemX: item.transform[4],
          itemY: item.transform[5],
          itemWidth: item.width ?? 0,
          itemHeight: fontH,
          fontSize: fontH,
          text: itemStr.substr(idx, needle.length),
          itemText: itemStr,
          startInItem: idx,
        });
        idx += needle.length;
      }
    }
  }
  return matches;
}

function scrollToMatch(m: Match) {
  // Find the page wrapper by data-page-number and scroll it into view
  const doc = useDocument.getState().doc;
  if (!doc) return;
  const displayIdx = doc.pagesOrder.indexOf(m.pageNumber);
  if (displayIdx < 0) return;
  const el = document.querySelector(
    `[data-page-number="${m.pageNumber}"][data-display-index="${displayIdx}"]`,
  );
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  useDocument.getState().setCurrentPage(displayIdx + 1);
}

export function FindPanel() {
  const {
    open,
    query,
    replaceWith,
    matches,
    currentIdx,
    caseSensitive,
    setOpen,
    setQuery,
    setReplaceWith,
    setMatches,
    setCurrentIdx,
    setCaseSensitive,
  } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const addAnnotation = useAnnotations((s) => s.add);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  async function doSearch() {
    if (!query) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const results = await runSearch(query, caseSensitive);
      setMatches(results);
      if (results.length > 0) {
        scrollToMatch(results[0]);
      } else {
        toast(`Sin resultados para "${query}"`, { icon: '🔍' });
      }
    } finally {
      setSearching(false);
    }
  }

  function next() {
    if (matches.length === 0) return;
    const i = (currentIdx + 1) % matches.length;
    setCurrentIdx(i);
    scrollToMatch(matches[i]);
  }
  function prev() {
    if (matches.length === 0) return;
    const i = (currentIdx - 1 + matches.length) % matches.length;
    setCurrentIdx(i);
    scrollToMatch(matches[i]);
  }

  function replaceCurrent() {
    if (matches.length === 0) return;
    const m = matches[currentIdx];
    pushHistory();
    // Cover the matched area with white
    addAnnotation({
      type: 'rect',
      pageNumber: m.pageNumber,
      x: m.x - 1,
      y: m.y - 1,
      width: m.width + 2,
      height: m.height + 2,
      color: '#FFFFFF',
      opacity: 1,
      strokeWidth: 0,
    });
    if (replaceWith) {
      addAnnotation({
        type: 'text',
        pageNumber: m.pageNumber,
        x: m.x,
        y: m.y,
        width: Math.max(m.width, replaceWith.length * m.fontSize * 0.55),
        height: m.fontSize + 4,
        color: '#000000',
        opacity: 1,
        text: replaceWith,
        fontSize: m.fontSize,
        fontFamily: 'Helvetica',
      });
    }
    // Remove the replaced match from list and advance
    const newMatches = matches.filter((_, i) => i !== currentIdx);
    setMatches(newMatches);
    if (newMatches.length > 0) {
      setCurrentIdx(currentIdx % newMatches.length);
      scrollToMatch(newMatches[currentIdx % newMatches.length]);
    }
    toast.success('Reemplazado');
  }

  function replaceAll() {
    if (matches.length === 0) return;
    pushHistory();
    for (const m of matches) {
      addAnnotation({
        type: 'rect',
        pageNumber: m.pageNumber,
        x: m.x - 1,
        y: m.y - 1,
        width: m.width + 2,
        height: m.height + 2,
        color: '#FFFFFF',
        opacity: 1,
        strokeWidth: 0,
      });
      if (replaceWith) {
        addAnnotation({
          type: 'text',
          pageNumber: m.pageNumber,
          x: m.x,
          y: m.y,
          width: Math.max(m.width, replaceWith.length * m.fontSize * 0.55),
          height: m.fontSize + 4,
          color: '#000000',
          opacity: 1,
          text: replaceWith,
          fontSize: m.fontSize,
          fontFamily: 'Helvetica',
        });
      }
    }
    const count = matches.length;
    setMatches([]);
    toast.success(`${count} reemplazos hechos`);
  }

  if (!open) return null;

  return (
    <div className="absolute right-3 top-3 z-30 w-80 rounded-lg border border-page-border bg-page shadow-2xl">
      <div className="flex items-center justify-between border-b border-page-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Search size={14} className="text-amazon-orange" />
          Buscar y reemplazar
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-ink-secondary hover:bg-page-alt hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            className="input pr-10"
            value={query}
            placeholder="Buscar..."
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) prev();
                else if (matches.length > 0 && query === '') doSearch();
                else if (matches.length === 0) doSearch();
                else next();
              }
            }}
          />
          {searching && (
            <div className="absolute right-2 top-2 h-5 w-5 animate-spin rounded-full border-2 border-amazon-orange border-t-transparent" />
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <label className="flex items-center gap-1 text-ink-secondary">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Distinguir mayúsculas
          </label>
          {matches.length > 0 ? (
            <span className="font-medium text-ink">
              {currentIdx + 1} / {matches.length}
            </span>
          ) : query && !searching ? (
            <span className="text-ink-muted">Sin resultados</span>
          ) : (
            <span className="text-ink-muted">&nbsp;</span>
          )}
        </div>

        <div className="flex gap-1">
          <button
            className="btn-secondary flex-1"
            onClick={doSearch}
            disabled={!query || searching}
          >
            <Search size={14} />
            Buscar
          </button>
          <button
            className="btn-secondary"
            onClick={prev}
            disabled={matches.length === 0}
            title="Anterior (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            className="btn-secondary"
            onClick={next}
            disabled={matches.length === 0}
            title="Siguiente (Enter)"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="border-t border-page-border pt-2">
          <input
            type="text"
            className="input mb-2"
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="Reemplazar con..."
          />
          <div className="flex gap-1">
            <button
              className="btn-secondary flex-1"
              onClick={replaceCurrent}
              disabled={matches.length === 0}
            >
              <ReplaceIcon size={14} />
              Reemplazar
            </button>
            <button
              className="btn-primary flex-1"
              onClick={replaceAll}
              disabled={matches.length === 0}
            >
              <CheckCheck size={14} />
              Todos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
