import { useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Button, Checkbox, Select, Tip } from '../ui/primitives';
import { runtimePortalContainer, useRuntimeDomEnvironment } from '../ui/runtime-dom';
import {
  useDesignMode,
  useHasSlot,
  materialStyleTarget,
  type SlotRenderers,
} from '../../packages/react-runtime/Renderer';
import {
  boolProp,
  textProp,
  numberProp,
  arrayProp,
  jsonProp,
  requiredText,
  displayValue,
  enumErrors,
  readData,
  record,
  rowsErrors,
  useMaterialValue,
  validKey,
  type Contracts,
} from './shared';

export function safeHref(href: unknown) {
  if (typeof href !== 'string' || /[\u0000-\u001f\u007f]/.test(href)) return false;
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(
      new URL(href, 'https://local.invalid').protocol,
    );
  } catch {
    return false;
  }
}
export function LinkMaterial({
  label,
  href,
  newTab = false,
  onClick,
  style,
}: {
  style?: React.CSSProperties;
  label: string;
  href: string;
  newTab?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      className="material-link"
      style={style}
      {...materialStyleTarget(style)}
      href={safeHref(href) ? href : undefined}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      onClick={onClick}
    >
      {label}
    </a>
  );
}
export function ImageMaterial({
  src,
  alt = '图片',
  width = 240,
  height = 160,
  fit = 'cover',
  preview = false,
  style,
}: {
  style?: React.CSSProperties;
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill';
  preview?: boolean;
}) {
  const [failed, setFailed] = useState('');
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  const image =
    !src || failed === src ? (
      <div className="material-image-placeholder" role="img" aria-label={alt}>
        <ImageOff size={22} />
        <span>{src ? '图片加载失败' : '请选择图片'}</span>
      </div>
    ) : (
      <img src={src} alt={alt} onError={() => setFailed(src)} style={{ objectFit: fit }} />
    );
  return (
    <div
      className="material-image"
      style={{ width, maxWidth: '100%', height, ...style }}
      {...materialStyleTarget(style)}
    >
      {preview && src && failed !== src ? (
        <Dialog.Root>
          <Dialog.Trigger className="material-image-trigger" aria-label={`预览${alt}`}>
            {image}
          </Dialog.Trigger>
          <Dialog.Portal container={container}>
            <Dialog.Backdrop className="material-modal-backdrop" />
            <Dialog.Popup className="material-modal material-image-preview">
              <Dialog.Title>{alt}</Dialog.Title>
              <img src={src} alt={alt} />
              <Dialog.Close className="ui-button">关闭</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        image
      )}
    </div>
  );
}
export function DescriptionsMaterial({
  items,
  columns = 2,
  bordered = true,
  style,
}: {
  style?: React.CSSProperties;
  items: { label: string; value: unknown }[];
  columns?: number;
  bordered?: boolean;
}) {
  return (
    <dl
      className={`material-descriptions ${bordered ? 'bordered' : ''}`}
      style={{ '--description-columns': columns, ...style } as React.CSSProperties}
      {...materialStyleTarget(style)}
    >
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.label}</dt>
          <dd>{displayValue(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function DataStatus({
  loading,
  error,
  empty,
  children,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  if (loading)
    return (
      <div className="material-data-status" role="status">
        <span className="material-spinner" />
        正在加载…
      </div>
    );
  if (error)
    return (
      <div className="material-data-status" role="alert">
        {error}
        {onRetry && <Button onClick={onRetry}>重试</Button>}
      </div>
    );
  if (empty) return <div className="material-data-status">暂无数据</div>;
  return children;
}
export function ListMaterial({
  data,
  rowKey = 'id',
  columns = 1,
  loading,
  error,
  slots = {},
  onRetry,
  style,
}: {
  data: Record<string, unknown>[];
  style?: React.CSSProperties;
  rowKey?: string;
  columns?: number;
  loading?: boolean;
  error?: string;
  slots?: SlotRenderers;
  onRetry?: () => void;
}) {
  const hasItem = useHasSlot('item', slots),
    design = useDesignMode();
  return (
    <div
      className="material-data-list"
      style={style}
      {...materialStyleTarget(style)}
      aria-busy={loading || undefined}
    >
      <DataStatus loading={loading} error={error} empty={!data.length} onRetry={onRetry}>
        <div
          className="material-list-grid"
          style={{ '--list-columns': columns } as React.CSSProperties}
        >
          {data.map((item, index) => (
            <article
              className="material-list-item"
              key={`${typeof readData(item, rowKey)}:${readData(item, rowKey)}`}
            >
              {hasItem ? (
                slots.item?.(
                  { item, index },
                  `${typeof readData(item, rowKey)}:${readData(item, rowKey)}`,
                )
              ) : (
                <>
                  <strong>{displayValue(item.title ?? readData(item, rowKey))}</strong>
                  <p>{displayValue(item.description ?? item)}</p>
                  {design &&
                    index === 0 &&
                    slots.item?.(
                      { item, index },
                      `${typeof readData(item, rowKey)}:${readData(item, rowKey)}`,
                    )}
                </>
              )}
            </article>
          ))}
        </div>
      </DataStatus>
    </div>
  );
}
export function PaginationMaterial({
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  onPageSizeChange,
  onPaginationChange,
  disabled = false,
  showSizeChanger = true,
  style,
}: {
  style?: React.CSSProperties;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onPaginationChange?: (pagination: { page: number; pageSize: number }) => void;
  disabled?: boolean;
  showSizeChanger?: boolean;
}) {
  const [current, change] = useMaterialValue(
      page,
      onPaginationChange ? (next) => onPaginationChange({ page: next, pageSize }) : onPageChange,
    ),
    [size, changeSize] = useMaterialValue(
      pageSize,
      onPaginationChange
        ? (next) => onPaginationChange({ page: 1, pageSize: next })
        : onPageSizeChange,
    );
  const pages = Math.max(1, Math.ceil(total / size)),
    active = Math.min(pages, Math.max(1, current));
  const start = Math.max(1, Math.min(active - 2, pages - 4)),
    numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <nav
      className="material-pagination"
      style={style}
      {...materialStyleTarget(style)}
      aria-label="数据分页"
    >
      <span>共 {total} 条</span>
      <Tip content="上一页">
        <Button
          aria-label="上一页"
          disabled={disabled || active === 1}
          onClick={() => change(active - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
      </Tip>
      {numbers.map((number) => (
        <Button
          key={number}
          aria-label={`第 ${number} 页`}
          aria-current={number === active ? 'page' : undefined}
          disabled={disabled}
          onClick={() => change(number)}
        >
          {number}
        </Button>
      ))}
      <Tip content="下一页">
        <Button
          aria-label="下一页"
          disabled={disabled || active === pages}
          onClick={() => change(active + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </Tip>
      <span>
        {active} / {pages} 页
      </span>
      {showSizeChanger && (
        <Select
          aria-label="每页条数"
          value={String(size)}
          disabled={disabled}
          onValueChange={(next) => {
            changeSize(Number(next));
            if (!onPaginationChange) change(1);
          }}
        >
          {[...new Set([size, 10, 20, 50, 100])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={String(n)}>
                {n} 条 / 页
              </option>
            ))}
        </Select>
      )}
    </nav>
  );
}
type Column = {
  key: string;
  title: string;
  width?: number;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
};
type Sort = { key: string; direction: 'asc' | 'desc' } | null;
type Row = Record<string, unknown>;
export function TableMaterial({
  data,
  columns,
  rowKey = 'id',
  loading,
  error,
  selectionMode = 'none',
  selectedKeys = [],
  onSelectionChange,
  sort = null,
  sortMode = 'client',
  onSortChange,
  pageSize = 10,
  paginate = true,
  onRowClick,
  onRetry,
  slots = {},
  style,
}: {
  data: Row[];
  style?: React.CSSProperties;
  columns: Column[];
  rowKey?: string;
  loading?: boolean;
  error?: string;
  selectionMode?: 'none' | 'single' | 'multiple';
  selectedKeys?: (string | number)[];
  onSelectionChange?: (keys: (string | number)[]) => void;
  sort?: Sort;
  sortMode?: 'client' | 'server';
  onSortChange?: (sort: Sort) => void;
  pageSize?: number;
  paginate?: boolean;
  onRowClick?: (row: Row) => void;
  onRetry?: () => void;
  slots?: SlotRenderers;
}) {
  const hasCell = useHasSlot('cell', slots),
    hasActions = useHasSlot('actions', slots),
    design = useDesignMode();
  const [selected, changeSelected] = useMaterialValue(selectedKeys, onSelectionChange),
    [order, changeSort] = useMaterialValue(sort, onSortChange);
  const [page, setPage] = useState(1);
  const ordered = data.map((row, index) => ({ row, index }));
  if (order && sortMode === 'client')
    ordered.sort((a, b) => {
      const av = readData(a.row, order.key),
        bv = readData(b.row, order.key);
      const compared =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN', { numeric: true });
      return (order.direction === 'asc' ? compared : -compared) || a.index - b.index;
    });
  const current = Math.min(page, Math.max(1, Math.ceil(data.length / pageSize)));
  const visible = paginate ? ordered.slice((current - 1) * pageSize, current * pageSize) : ordered;
  const keys = visible.map(({ row }) => readData(row, rowKey) as string | number);
  const all = !!keys.length && keys.every((key) => selected.some((v) => Object.is(v, key)));
  const toggle = (key: string | number) =>
    changeSelected(
      selectionMode === 'single'
        ? selected.some((v) => Object.is(v, key))
          ? []
          : [key]
        : selected.some((v) => Object.is(v, key))
          ? selected.filter((v) => !Object.is(v, key))
          : [...selected, key],
    );
  return (
    <div
      className="material-table"
      style={style}
      {...materialStyleTarget(style)}
      aria-busy={loading || undefined}
    >
      <DataStatus loading={loading} error={error} empty={!data.length} onRetry={onRetry}>
        <div className="material-table-scroll">
          <table>
            <thead>
              <tr>
                {selectionMode !== 'none' && (
                  <th className="material-selection-cell">
                    {selectionMode === 'multiple' && (
                      <Checkbox
                        aria-label="选择当前页全部行"
                        checked={all}
                        indeterminate={!all && keys.some((key) => selected.includes(key))}
                        onCheckedChange={() =>
                          changeSelected(
                            all
                              ? selected.filter((v) => !keys.includes(v))
                              : [...selected, ...keys.filter((v) => !selected.includes(v))],
                          )
                        }
                      />
                    )}
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{ width: column.width, textAlign: column.align }}
                    aria-sort={
                      order?.key === column.key
                        ? order.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {column.sortable ? (
                      <Button
                        variant="ghost"
                        aria-label={`排序${column.title}`}
                        onClick={() => {
                          changeSort(
                            order?.key !== column.key
                              ? { key: column.key, direction: 'asc' }
                              : order.direction === 'asc'
                                ? { key: column.key, direction: 'desc' }
                                : null,
                          );
                          setPage(1);
                        }}
                      >
                        {column.title}
                        {order?.key === column.key ? (
                          order.direction === 'asc' ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : null}
                      </Button>
                    ) : (
                      column.title
                    )}
                  </th>
                ))}
                {(hasActions || onRowClick || (design && slots.actions)) && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, index }) => {
                const key = readData(row, rowKey) as string | number;
                return (
                  <tr
                    key={`${typeof key}:${key}`}
                    data-row-key={`${typeof key}:${key}`}
                    data-selected={selected.includes(key) || undefined}
                  >
                    {selectionMode !== 'none' && (
                      <td>
                        <Checkbox
                          aria-label={`选择行 ${key}`}
                          checked={selected.some((v) => Object.is(v, key))}
                          onCheckedChange={() => toggle(key)}
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td key={column.key} style={{ textAlign: column.align }}>
                        {hasCell ? (
                          slots.cell?.(
                            { row, column, value: readData(row, column.key) ?? null, index },
                            `${typeof key}:${key}/${column.key}`,
                          )
                        ) : (
                          <>
                            {displayValue(readData(row, column.key))}
                            {design &&
                              index === 0 &&
                              column === columns[0] &&
                              slots.cell?.(
                                { row, column, value: readData(row, column.key) ?? null, index },
                                `${typeof key}:${key}/${column.key}`,
                              )}
                          </>
                        )}
                      </td>
                    ))}
                    {(hasActions || onRowClick || (design && slots.actions)) && (
                      <td>
                        {hasActions ? (
                          slots.actions?.({ row, index }, `${typeof key}:${key}`)
                        ) : onRowClick ? (
                          <Button onClick={() => onRowClick(row)}>查看</Button>
                        ) : index === 0 ? (
                          slots.actions?.({ row, index }, `${typeof key}:${key}`)
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paginate && (
          <PaginationMaterial
            total={data.length}
            page={current}
            pageSize={pageSize}
            onPageChange={setPage}
            showSizeChanger={false}
          />
        )}
      </DataStatus>
    </div>
  );
}
const dataProps = {
  data: { ...arrayProp, required: true },
  rowKey: textProp,
  loading: boolProp,
  error: textProp,
};
function columnErrors(props: Readonly<Record<string, unknown>>) {
  if (!('columns' in props)) return [];
  if (
    !Array.isArray(props.columns) ||
    !props.columns.length ||
    props.columns.some(
      (c) =>
        !record(c) ||
        typeof c.key !== 'string' ||
        !c.key.trim() ||
        c.key
          .split('.')
          .some((part) => ['__proto__', 'constructor', 'prototype', ''].includes(part)) ||
        typeof c.title !== 'string' ||
        !c.title.trim() ||
        (c.width !== undefined && (typeof c.width !== 'number' || c.width < 24)) ||
        (c.sortable !== undefined && typeof c.sortable !== 'boolean') ||
        (c.align !== undefined && !['left', 'center', 'right'].includes(String(c.align))),
    ) ||
    new Set(props.columns.map((c) => c.key)).size !== props.columns.length
  )
    return ['列需包含唯一 key 和 title，可配置 width、sortable、align'];
  return [];
}
function positiveInteger(props: Readonly<Record<string, unknown>>, keys: string[], max = 1000) {
  return keys.flatMap((key) =>
    key in props &&
    (!Number.isInteger(props[key]) || Number(props[key]) < 1 || Number(props[key]) > max)
      ? [`${key} 必须为 1 到 ${max} 的整数`]
      : [],
  );
}
export const dataContracts: Contracts = {
  'ui.image': {
    version: '1.0.0',
    props: {
      src: requiredText,
      alt: textProp,
      width: numberProp,
      height: numberProp,
      fit: textProp,
      preview: boolProp,
    },
    validateProps: (props) => [
      ...enumErrors(props, { fit: ['cover', 'contain', 'fill'] }),
      ...positiveInteger(props, ['width', 'height'], 4000),
      ...('src' in props &&
      props.src !== '' &&
      !safeHref(props.src) &&
      !(
        typeof props.src === 'string' &&
        /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);/.test(props.src)
      )
        ? ['图片地址无效']
        : []),
    ],
  },
  'ui.link': {
    version: '1.0.0',
    props: { label: requiredText, href: requiredText, newTab: boolProp },
    events: ['onClick'],
    validateProps: (props) =>
      'href' in props && !safeHref(props.href)
        ? ['链接地址仅支持 http、https、mailto、tel 或相对地址']
        : [],
  },
  'ui.descriptions': {
    version: '1.0.0',
    props: { items: { ...arrayProp, required: true }, columns: numberProp, bordered: boolProp },
    validateProps: (props) => [
      ...positiveInteger(props, ['columns'], 4),
      ...('items' in props &&
      (!Array.isArray(props.items) ||
        props.items.some(
          (item) => !record(item) || typeof item.label !== 'string' || !('value' in item),
        ))
        ? ['详情项需包含 label 和 value']
        : []),
    ],
  },
  'ui.list': {
    version: '1.0.0',
    props: { ...dataProps, columns: numberProp },
    slots: { item: ['item', 'index'] },
    events: ['onRetry'],
    validateProps: (props) => [
      ...rowsErrors({ rowKey: 'id', ...props }),
      ...positiveInteger(props, ['columns'], 4),
    ],
  },
  'ui.pagination': {
    version: '1.0.0',
    props: {
      page: numberProp,
      pageSize: numberProp,
      total: numberProp,
      disabled: boolProp,
      showSizeChanger: boolProp,
    },
    events: ['onPageChange', 'onPageSizeChange', 'onPaginationChange'],
    validateProps: (props) => [
      ...positiveInteger(props, ['page', 'pageSize'], 1000000),
      ...('total' in props && (!Number.isInteger(props.total) || Number(props.total) < 0)
        ? ['总条数必须为非负整数']
        : []),
    ],
  },
  'ui.table': {
    version: '1.0.0',
    props: {
      ...dataProps,
      columns: { ...arrayProp, required: true },
      selectionMode: textProp,
      selectedKeys: arrayProp,
      sort: jsonProp,
      sortMode: textProp,
      pageSize: numberProp,
      paginate: boolProp,
    },
    events: ['onSelectionChange', 'onSortChange', 'onRowClick', 'onRetry'],
    slots: { cell: ['row', 'column', 'value', 'index'], actions: ['row', 'index'] },
    validateProps: (props) => [
      ...rowsErrors({ rowKey: 'id', ...props }),
      ...columnErrors(props),
      ...positiveInteger(props, ['pageSize']),
      ...enumErrors(props, {
        selectionMode: ['none', 'single', 'multiple'],
        sortMode: ['client', 'server'],
      }),
      ...('selectedKeys' in props &&
      (!Array.isArray(props.selectedKeys) ||
        !props.selectedKeys.every(validKey) ||
        new Set(props.selectedKeys).size !== props.selectedKeys.length)
        ? ['选中行必须为不重复的文本或数字 key 数组']
        : []),
      ...('sort' in props &&
      props.sort !== null &&
      (!record(props.sort) ||
        typeof props.sort.key !== 'string' ||
        !['asc', 'desc'].includes(String(props.sort.direction)))
        ? ['排序需为 null 或 { key, direction: asc/desc }']
        : []),
    ],
  },
};
