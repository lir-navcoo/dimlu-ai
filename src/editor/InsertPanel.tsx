import { useLayoutEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
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
  const categoriesRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(categories.length);
  const categoryKey = categories.join('\u0000');
  useLayoutEffect(() => {
    const row = categoriesRef.current;
    const mirror = measureRef.current;
    if (!row || !mirror) return;
    const measure = () => {
      const widths = Array.from(mirror.querySelectorAll<HTMLElement>('button')).map(
        (button) => button.getBoundingClientRect().width,
      );
      if (!widths.length) return;
      const available = row.clientWidth;
      const gap = 4;
      const fullWidth = widths.reduce((sum, width) => sum + width + gap, 0) - gap;
      if (fullWidth <= available) {
        setVisibleCount(categories.length);
        return;
      }
      let used = 0;
      let count = 0;
      for (let index = 0; index < widths.length; index += 1) {
        const next = used + widths[index] + (index ? gap : 0);
        const reserve = index < widths.length - 1 ? 48 : 0;
        if (next + reserve > available) break;
        used = next;
        count = index + 1;
      }
      setVisibleCount(Math.max(0, count - 1));
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(row);
    return () => observer?.disconnect();
    // categoryKey changes only when the available categories change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey]);
  const visibleCategories = categories.slice(0, visibleCount);
  const hiddenCategories = categories.slice(visibleCount);
  const materials = visibleMaterials.filter(
    ([id, meta]) =>
      (activeCategory === null || meta.category === activeCategory) &&
      `${meta.title} ${meta.category} ${id}`.toLowerCase().includes(normalizedQuery),
  );
  return (
    <div className="insert-panel">
      <div className="panel-search material-search">
        <Search size={14} aria-hidden="true" />
        <Input
          aria-label="搜索物料"
          placeholder="搜索名称、分类或组件 ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div ref={categoriesRef} role="group" aria-label="物料分类" className="material-categories">
        <Button
          type="button"
          aria-label="查看全部物料"
          aria-pressed={activeCategory === null}
          variant={activeCategory === null ? 'primary' : 'ghost'}
          className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap"
          disabled={drag?.isInteracting}
          onClick={() => {
            if (!drag?.isInteracting) setCategory(null);
          }}
        >
          全部
        </Button>
        {visibleCategories.map((name) => (
          <Button
            key={name}
            type="button"
            aria-label={`筛选分类：${categoryName(name)}`}
            aria-pressed={activeCategory === name}
            variant={activeCategory === name ? 'primary' : 'ghost'}
            className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap"
            disabled={drag?.isInteracting}
            onClick={() => {
              if (!drag?.isInteracting) setCategory(name);
            }}
          >
            {categoryName(name)}
          </Button>
        ))}
        {hiddenCategories.length > 0 && (
          <select
            className="material-more-select"
            aria-label="更多物料分类"
            value={
              activeCategory && hiddenCategories.includes(activeCategory) ? activeCategory : ''
            }
            disabled={drag?.isInteracting}
            onChange={(event) => setCategory(event.target.value || null)}
          >
            <option value="">更多</option>
            {hiddenCategories.map((name) => (
              <option key={name} value={name}>
                {categoryName(name)}
              </option>
            ))}
          </select>
        )}
        <div ref={measureRef} className="material-categories-measure" aria-hidden="true">
          <Button
            type="button"
            tabIndex={-1}
            className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap"
          >
            全部
          </Button>
          {categories.map((name) => (
            <Button
              key={name}
              type="button"
              tabIndex={-1}
              className="h-auto min-h-6 min-w-0 max-w-full px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap"
            >
              {categoryName(name)}
            </Button>
          ))}
        </div>
      </div>
      {categories.map((name) => {
        const group = materials.filter(([, meta]) => meta.category === name);
        if (!group.length) return null;
        return (
          <section className="material-group" key={name}>
            <h3>{categoryName(name)}</h3>
            <div className="material-grid">
              {group.map(([id, meta]) => (
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
          </section>
        );
      })}
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
