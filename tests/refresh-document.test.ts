import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { refreshEditorDocument } from '../src/editor/refresh-document';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';

describe('document refresh', () => {
  it('adopts updated material contracts after hot refresh while preserving the authored definition', () => {
    const oldRegistry = {
      ...registry,
      components: {
        ...registry.components,
        'ui.input': {
          ...registry.components['ui.input'],
          props: {
            label: { type: 'string' as const, required: true },
            value: { type: 'string' as const, required: true },
            placeholder: { type: 'string' as const },
            hint: { type: 'string' as const },
          },
        },
      },
    };
    const previous = new EditorDocument(exampleApplication, oldRegistry);
    previous.select('purchase', 'purchase-name');
    const next = refreshEditorDocument(previous, registry);
    expect(next.exportJson()).toBe(previous.exportJson());
    expect(next.getSnapshot().selection).toEqual(previous.getSnapshot().selection);
    expect(() =>
      next.setProp('purchase', 'purchase-name', 'multiline', { kind: 'literal', value: true }),
    ).not.toThrow();
    expect(refreshEditorDocument(next, registry)).toBe(next);
  });
  it('replaces a retained old implementation without losing the current schema or selection', () => {
    // A different constructor models a document retained by React Fast Refresh.
    class OldDocument extends EditorDocument {}
    const previous = new OldDocument(exampleApplication, registry);
    previous.setProp('composition', 'composition-heading', 'value', {
      kind: 'literal',
      value: '保留编辑',
    });
    previous.select('composition', 'card-heading');
    Object.defineProperty(previous, 'checkInsert', { value: undefined });
    Object.defineProperty(previous, 'checkMove', { value: undefined });
    const next = refreshEditorDocument(previous, registry);
    expect(next).not.toBe(previous);
    expect(next.exportJson()).toBe(previous.exportJson());
    expect(next.getSnapshot().selection).toEqual(previous.getSnapshot().selection);
    expect(() =>
      next.checkInsert('composition', {
        component: 'ui.text',
        props: { value: { kind: 'literal', value: '新节点' } },
      }),
    ).not.toThrow();
    expect(() => next.checkMove('composition', 'composition-heading')).not.toThrow();
    expect(refreshEditorDocument(next, registry)).toBe(next);
  });
});
