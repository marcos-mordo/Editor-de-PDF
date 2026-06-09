import { Layers, List, MessageCircle } from 'lucide-react';
import { useTools } from '../../stores/tools';
import { cn } from '../../lib/utils';
import { ThumbnailsPanel } from './ThumbnailsPanel';
import { OutlinePanel } from './OutlinePanel';
import { AnnotationsPanel } from './AnnotationsPanel';

export function Sidebar() {
  const tab = useTools((s) => s.sidebarTab);
  const setTab = useTools((s) => s.setSidebarTab);

  return (
    <div className="flex h-full w-72 flex-col border-r border-page-border bg-page">
      <div className="flex border-b border-page-border bg-page-alt">
        <TabBtn
          icon={<Layers size={15} />}
          label="Páginas"
          active={tab === 'thumbnails'}
          onClick={() => setTab('thumbnails')}
        />
        <TabBtn
          icon={<List size={15} />}
          label="Marcadores"
          active={tab === 'outline'}
          onClick={() => setTab('outline')}
        />
        <TabBtn
          icon={<MessageCircle size={15} />}
          label="Anotaciones"
          active={tab === 'annotations'}
          onClick={() => setTab('annotations')}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'thumbnails' && <ThumbnailsPanel />}
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'annotations' && <AnnotationsPanel />}
      </div>
    </div>
  );
}

function TabBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-b-2 border-amazon-orange bg-page text-ink'
          : 'border-b-2 border-transparent text-ink-secondary hover:bg-page hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
