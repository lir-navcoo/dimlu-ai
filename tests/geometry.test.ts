import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeRect } from '../src/editor/geometry';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('material bounds', () => {
  it('ignores Base UI clipped helpers at the viewport origin, keeping the full visible selection border', () => {
    document.body.innerHTML =
      '<div data-editor-node="select"><div class="field"><button>选择</button><input aria-hidden="true" style="position:fixed;left:0;top:0;width:1px;height:1px;clip-path:inset(50%)" /></div></div>';
    const marker = document.querySelector('[data-editor-node]')!;
    vi.spyOn(document.querySelector('.field')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 250, 500, 55),
    );
    vi.spyOn(document.querySelector('button')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 273, 500, 32),
    );
    vi.spyOn(document.querySelector('input')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 1, 1),
    );
    expect(nodeRect(marker)).toEqual({
      left: 300,
      top: 250,
      right: 800,
      bottom: 305,
      width: 500,
      height: 55,
    });
  });

  it('excludes descendants of clipped helpers while retaining visible decorative aria-hidden elements', () => {
    document.body.innerHTML =
      '<div data-editor-node="select"><button aria-hidden="true">图标</button><div style="clip:rect(0px, 0px, 0px, 0px)"><span>辅助内容</span></div></div>';
    vi.spyOn(document.querySelector('button')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 250, 500, 32),
    );
    vi.spyOn(document.querySelector('span')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(-500, -500, 100, 100),
    );
    expect(nodeRect(document.querySelector('[data-editor-node]')!)).toEqual({
      left: 300,
      top: 250,
      right: 800,
      bottom: 282,
      width: 500,
      height: 32,
    });
  });
});
