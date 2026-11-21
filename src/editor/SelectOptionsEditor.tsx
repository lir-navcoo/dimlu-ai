import type { Json } from '../../packages/schema/types';
import { selectOptionErrors, type SelectOption } from '../select-options';
import { Button, Input, Select, Checkbox, Tip } from '../ui/primitives';
import { Trash2 } from 'lucide-react';
import { DraftNotice, useDraft } from './session';

interface OptionDraft {
  label: string;
  value: string;
  type: 'string' | 'number';
  disabled: boolean;
}

export function SelectOptionsEditor({
  value,
  draftKey,
  onCommit,
}: {
  value: Json | undefined;
  draftKey: string;
  onCommit: (value: Json) => boolean;
}) {
  const options =
    Array.isArray(value) && !selectOptionErrors(value).length
      ? (value as unknown as SelectOption[])
      : [];
  const [draft, setDraft, status] = useDraft(`options:${draftKey}`, JSON.stringify(value), {
    items: options.map((option): OptionDraft => ({
      label: option.label,
      value: String(option.value),
      type: typeof option.value === 'number' ? 'number' : 'string',
      disabled: option.disabled ?? false,
    })),
    error: '',
  });
  const update = (index: number, patch: Partial<(typeof draft.items)[number]>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      error: '',
    }));
  return (
    <div className="select-options-editor" role="group" aria-label="选择器选项">
      <DraftNotice {...status} />
      {draft.items.map((item, index) => (
        <div className="select-option-editor" key={index}>
          <Input
            className="select-option-label"
            aria-label={`选项 ${index + 1} 名称`}
            value={item.label}
            placeholder="显示名称"
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Select
            aria-label={`选项 ${index + 1} 类型`}
            value={item.type}
            onValueChange={(type) =>
              update(index, { type: type === 'number' ? 'number' : 'string' })
            }
          >
            <option value="string">文本值</option>
            <option value="number">数字值</option>
          </Select>
          <Input
            className="select-option-value"
            aria-label={`选项 ${index + 1} 值`}
            value={item.value}
            placeholder="实际值"
            inputMode={item.type === 'number' ? 'decimal' : 'text'}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <label className="select-option-disabled">
            <Checkbox
              aria-label={`选项 ${index + 1} 禁用`}
              checked={item.disabled}
              onCheckedChange={(disabled) => update(index, { disabled })}
            />
            禁用
          </label>
          <Tip content="删除选项">
            <Button
              className="select-option-remove"
              aria-label={`删除选项 ${index + 1}`}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  items: current.items.filter((_, i) => i !== index),
                  error: '',
                }))
              }
            >
              <Trash2 size={13} />
            </Button>
          </Tip>
        </div>
      ))}
      <div className="select-options-actions">
        <Button
          onClick={() => {
            const type =
              draft.items.length && draft.items.every((item) => item.type === 'number')
                ? 'number'
                : 'string';
            let sequence = draft.items.length + 1;
            while (
              draft.items.some(
                (item) =>
                  item.type === type &&
                  item.value === (type === 'number' ? String(sequence) : `option${sequence}`),
              )
            )
              sequence++;
            setDraft((current) => ({
              ...current,
              items: [
                ...current.items,
                {
                  label: `选项 ${sequence}`,
                  value: type === 'number' ? String(sequence) : `option${sequence}`,
                  type,
                  disabled: false,
                },
              ],
              error: '',
            }));
          }}
        >
          ＋ 添加选项
        </Button>
        <Button
          disabled={status.stale || !status.dirty}
          onClick={() => {
            const next = draft.items.map((item) => ({
              label: item.label,
              value:
                item.type === 'number'
                  ? item.value.trim()
                    ? Number(item.value)
                    : NaN
                  : item.value,
              disabled: item.disabled,
            }));
            const errors = selectOptionErrors(next);
            if (errors.length) setDraft((current) => ({ ...current, error: errors.join('；') }));
            else if (onCommit(next)) status.reset();
          }}
        >
          应用选项
        </Button>
      </div>
      <small>显示名称与实际值分别配置；修改后应用选项。</small>
      {draft.error && (
        <p role="alert" className="property-error">
          {draft.error}
        </p>
      )}
    </div>
  );
}
