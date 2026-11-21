import { useState } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { nearestForm } from '../../packages/editor/forms';
import type { FieldArrayDefinition, NodeSchema } from '../../packages/schema/types';
import { Button, Select } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { DraftNotice, useDraft } from './session';
import { arrayDefinitionErrors } from '../materials/field-array';
import { errorText } from './errors';
import { useAuthorGuard } from './author-guard';

export function FieldArrayPanel({
  document,
  snapshot,
  node,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node: NodeSchema;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const pageId = snapshot.selection.pageId,
    page = snapshot.plan.pages.get(pageId)!.schema,
    owner = nearestForm(page, node.id, snapshot.plan.registry),
    form = page.forms?.find((form) => form.id === owner?.formId);
  const binding = node.props.arrayId?.kind === 'literal' ? String(node.props.arrayId.value) : '';
  const existing = form?.arrays?.find((array) => array.id === binding);
  const id = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
  const initial: FieldArrayDefinition = existing ?? {
    id,
    path: [id],
    label: node.props.label?.kind === 'literal' ? String(node.props.label.value) : '动态明细',
    fields:
      node.props.fields?.kind === 'literal'
        ? (node.props.fields.value as unknown as FieldArrayDefinition['fields'])
        : [],
    initial:
      node.props.value?.kind === 'literal'
        ? (node.props.value.value as FieldArrayDefinition['initial'])
        : [],
    ...(node.props.minItems?.kind === 'literal'
      ? { minItems: Number(node.props.minItems.value) }
      : {}),
    ...(node.props.maxItems?.kind === 'literal'
      ? { maxItems: Number(node.props.maxItems.value) }
      : {}),
  };
  const [draft, setDraft, status] = useDraft(
    `array:${pageId}/${node.id}`,
    JSON.stringify(initial),
    JSON.stringify(initial, null, 2),
  );
  const [error, setError] = useState('');
  const run = (action: () => void) => {
    if (!canAuthor()) return;
    try {
      action();
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return (
    <section className="property-group">
      <h3>明细模型绑定</h3>
      {form ? (
        <>
          <label>
            绑定明细
            <Select
              aria-label="绑定明细"
              value={binding}
              onValueChange={(value) =>
                run(() => {
                  document.bindFieldArray(pageId, node.id, value || undefined);
                  status.reset();
                })
              }
            >
              <option value="">未绑定 · 独立明细</option>
              {form.arrays?.map((array) => (
                <option key={array.id} value={array.id}>
                  {array.label} ({array.id})
                </option>
              ))}
            </Select>
          </label>
          <p className="editor-note">
            绑定后，字段、校验、默认值及行数由明细模型管理，与表单一起提交和重置。
          </p>
          <label>
            明细模型定义
            <CodeEditor
              label="明细模型定义"
              language="json"
              height={248}
              value={draft}
              onChange={setDraft}
            />
          </label>
          <DraftNotice {...status} />
          <Button
            disabled={status.stale}
            onClick={() =>
              run(() => {
                const next: unknown = JSON.parse(draft);
                const issues = arrayDefinitionErrors(next);
                if (issues.length) throw new Error(issues.join('；'));
                document.configureFieldArray(pageId, node.id, next as FieldArrayDefinition);
                status.reset();
              })
            }
          >
            保存并绑定明细
          </Button>
        </>
      ) : (
        <p className="editor-note">
          当前使用独立明细。放入已绑定模型的表单容器后，可创建或绑定明细模型。
        </p>
      )}
      {error && (
        <p role="alert" className="property-error">
          {error}
        </p>
      )}
    </section>
  );
}
