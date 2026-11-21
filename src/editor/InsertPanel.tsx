import { MaterialIcon } from '../ui/MaterialIcon';
import { Button, Input } from '../ui/primitives';
import { catalog } from './catalog';
import { DragHandle, useDragDrop } from './DragDrop';
import { useSessionState } from './session';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { FragmentPanel } from './FragmentPanel';

export function InsertPanel({
  document,
  snapshot,
  authoringAllowed = false,
}: {
  document?: EditorDocument;
  snapshot?: EditorSnapshot;
  authoringAllowed?: boolean;
} = {}) {
  const [query, setQuery] = useSessionState('materials/query', '');
  const [category, setCategory] = useSessionState<string | null>('materials/category', null);
  const drag = useDragDrop();
  const visibleMaterials = Object.entries(catalog).filter(
    ([, meta]) => meta.insertable !== false && meta.palette !== false,
  );
  const categories = [...new Set(visibleMaterials.map(([, meta]) => meta.category))];
  const activeCategory =
    typeof category === 'string' && categories.includes(category) ? category : null;
  const categoryName = (name: string) => (name.trim() ? name : '未命名分类');
  const normalizedQuery = query.trim().toLowerCase();
  const materials = visibleMaterials.filter(
    ([id, meta]) =>
      (activeCategory === null || meta.category === activeCategory) &&
      `${meta.title} ${meta.category} ${id}`.toLowerCase().includes(normalizedQuery),
  );
  return (
    <div className="insert-panel">
      <div className="panel-search">
        <Input
          aria-label="搜索物料"
          placeholder="搜索名称、分类或组件 ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div role="group" aria-label="物料分类" className="mb-2 flex min-w-0 flex-wrap gap-1">
        <Button
          type="button"
          aria-label="查看全部物料"
          aria-pressed={activeCategory === null}
          variant={activeCategory === null ? 'primary' : 'ghost'}
          className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-normal [overflow-wrap:anywhere]"
          disabled={drag?.isInteracting}
          onClick={() => {
            if (!drag?.isInteracting) setCategory(null);
          }}
        >
          全部
        </Button>
        {categories.map((name) => (
          <Button
            key={name}
            type="button"
            aria-label={`筛选分类：${categoryName(name)}`}
            aria-pressed={activeCategory === name}
            variant={activeCategory === name ? 'primary' : 'ghost'}
            className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-normal [overflow-wrap:anywhere]"
            disabled={drag?.isInteracting}
            onClick={() => {
              if (!drag?.isInteracting) setCategory(name);
            }}
          >
            {categoryName(name)}
          </Button>
        ))}
      </div>
      <div className="material-grid">
        {materials.map(([id, meta]) => (
          <DragHandle
            key={id}
            source={{ kind: 'material', component: id }}
            label={`拖入 ${meta.title}`}
            className="material-tile"
          >
            <span className="material-icon" aria-hidden="true">
              <MaterialIcon name={meta.icon} />
            </span>
            <span className="material-name">{meta.title}</span>
          </DragHandle>
        ))}
      </div>
      {!materials.length && (
        <div>
          <p className="editor-note">
            {activeCategory === null ? '没有匹配的物料' : '当前分类没有匹配的物料'}
          </p>
          {activeCategory !== null && (
            <Button
              type="button"
              variant="ghost"
              disabled={drag?.isInteracting}
              onClick={() => {
                if (!drag?.isInteracting) setCategory(null);
              }}
            >
              查看全部分类
            </Button>
          )}
        </div>
      )}
      {document && snapshot && (
        <FragmentPanel
          document={document}
          snapshot={snapshot}
          authoringAllowed={authoringAllowed}
        />
      )}
    </div>
  );
}
