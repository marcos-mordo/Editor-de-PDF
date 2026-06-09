import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useDocument } from '../../stores/document';

interface OutlineNode {
  title: string;
  pageIndex?: number;
  items: OutlineNode[];
}

export function OutlinePanel() {
  const doc = useDocument((s) => s.doc);
  const setCurrentPage = useDocument((s) => s.setCurrentPage);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doc) {
        setOutline(null);
        return;
      }
      try {
        const raw = (await doc.proxy.getOutline()) as any[] | null;
        if (!raw) {
          setOutline([]);
          return;
        }
        const parsed: OutlineNode[] = await Promise.all(
          raw.map((n: any) => parseNode(n, doc.proxy)),
        );
        if (!cancelled) setOutline(parsed);
      } catch {
        if (!cancelled) setOutline([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (!doc) {
    return (
      <div className="p-4 text-center text-sm text-ink-secondary">
        Abre un PDF para ver sus marcadores.
      </div>
    );
  }
  if (!outline) {
    return <div className="p-4 text-sm text-ink-secondary">Cargando…</div>;
  }
  if (outline.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-ink-secondary">
        Este PDF no tiene marcadores.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2 text-sm">
      {outline.map((node, i) => (
        <OutlineRow
          key={i}
          node={node}
          path={String(i)}
          depth={0}
          expanded={expanded}
          toggle={(path) => {
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
          onGo={(p) => setCurrentPage(p)}
        />
      ))}
    </div>
  );
}

function OutlineRow({
  node,
  path,
  depth,
  expanded,
  toggle,
  onGo,
}: {
  node: OutlineNode;
  path: string;
  depth: number;
  expanded: Set<string>;
  toggle: (p: string) => void;
  onGo: (page: number) => void;
}) {
  const isOpen = expanded.has(path);
  return (
    <>
      <div
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-ink hover:bg-page-alt"
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => {
          if (node.pageIndex !== undefined) onGo(node.pageIndex + 1);
        }}
      >
        {node.items.length > 0 ? (
          <button
            className="text-ink-secondary hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              toggle(path);
            }}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <span className="truncate">{node.title}</span>
      </div>
      {isOpen &&
        node.items.map((child, i) => (
          <OutlineRow
            key={i}
            node={child}
            path={`${path}.${i}`}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onGo={onGo}
          />
        ))}
    </>
  );
}

async function parseNode(node: any, proxy: any): Promise<OutlineNode> {
  let pageIndex: number | undefined;
  try {
    if (node.dest) {
      const dest =
        typeof node.dest === 'string' ? await proxy.getDestination(node.dest) : node.dest;
      if (Array.isArray(dest) && dest[0]) {
        pageIndex = await proxy.getPageIndex(dest[0]);
      }
    }
  } catch {
    /* ignore */
  }
  const items: OutlineNode[] = await Promise.all(
    (node.items ?? []).map((c: any) => parseNode(c, proxy)),
  );
  return { title: node.title || 'Sin título', pageIndex, items };
}
