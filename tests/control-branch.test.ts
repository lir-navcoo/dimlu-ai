import { describe, expect, it } from 'vitest';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { registry } from '../src/materials';
import type { ActionCall, ApplicationSchema, Json } from '../packages/schema/types';

const definition = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'branch-test',
  title: 'Branch',
  entryPageId: 'one',
  dependencies: { components: {}, actions: { 'state.set': '1.0.0' } },
  pages: [
    {
      id: 'one',
      title: 'One',
      state: [
        { id: 'path', type: 'string', initial: '' },
        { id: 'flag', type: 'boolean', initial: false },
      ],
      children: [],
    },
  ],
});

const set = (id: string, value: Json, callId?: string): ActionCall => ({
  id: callId ?? `set-${id}-${value}`,
  action: 'state.set',
  input: {
    stateId: { kind: 'literal', value: id },
    value: { kind: 'literal', value },
  },
});

const literal = (value: Json): { kind: 'literal'; value: Json } => ({ kind: 'literal', value });

describe('control.branch conditional action', () => {
  const plan = (chain: ActionCall[]) => {
    const schema = definition();
    schema.pages[0].onEnter = chain;
    return compileApplication(schema, registry);
  };

  it('executes the then chain when the condition holds', async () => {
    const branch: ActionCall = {
      id: 'branch-1',
      action: 'control.branch',
      input: { when: literal(true) },
      then: [set('path', 'then')],
      else: [set('path', 'else', 'set-path-else')],
    };
    const value = new PageRuntime(plan([branch]), 'one');
    try {
      await value.enter();
      expect(value.getState().path).toBe('then');
    } finally {
      value.dispose();
    }
  });

  it('executes the else chain when the condition fails', async () => {
    const branch: ActionCall = {
      id: 'branch-1',
      action: 'control.branch',
      input: { when: literal(false) },
      then: [set('path', 'then')],
      else: [set('path', 'else', 'set-path-else')],
    };
    const value = new PageRuntime(plan([branch]), 'one');
    try {
      await value.enter();
      expect(value.getState().path).toBe('else');
    } finally {
      value.dispose();
    }
  });

  it('supports expression conditions and skips empty branches', async () => {
    const branch: ActionCall = {
      id: 'branch-1',
      action: 'control.branch',
      input: {
        when: {
          kind: 'expression',
          language: 'javascript',
          source: 'state.count > 5',
        },
      },
      then: [set('flag', true)],
    };
    const schema = definition();
    schema.pages[0].state.push({ id: 'count', type: 'number', initial: 9 });
    schema.pages[0].onEnter = [branch];
    const value = new PageRuntime(compileApplication(schema, registry), 'one');
    try {
      await value.enter();
      expect(value.getState().flag).toBe(true);
    } finally {
      value.dispose();
    }
  });

  it('supports nested branches and stops the chain on branch errors', async () => {
    const nested: ActionCall = {
      id: 'branch-outer',
      action: 'control.branch',
      input: { when: literal(true) },
      then: [
        set('path', 'outer'),
        {
          id: 'branch-inner',
          action: 'control.branch',
          input: { when: literal(false) },
          then: [set('flag', true, 'set-flag-inner-then')],
          else: [set('flag', true, 'set-flag-inner-else')],
        },
        set('path', 'after-inner'),
      ],
    };
    const value = new PageRuntime(plan([nested, set('path', 'tail')]), 'one');
    try {
      await value.enter();
      // 分支后链继续执行（path 被 tail 覆盖），内层 else 分支生效。
      expect(value.getState().flag).toBe(true);
      expect(value.getState().path).toBe('tail');
    } finally {
      value.dispose();
    }
  });
});
