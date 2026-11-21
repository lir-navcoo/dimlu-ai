import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select, Tip } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import type { ReactSetterProps } from './Setters';
import { DraftNotice, useDraft } from './session';
import { errorText } from './errors';
import {
  canRepresentColumns,
  columnField,
  columnValueErrors,
  initialColumnsDraft,
  materializeColumns,
  rowsForColumns,
  type ColumnContent,
  type ColumnRow,
  type ColumnsDraft,
} from './table-columns-draft';
import './table-columns-editor.css';

/** A literal table-column editor. All editing remains in one session draft until Apply. */
export function TableColumnsEditor(props: ReactSetterProps) {
  const key = `table-columns:${props.draftKey}`;
  const [draft, setDraft, status] = useDraft(
    key,
    JSON.stringify(props.value) ?? 'unset',
    initialColumnsDraft(props.value),
  );
  const latest = useRef({ draft, status });
  latest.current = { draft, status };
  const lifetime = useRef({ key, active: true });
  if (lifetime.current.key !== key) {
    lifetime.current.active = false;
    lifetime.current = { key, active: true };
  }
  const owner = lifetime.current;
  useLayoutEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
    };
  }, [owner]);
  const format = useRef({ kind: draft.content.kind, generation: 0 });
  if (format.current.kind !== draft.content.kind)
    format.current = { kind: draft.content.kind, generation: format.current.generation + 1 };
  const generation = format.current;
  const canEdit = () =>
    owner.active &&
    lifetime.current === owner &&
    format.current === generation &&
    (props.canEdit?.() ?? true);
  const edit = (update: (value: ColumnsDraft) => ColumnsDraft) => {
    if (canEdit())
      setDraft((current) => {
        const next = update(current);
        latest.current = { ...latest.current, draft: next };
        return next;
      });
  };
  const fail = (error: unknown) => edit((current) => ({ ...current, error: errorText(error) }));
  const setContent = (content: ColumnContent) => {
    if (!canEdit()) return;
    // Invalidate old row/Monaco callbacks synchronously, even before the next render.
    format.current = { kind: content.kind, generation: format.current.generation + 1 };
    setDraft({ content, error: '' });
  };
  const updateRow = (rowId: string, field: keyof ColumnRow['edits'], value: string) => {
    const content = latest.current.draft.content;
    if (content.kind !== 'rows' || !content.rows.some((row) => row.rowId === rowId)) return;
    edit((current) => {
      if (
        current.content.kind !== 'rows' ||
        !current.content.rows.some((row) => row.rowId === rowId)
      )
        return current;
      return {
        error: '',
        content: {
          ...current.content,
          rows: current.content.rows.map((row) =>
            row.rowId === rowId ? { ...row, edits: { ...row.edits, [field]: value } } : row,
          ),
        },
      };
    });
  };
  const host = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<{ rowId?: string; removed: Element; owner: typeof owner } | null>(
    null,
  );
  useLayoutEffect(() => {
    const intent = focusIntent.current;
    focusIntent.current = null;
    if (!intent || intent.owner !== owner || !canEdit() || intent.removed.isConnected) return;
    const document = host.current?.ownerDocument;
    if (!document || document.activeElement !== document.body) return;
    const target = intent.rowId
      ? [...(host.current?.querySelectorAll<HTMLElement>('[data-table-column-row]') ?? [])]
          .find((row) => row.dataset.tableColumnRow === intent.rowId)
          ?.querySelector<HTMLInputElement>('input')
      : host.current?.querySelector<HTMLButtonElement>('[data-add-column]');
    target?.focus({ preventScroll: true });
  });
  const remove = (rowId: string, event: MouseEvent<HTMLElement>) => {
    if (!canEdit()) return;
    const content = latest.current.draft.content;
    if (content.kind !== 'rows') return;
    const index = content.rows.findIndex((row) => row.rowId === rowId);
    if (index < 0) return;
    const element = event.currentTarget.closest('[data-table-column-row]');
    if (element?.contains(element.ownerDocument.activeElement))
      focusIntent.current = {
        rowId: (content.rows[index + 1] ?? content.rows[index - 1])?.rowId,
        removed: element,
        owner,
      };
    edit((current) =>
      current.content.kind === 'rows'
        ? {
            error: '',
            content: {
              ...current.content,
              rows: current.content.rows.filter((row) => row.rowId !== rowId),
            },
          }
        : current,
    );
  };
  const move = (rowId: string, offset: number) => {
    const content = latest.current.draft.content;
    if (content.kind !== 'rows') return;
    const index = content.rows.findIndex((row) => row.rowId === rowId);
    if (index < 0 || index + offset < 0 || index + offset >= content.rows.length) return;
    edit((current) => {
      if (current.content.kind !== 'rows') return current;
      const rows = [...current.content.rows];
      const index = rows.findIndex((row) => row.rowId === rowId);
      const next = index + offset;
      if (index < 0 || next < 0 || next >= rows.length) return current;
      [rows[index], rows[next]] = [rows[next], rows[index]];
      return { content: { ...current.content, rows }, error: '' };
    });
  };
  const convert = (kind: ColumnContent['kind']) => {
    if (!canEdit() || latest.current.draft.content.kind === kind) return;
    try {
      const value = materializeColumns(latest.current.draft.content);
      if (kind === 'json') setContent({ kind, text: JSON.stringify(value, null, 2) });
      else {
        const errors = columnValueErrors(value);
        if (errors.length) throw new Error(errors.join('；'));
        if (!canRepresentColumns(value))
          throw new Error('当前列包含结构化控件无法无损表示的值，请继续使用 JSON 编辑');
        setContent(rowsForColumns(value));
      }
    } catch (error) {
      fail(error);
    }
  };
  const apply = () => {
    if (!canEdit() || latest.current.status.stale) return;
    try {
      const value = materializeColumns(latest.current.draft.content);
      const errors = columnValueErrors(value);
      if (errors.length) throw new Error(errors.join('；'));
      // The synchronous accepted operation owns its own cleanup. Its commit may expire
      // canEdit's captured plan; only this same local lifetime/key/format may finish.
      if (
        props.onChange(value) === true &&
        owner.active &&
        lifetime.current === owner &&
        format.current === generation
      ) {
        format.current = { ...generation, generation: generation.generation + 1 };
        status.reset();
      }
    } catch (error) {
      fail(error);
    }
  };
  return (
    <div className="table-columns-editor" role="group" aria-label="表格列设置" ref={host}>
      <DraftNotice
        {...status}
        reset={() => {
          if (!canEdit()) return;
          format.current = { ...format.current, generation: format.current.generation + 1 };
          status.reset();
        }}
        rebase={() => {
          if (canEdit()) latest.current.status.rebase();
        }}
      />
      {status.stale && <small>确认使用草稿后，应用将替换当前整组列定义。</small>}
      <div className="table-columns-formats" role="group" aria-label="列编辑格式">
        <Button aria-pressed={draft.content.kind === 'rows'} onClick={() => convert('rows')}>
          结构化编辑列
        </Button>
        <Button aria-pressed={draft.content.kind === 'json'} onClick={() => convert('json')}>
          JSON 编辑列
        </Button>
      </div>
      {draft.content.kind === 'json' ? (
        <CodeEditor
          label="表格列 JSON"
          language="json"
          value={draft.content.text}
          height={220}
          onChange={(text) =>
            edit((current) =>
              current.content.kind === 'json'
                ? { content: { kind: 'json', text }, error: '' }
                : current,
            )
          }
        />
      ) : (
        <>
          {draft.content.rows.map((row, index, rows) => (
            <div className="table-column-card" key={row.rowId} data-table-column-row={row.rowId}>
              <div className="table-column-heading">
                <strong>列 {index + 1}</strong>
                <div className="table-column-actions">
                  <Tip content="上移列">
                    <Button
                      aria-label={`上移列 ${index + 1}`}
                      aria-disabled={index === 0}
                      onClick={() => move(row.rowId, -1)}
                    >
                      <ArrowUp size={13} />
                    </Button>
                  </Tip>
                  <Tip content="下移列">
                    <Button
                      aria-label={`下移列 ${index + 1}`}
                      aria-disabled={index === rows.length - 1}
                      onClick={() => move(row.rowId, 1)}
                    >
                      <ArrowDown size={13} />
                    </Button>
                  </Tip>
                  <Tip content="删除列">
                    <Button
                      aria-label={`删除列 ${index + 1}`}
                      onClick={(event) => remove(row.rowId, event)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </Tip>
                </div>
              </div>
              <label>
                <span>字段路径</span>
                <Input
                  aria-label={`列 ${index + 1} 字段路径`}
                  value={columnField(row, 'key')}
                  onChange={(event) => updateRow(row.rowId, 'key', event.target.value)}
                />
              </label>
              <label>
                <span>标题</span>
                <Input
                  aria-label={`列 ${index + 1} 标题`}
                  value={columnField(row, 'title')}
                  onChange={(event) => updateRow(row.rowId, 'title', event.target.value)}
                />
              </label>
              <div className="table-column-details">
                <label>
                  <span>宽度</span>
                  <Input
                    aria-label={`列 ${index + 1} 宽度`}
                    inputMode="decimal"
                    placeholder="自动"
                    value={columnField(row, 'width')}
                    onChange={(event) => updateRow(row.rowId, 'width', event.target.value)}
                  />
                </label>
                <label>
                  <span>排序</span>
                  <Select
                    aria-label={`列 ${index + 1} 排序`}
                    value={columnField(row, 'sortable')}
                    onValueChange={(value) => updateRow(row.rowId, 'sortable', value)}
                  >
                    <option value="">未设置</option>
                    <option value="true">开启</option>
                    <option value="false">关闭</option>
                  </Select>
                </label>
                <label>
                  <span>对齐</span>
                  <Select
                    aria-label={`列 ${index + 1} 对齐`}
                    value={columnField(row, 'align')}
                    onValueChange={(value) => updateRow(row.rowId, 'align', value)}
                  >
                    <option value="">未设置</option>
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </Select>
                </label>
              </div>
            </div>
          ))}
          <Button
            data-add-column
            onClick={() =>
              edit((current) => {
                if (current.content.kind !== 'rows') return current;
                const used = new Set(current.content.rows.map((row) => columnField(row, 'key')));
                let sequence = 1;
                while (used.has(`column${sequence}`)) sequence++;
                return {
                  error: '',
                  content: {
                    kind: 'rows',
                    nextRowId: current.content.nextRowId + 1,
                    rows: [
                      ...current.content.rows,
                      {
                        rowId: `new:${current.content.nextRowId}`,
                        original: { key: `column${sequence}`, title: `列 ${sequence}` },
                        edits: {},
                      },
                    ],
                  },
                };
              })
            }
          >
            <Plus size={13} /> 添加列
          </Button>
        </>
      )}
      <div className="table-columns-footer">
        <small>修改后应用整组列；清空宽度可恢复自动。</small>
        <Button disabled={status.stale || !status.dirty} onClick={apply}>
          应用列
        </Button>
      </div>
      {draft.error && (
        <p role="alert" className="property-error">
          {draft.error}
        </p>
      )}
    </div>
  );
}
