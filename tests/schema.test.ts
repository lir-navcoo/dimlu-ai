import { describe, expect, it } from 'vitest';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';
import { validateApplication } from '../packages/schema/validate';
import { compileApplication } from '../packages/runtime/engine';

describe('schema contracts', () => {
  it('accepts all three examples and preserves namespaced extensions in an immutable plan', () => {
    const input = structuredClone(exampleApplication);
    input.extensions!['my-company:extra'] = { revision: 3, tags: ['a'] };
    expect(validateApplication(input, registry)).toEqual([]);
    const plan = compileApplication(input, registry);
    expect(plan.schema.extensions!['my-company:extra']).toEqual(
      input.extensions!['my-company:extra'],
    );
    input.title = 'changed';
    expect(plan.schema.title).not.toBe(input.title);
    expect(Object.isFrozen(plan.schema.pages[0].children[0])).toBe(true);
  });
  it('rejects an unsupported schema version and unnamespaced extensions', () => {
    const input = {
      ...structuredClone(exampleApplication),
      schemaVersion: '2.0.0',
      extensions: { unknown: 1 },
    };
    const issues = validateApplication(input, registry);
    expect(issues.some((i) => i.path === '/schemaVersion')).toBe(true);
    expect(issues.some((i) => i.path.startsWith('/extensions'))).toBe(true);
  });
  it('checks state references, initial types, property contracts and exact dependency versions', () => {
    const input = structuredClone(exampleApplication);
    input.dependencies.components['ui.input'] = '2.0.0';
    input.pages[0].state[0].initial = 7;
    input.pages[0].children[0].props.value = { kind: 'stateRef', stateId: 'missing' };
    input.pages[0].children[0].props.typo = { kind: 'literal', value: true };
    const codes = validateApplication(input, registry).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['dependency.version', 'state.type', 'state.missing', 'prop.unknown']),
    );
  });
  it('walks nodes inside slots and detects duplicate identities and unsupported slot parameters', () => {
    const input = structuredClone(exampleApplication);
    const card = input.pages[2].children[2];
    card.slots!.body.children[0].id = card.id;
    card.slots!.header.params.push('secret');
    const codes = validateApplication(input, registry).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['id.duplicate', 'slot.param']));
  });
  it('rejects events used outside action inputs', () => {
    const input = structuredClone(exampleApplication);
    input.pages[0].children[0].props.value = {
      kind: 'expression',
      language: 'javascript',
      source: 'event.target.value',
    };
    expect(validateApplication(input, registry).some((i) => i.code === 'event.scope')).toBe(true);
  });
  it('rejects inherited slot names and collisions with the default loop index', () => {
    const input = structuredClone(exampleApplication);
    Object.assign(input.pages[2].children[2].slots!, { constructor: { params: [], children: [] } });
    const repeat = input.pages[1].children.find((node) => node.repeat)!.repeat!;
    repeat.item = 'index';
    delete repeat.index;
    const codes = validateApplication(input, registry).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['slot.unknown', 'scope.invalid']));
  });
});
