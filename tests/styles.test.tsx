import { StrictMode, type CSSProperties } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { styleProperties, styleValueError, type StyleProperty } from '../packages/schema/style';
import { createRegistry } from '../packages/runtime/registry';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import {
  RuntimeRenderer,
  materialStyleTarget,
  type SlotRenderers,
} from '../packages/react-runtime/Renderer';
import { assertStyleSource, scopeStyleSource } from '../packages/schema/style-source';
import { EditorDocument, findNode } from '../packages/editor/document';
import { formReferences } from '../packages/editor/forms';
import { sourceReferences, stateReferences } from '../packages/editor/data';
import { ProjectStorage, PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { registry, materials } from '../src/materials';
import { catalog } from '../src/editor/catalog';
import { LayoutMaterial, TabsMaterial, TabPanelMaterial } from '../src/materials/containers';
import { DialogMaterial, DrawerMaterial } from '../src/materials/feedback';
const css = readFileSync('src/materials/materials.css', 'utf8');

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const boxRegistry = () =>
  createRegistry(
    {
      box: {
        version: '1.0.0',
        props: {},
        style: { target: 'root', properties: [...styleProperties], source: true },
        children: true,
      },
      host: { version: '1.0.0', props: {}, slots: { content: ['row'] } },
    },
    {},
  );
function app(node: NodeSchema = { id: 'box', component: 'box', props: {} }): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'styles',
    title: 'styles',
    entryPageId: 'page',
    dependencies: { components: { box: '1.0.0', host: '1.0.0' }, actions: {} },
    pages: [
      {
        id: 'page',
        title: 'page',
        state: [
          { id: 'width', type: 'number', initial: 10 },
          { id: 'color', type: 'string', initial: '#123456' },
          { id: 'bad', type: 'boolean', initial: true },
        ],
        children: [node],
      },
    ],
  };
}
const box = ({ style, children }: { style?: CSSProperties; children?: React.ReactNode }) => (
  <div data-testid="box" style={style} {...materialStyleTarget(style)}>
    {children ?? '组件仍显示'}
  </div>
);
const ownMaterials = {
  box,
  host: ({ slots }: { slots: SlotRenderers }) => slots.content({ row: { width: 35 } }),
};

describe('typed node style schema and document commands', () => {
  it('validates explicit CSS domains, dimensions, negative margins, enums and text values', () => {
    const valid: [StyleProperty, unknown][] = [
      ['width', 0],
      ['height', '100%'],
      ['maxWidth', 'none'],
      ['minHeight', 'auto'],
      ['marginLeft', -12],
      ['marginRight', '-.5rem'],
      ['marginTop', 'auto'],
      ['paddingTop', '1.5em'],
      ['gap', 8],
      ['flexGrow', 0],
      ['flexBasis', 'auto'],
      ['fontWeight', 750],
      ['lineHeight', 1.25],
      ['color', '#1234'],
      ['backgroundColor', 'transparent'],
      ['textAlign', 'start'],
    ];
    for (const [key, value] of valid)
      expect(styleValueError(key, value), `${key}=${String(value)}`).toBeUndefined();
    const invalid: [StyleProperty, unknown][] = [
      ['width', -1],
      ['paddingTop', '-2px'],
      ['gap', 'auto'],
      ['height', 'calc(100% - 1px)'],
      ['color', 'url(x)'],
      ['color', 'var(--color)'],
      ['color', 'not-a-color'],
      ['fontWeight', 1001],
      ['lineHeight', -1],
      ['flexShrink', '2'],
      ['display', 'inherit'],
      ['width', Infinity],
      ['width', {}],
    ];
    for (const [key, value] of invalid)
      expect(styleValueError(key, value), `${key}=${String(value)}`).toBeTruthy();
  });
  it('rejects unsupported keys/targets, bad literals and known reference types before commit', () => {
    const document = new EditorDocument(app(), boxRegistry());
    for (const patch of [
      { width: literal(-1) },
      { color: { kind: 'stateRef' as const, stateId: 'width' } },
      { width: { kind: 'stateRef' as const, stateId: 'bad' } },
      { unknown: literal(2) },
    ]) {
      const before = document.getSnapshot();
      expect(() => document.setStyle('page', 'box', patch)).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    const source = app();
    source.pages[0].children[0].style = { width: literal(10) };
    const unsupported = boxRegistry();
    delete unsupported.components.box.style;
    expect(() => compileApplication(source, unsupported)).toThrow(/样式/);
    const invalidTarget = boxRegistry();
    invalidTarget.components.box.style!.target = 'selector' as 'root';
    expect(() => compileApplication(source, invalidTarget)).toThrow(/样式目标/);
  });
  it('copies/freeze style plans and capabilities without freezing the caller registry', () => {
    const source = app(),
      original = boxRegistry();
    source.pages[0].children[0].style = { width: { kind: 'stateRef', stateId: 'width' } };
    const plan = compileApplication(source, original),
      node = plan.pages.get('page')!.children[0];
    expect(node.dependencies).toContain('width');
    expect(Object.isFrozen(node.style)).toBe(true);
    expect(Object.isFrozen(node.schema.style)).toBe(true);
    expect(Object.isFrozen(plan.registry.components.box.style!.properties)).toBe(true);
    expect(Object.isFrozen(original.components.box.style!.properties)).toBe(false);
    (original.components.box.style!.properties as StyleProperty[]).pop();
    expect(plan.registry.components.box.style!.properties).toHaveLength(styleProperties.length);
    expect(source.pages[0].children[0].style).not.toBe(node.schema.style);
  });
  it('patches/removes styles atomically, groups history, duplicates and roundtrips import/local recovery', () => {
    const original = app(),
      document = new EditorDocument(original, boxRegistry());
    document.setStyle('page', 'box', { width: literal(10), paddingLeft: literal(6) }, 'style-edit');
    document.setStyle('page', 'box', { width: literal(20) }, 'style-edit');
    document.undo();
    expect(
      findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'box')!.node.style,
    ).toBeUndefined();
    document.redo();
    const copy = document.duplicateNode('page', 'box');
    expect(
      findNode(document.getSnapshot().plan.pages.get('page')!.schema, copy)!.node.style,
    ).toEqual({ width: literal(20), paddingLeft: literal(6) });
    const exported = document.exportJson(),
      restored = new EditorDocument(original, boxRegistry());
    restored.importJson(exported);
    expect(restored.exportJson()).toBe(exported);
    const adapter = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
    };
    const store = new ProjectStorage(adapter, boxRegistry(), JSON.parse(exported));
    store.start();
    store.getSnapshot().document.setStyle('page', 'box', { width: literal(30) });
    store.flush();
    store.stop();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toContain('style');
    const recovered = new ProjectStorage(adapter, boxRegistry(), original);
    expect(
      findNode(
        recovered.getSnapshot().document.getSnapshot().plan.pages.get('page')!.schema,
        'box',
      )!.node.style?.width,
    ).toEqual(literal(30));
    document.setStyle('page', 'box', { width: undefined, paddingLeft: undefined });
    expect(
      findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'box')!.node.style,
    ).toBeUndefined();
  });
  it('includes styles in state/source/form deletion references and protects repeat/slot scope moves', () => {
    const source = app();
    source.pages[0].forms = [
      {
        id: 'form',
        fields: [{ id: 'name', path: ['name'], type: 'string', label: 'name', initial: '10px' }],
      },
    ];
    source.pages[0].children[0].style = {
      width: { kind: 'stateRef', stateId: 'width' },
      color: { kind: 'dataRef', sourceId: 'colors' },
      height: { kind: 'fieldRef', formId: 'form', fieldId: 'name' },
    };
    expect(stateReferences(source.pages[0], 'width')).toContain('组件 box/style/width');
    expect(sourceReferences(source.pages[0], 'colors')).toContain('组件 box/style/color');
    expect(formReferences(source.pages[0], 'form', 'name')).toContain('组件 box/style/height');
    const registry = boxRegistry();
    registry.transports!.colors = {
      version: '1.0.0',
      input: {},
      output: 'string',
      execute: async () => '#123456',
    };
    source.dependencies.transports = { colors: '1.0.0' };
    source.pages[0].dataSources = [
      { id: 'colors', kind: 'query', transport: 'colors', input: {}, initial: '#123456' },
    ];
    const document = new EditorDocument(source, registry);
    expect(() => document.removeState('page', 'width')).toThrow(/引用/);
    expect(() => document.removeDataSource('page', 'colors')).toThrow(/引用/);
    expect(() => document.removeField('page', 'form', 'name')).toThrow(/引用/);
    const slotted = app({
      id: 'host',
      component: 'host',
      props: {},
      slots: {
        content: {
          params: ['row'],
          children: [
            {
              id: 'child',
              component: 'box',
              props: {},
              style: { width: expression('scope.row.width') },
            },
          ],
        },
      },
    });
    const slotDocument = new EditorDocument(slotted, boxRegistry());
    expect(() => slotDocument.moveNode('page', 'child', {})).toThrow(/作用域/);
    const before = slotDocument.getSnapshot();
    expect(() =>
      slotDocument.setStyle('page', 'child', { width: expression('scope.absent.width') }),
    ).toThrow(/作用域/);
    expect(slotDocument.getSnapshot()).toBe(before);
    const invalid = app({
      id: 'bad',
      component: 'box',
      props: {},
      style: { width: expression('scope.row.width') },
    });
    expect(() => compileApplication(invalid, boxRegistry())).toThrow(/作用域/);
  });
});

describe('style runtime and real material targets', () => {
  it('keeps visual gap values in sync when replacing or splitting a CSS shorthand', () => {
    const document = new EditorDocument(app(), boxRegistry());
    const node = () => findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'box')!.node;
    document.setStyleSource('page', 'box', ':root { gap: 4px; }');
    expect(node().style).toMatchObject({
      gap: literal('4px'),
      rowGap: literal('4px'),
      columnGap: literal('4px'),
    });
    document.setStyle('page', 'box', { rowGap: literal(6) });
    expect(node().style).toEqual({ rowGap: literal(6), columnGap: literal('4px') });
    expect(node().styleCss).toContain('column-gap: 4px');
    document.setStyleSource('page', 'box', ':root { gap: 4px 8px; column-gap: 10px; }');
    document.setStyle('page', 'box', { gap: literal(12) });
    expect(node().style).toEqual({
      gap: literal(12),
      rowGap: literal('12px'),
      columnGap: literal('12px'),
    });
    expect(node().styleCss).toContain('gap: 12px');
  });
  it('syncs border radius and shadow between source and visual settings', () => {
    const document = new EditorDocument(app(), boxRegistry());
    const node = () => findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'box')!.node;
    document.setStyleSource(
      'page',
      'box',
      ':root { border-radius: 12px; box-shadow: 0 2px 8px #94a3b8, inset 0 0 2px red; }',
    );
    expect(node().style).toMatchObject({
      borderRadius: literal('12px'),
      boxShadow: literal('0 2px 8px #94a3b8, inset 0 0 2px red'),
    });
    expect(() =>
      document.setStyleSource('page', 'box', ':root { box-shadow: url(x.png); }'),
    ).toThrow();
    expect(() =>
      document.setStyle('page', 'box', { boxShadow: literal('url(x.png)') }),
    ).toThrow(/boxShadow/);
    document.setStyle('page', 'box', { borderRadius: literal(4) });
    expect(node().styleCss).toContain('border-radius: 4px');
    expect(node().styleCss).toContain('box-shadow: 0 2px 8px #94a3b8');
  });
  it.each([
    'body { color: red; }',
    ':root, body { color: red; }',
    ':root + div { color: red; }',
    ':root > div { color: red; }',
    ':root:has(div) { color: red; }',
    '@import "blocked.css";',
    ':root { color: red; @media (width > 300px) { color: blue; } }',
    ':root { position: fixed; }',
    ':root { z-index: 10; }',
    ':root { pointer-events: none; }',
    ':root { --layer-modal: 999999; }',
    ':root { background-image: var(--host-image); }',
    ':root { font-family: "a;b"; }',
    ':root { background-image: url("blocked.png"); }',
    ':root { background-image: image-set("blocked.png" 1x); }',
    ':root { background-image: u/**/rl("blocked.png"); }',
    String.raw`:root { background-image: \75rl("blocked.png"); }`,
  ])('rejects out-of-scope CSS before import or serialization (%s)', (source) => {
    expect(() => assertStyleSource(source)).toThrow();
    const schema = app({ id: 'box', component: 'box', props: {}, styleCss: source });
    expect(() => compileApplication(schema, boxRegistry())).toThrow(/styleCss/);
  });
  it('applies source only to its component and cleans its scoped stylesheet on unmount', () => {
    const schema = app({ id: 'box', component: 'box', props: {} });
    schema.pages[0].children.push({ id: 'sibling', component: 'box', props: {} });
    const doc = new EditorDocument(schema, boxRegistry());
    doc.setStyle('page', 'box', { height: expression('state.width') });
    doc.setStyleSource(
      'page',
      'box',
      ':root { padding: 2px 4px; border-radius: 9px; color: red !important; color: blue; } :root:hover { opacity: .5; color: green; }',
    );
    doc.setStyle('page', 'box', { paddingTop: literal(6) });
    const imported = JSON.parse(doc.exportJson());
    const scoped = imported.pages[0].children[0] as NodeSchema;
    expect(scoped.style).toMatchObject({
      paddingTop: literal(6),
      paddingRight: literal('4px'),
      height: expression('state.width'),
    });
    expect(scoped.styleCss).toContain('padding-top: 6px');
    expect(scoped.styleCss).not.toContain('padding:');
    const runtime = new PageRuntime(compileApplication(imported, boxRegistry()), 'page');
    const mounted = render(<RuntimeRenderer runtime={runtime} materials={ownMaterials} />);
    const [target, sibling] = screen.getAllByTestId('box');
    const mark = target.getAttribute('data-material-style');
    expect(mark).toBeTruthy();
    expect(sibling.hasAttribute('data-material-style')).toBe(false);
    expect(getComputedStyle(target).borderRadius).toBe('9px');
    expect(getComputedStyle(sibling).borderRadius).toBe('');
    expect(target.style.height).toBe('10px');
    const scope = `[data-material-style="${mark}"]`;
    const stylesheet = [...document.head.querySelectorAll('style')].find((tag) =>
      tag.textContent?.includes(scope),
    )!;
    const active = ':where(:not([hidden], [data-closed]))';
    expect(stylesheet.textContent).toContain(`${scope}${active}:hover`);
    expect(stylesheet.textContent).toContain(
      `${scope.repeat(3)}${active} { color: red !important; }`,
    );
    const baseRule = [...stylesheet.sheet!.cssRules].find(
      (rule): rule is CSSStyleRule =>
        'selectorText' in rule && rule.selectorText === `${scope}${active}`,
    )!;
    expect(target.matches(baseRule.selectorText)).toBe(true);
    for (const hidden of ['hidden', 'data-closed']) {
      target.setAttribute(hidden, '');
      expect(target.matches(baseRule.selectorText)).toBe(false);
      target.removeAttribute(hidden);
    }
    mounted.unmount();
    expect(stylesheet.isConnected).toBe(false);
  });
  it('omits a bad dynamic item, reports once after commit, preserves other styles and recovers', () => {
    const source = app();
    source.pages[0].children[0].style = {
      width: expression('state.width > 0 ? state.width : "bad"'),
      color: { kind: 'stateRef', stateId: 'color' },
      paddingTop: literal(8),
    };
    const runtime = new PageRuntime(compileApplication(source, boxRegistry()), 'page');
    const view = render(
      <StrictMode>
        <RuntimeRenderer runtime={runtime} materials={ownMaterials} />
      </StrictMode>,
    );
    const element = screen.getByTestId('box');
    expect(element.style.width).toBe('10px');
    act(() => runtime.setState('width', -1));
    expect(element.style.width).toBe('');
    expect(element.style.paddingTop).toBe('8px');
    expect(element.textContent).toBe('组件仍显示');
    expect(runtime.getRecords().filter((record) => record.kind === 'style.error')).toHaveLength(1);
    expect(runtime.getRecords()[0]).toMatchObject({
      nodeId: 'box',
      message: expect.stringContaining('style.width'),
    });
    view.rerender(
      <StrictMode>
        <RuntimeRenderer runtime={runtime} materials={ownMaterials} />
      </StrictMode>,
    );
    expect(runtime.getRecords().filter((record) => record.kind === 'style.error')).toHaveLength(1);
    act(() => runtime.setState('width', 25));
    expect(element.style.width).toBe('25px');
    runtime.dispose();
  });
  it('uses independent repeat and render-slot style scopes', () => {
    const repeated = app({
      id: 'box',
      component: 'box',
      props: {},
      repeat: {
        items: literal([
          { id: 'a', width: 10 },
          { id: 'b', width: 20 },
        ]),
        item: 'row',
        key: expression('scope.row.id'),
      },
      style: { width: expression('scope.row.width') },
    });
    const rt = new PageRuntime(compileApplication(repeated, boxRegistry()), 'page');
    render(<RuntimeRenderer runtime={rt} materials={ownMaterials} />);
    expect(screen.getAllByTestId('box').map((el) => el.style.width)).toEqual(['10px', '20px']);
    cleanup();
    rt.dispose();
    const slotted = app({
      id: 'host',
      component: 'host',
      props: {},
      slots: {
        content: {
          params: ['row'],
          children: [
            {
              id: 'child',
              component: 'box',
              props: {},
              style: { width: expression('scope.row.width') },
            },
          ],
        },
      },
    });
    const runtime = new PageRuntime(compileApplication(slotted, boxRegistry()), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={ownMaterials} />);
    expect(screen.getByTestId('box').style.width).toBe('35px');
    runtime.dispose();
  });
  it('contains invalid business objects even when they shadow toString', () => {
    const source = app();
    source.pages[0].state.push({ id: 'payload', type: 'object', initial: { toString: 1 } });
    source.pages[0].children[0].style = {
      color: expression('state.payload'),
      paddingLeft: literal(7),
    };
    const runtime = new PageRuntime(compileApplication(source, boxRegistry()), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={ownMaterials} />);
    expect(screen.getByTestId('box').textContent).toBe('组件仍显示');
    expect(screen.getByTestId('box').style.paddingLeft).toBe('7px');
    expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toHaveLength(0);
    expect(runtime.getRecords().filter((record) => record.kind === 'style.error')).toHaveLength(1);
    runtime.dispose();
  });
  it('lets explicit styles override legacy Layout props and restores them without shorthand conflicts', () => {
    const view = render(
      <LayoutMaterial gap={12} padding={16} style={{ rowGap: 6, columnGap: 6, paddingTop: 30 }}>
        内容
      </LayoutMaterial>,
    );
    const root = screen.getByText('内容');
    expect(root.style.paddingTop).toBe('30px');
    expect(root.style.rowGap).toBe('6px');
    view.rerender(
      <LayoutMaterial gap={12} padding={16}>
        内容
      </LayoutMaterial>,
    );
    expect(root.style.paddingTop).toBe('16px');
    expect(root.style.rowGap).toBe('12px');
    expect(root.style.columnGap).toBe('12px');
  });
  it.each([
    'ui.heading',
    'ui.input',
    'ui.number',
    'ui.select',
    'ui.checkbox',
    'ui.switch',
    'ui.date',
    'ui.time',
    'ui.radioGroup',
    'ui.checkboxGroup',
  ])('forwards box and text styles to %s meaningful targets', (component) => {
    const source = app({
      id: 'target',
      component,
      props: Object.fromEntries(
        Object.entries(catalog[component].defaultProps).map(([key, value]) => [
          key,
          literal(value),
        ]),
      ),
      style: { width: literal(333), color: literal('#123456'), fontSize: literal(19) },
    });
    source.dependencies.components[component] = registry.components[component].version;
    delete source.dependencies.components.box;
    delete source.dependencies.components.host;
    const runtime = new PageRuntime(compileApplication(source, registry), 'page');
    const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const root = view.container.querySelector<HTMLElement>(
      component === 'ui.heading' ? '.material-heading' : '.material-field',
    )!;
    expect(root.style.width).toBe('333px');
    const textTarget = root.querySelector<HTMLElement>(
      component === 'ui.heading'
        ? 'h2'
        : component === 'ui.select'
          ? '[role="combobox"]'
          : component === 'ui.checkbox' || component === 'ui.switch'
            ? '.material-boolean-label > span:last-child'
            : component === 'ui.radioGroup' || component === 'ui.checkboxGroup'
              ? '.material-choice'
              : 'input',
    )!;
    expect(textTarget.style.fontSize).toBe('19px');
    expect(textTarget.style.color).toBe('rgb(18, 52, 86)');
    runtime.dispose();
  });
  it.each([DialogMaterial, DrawerMaterial])(
    'styles popup rather than trigger/host and preserves closed visibility',
    (Overlay) => {
      const styleElement = document.createElement('style');
      styleElement.textContent = css;
      document.head.append(styleElement);
      const view = render(
        <Overlay
          title="弹层"
          triggerLabel="打开测试"
          width={480}
          style={{ width: 320, display: 'flex' }}
        >
          内容
        </Overlay>,
      );
      const popup = view.container.querySelector<HTMLElement>('.material-modal')!;
      expect(popup.style.width).toBe('320px');
      expect(view.container.querySelector<HTMLElement>('.material-overlay-host')!.style.width).toBe(
        '',
      );
      expect(screen.getByRole('button', { name: '打开测试' }).style.width).toBe('');
      expect(popup.hasAttribute('data-closed')).toBe(true);
      const rules = [...styleElement.sheet!.cssRules] as CSSStyleRule[];
      expect(
        rules
          .find((rule) => rule.selectorText?.includes('.material-modal[data-closed]'))!
          .style.getPropertyPriority('display'),
      ).toBe('important');
      view.rerender(
        <Overlay title="弹层" triggerLabel="打开测试" width={480}>
          内容
        </Overlay>,
      );
      expect(popup.style.width).toBe('');
      expect(popup.style.getPropertyValue('--modal-width')).toBe('480px');
      styleElement.remove();
    },
  );
  it('retains hidden tab semantics even with an explicit display and supports every insertable general material', () => {
    const view = render(
      <TabsMaterial value="one">
        <TabPanelMaterial value="one" label="第一页">
          第一页内容
        </TabPanelMaterial>
        <TabPanelMaterial value="two" label="第二页" style={{ display: 'flex' }}>
          第二页内容
        </TabPanelMaterial>
      </TabsMaterial>,
    );
    const inactive = screen.getByText('第二页内容');
    expect(inactive.hidden).toBe(true);
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.append(styleElement);
    expect(
      ([...styleElement.sheet!.cssRules] as CSSStyleRule[])
        .find((rule) => rule.selectorText === '.material-tab-panel[hidden]')!
        .style.getPropertyPriority('display'),
    ).toBe('important');
    styleElement.remove();
    view.unmount();
    for (const [id, metadata] of Object.entries(catalog)) {
      if (metadata.palette === false || metadata.insertable === false) continue;
      expect(registry.components[id].style, id).toBeTruthy();
    }
    expect(registry.components['react.counter'].style).toBeUndefined();
    expect(registry.components['ui.table'].style!.properties).not.toContain('fontSize');
  });
});
