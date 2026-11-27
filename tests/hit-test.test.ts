import { afterEach, describe, expect, it, vi } from 'vitest';
import { hitTestDrop } from '../src/editor/hit-test';
import { compileApplication } from '../packages/runtime/engine';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';

const plan = compileApplication(exampleApplication, registry);
const descriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (descriptor) Object.defineProperty(document, 'elementFromPoint', descriptor);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
function hit(element: Element) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => element });
}
function rect(element: Element, x: number, y: number, w = 100, h = 40) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, w, h));
}
describe('drop geometry', () => {
  it('uses left and right halves for a horizontal row, including reverse direction', () => {
    document.body.innerHTML =
      '<div data-editor-node="purchase-note"><div style="display:flex;flex-direction:row"><div data-editor-node="purchase-notice"><p>说明</p></div></div></div>';
    const text = document.querySelector('p')!,
      parent = text.parentElement!.parentElement!;
    rect(text, 50, 50, 200, 40);
    hit(text);
    expect(hitTestDrop({ x: 75, y: 70 }, plan, 'purchase')).toEqual({
      kind: 'before',
      nodeId: 'purchase-notice',
    });
    expect(hitTestDrop({ x: 225, y: 70 }, plan, 'purchase')).toEqual({
      kind: 'after',
      nodeId: 'purchase-notice',
    });
    parent.style.flexDirection = 'row-reverse';
    expect(hitTestDrop({ x: 75, y: 70 }, plan, 'purchase')).toEqual({
      kind: 'after',
      nodeId: 'purchase-notice',
    });
  });
  it('resolves gaps between root nodes and children instead of dropping at the page or container end', () => {
    document.body.innerHTML =
      '<div class="editor-surface"><div data-editor-node="purchase-heading"><h2>标题</h2></div><div data-editor-node="purchase-form"><form><div data-editor-node="purchase-name"><input /></div><div data-editor-node="purchase-items"><section>明细</section></div></form></div></div>';
    const surface = document.querySelector('.editor-surface')!,
      form = document.querySelector('form')!;
    rect(document.querySelector('h2')!, 0, 0);
    rect(form, 0, 100, 200, 300);
    rect(document.querySelector('input')!, 0, 120);
    rect(document.querySelector('section')!, 0, 220);
    hit(surface);
    expect(hitTestDrop({ x: 10, y: 50 }, plan, 'purchase')).toEqual({
      kind: 'after',
      nodeId: 'purchase-heading',
    });
    hit(form);
    expect(hitTestDrop({ x: 10, y: 210 }, plan, 'purchase')).toEqual({
      kind: 'before',
      nodeId: 'purchase-items',
    });
  });
});
