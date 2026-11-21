import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { startApplication } from '../src/bootstrap';

const html = readFileSync('index.html', 'utf8');
function mountShell() {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  return document.getElementById('startup-status')!;
}
afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('independent startup fallback', () => {
  it('shows an ESM missing-export rejection before React can load and retries only by explicit reload without touching storage', async () => {
    const raw = '{"storageVersion":1,"protected":"saved project"}';
    localStorage.setItem('dimlu.workbench.project.v1', raw);
    sessionStorage.setItem('unsaved-session', 'keep');
    const shell = mountShell();
    const load = vi
      .fn()
      .mockRejectedValue(
        new SyntaxError(
          "The requested module '/packages/schema/schema.ts' does not provide an export named 'applicationJsonSchema'",
        ),
      );
    const reload = vi.fn();
    expect(shell.hidden).toBe(false);
    expect(shell.textContent).toContain('正在启动');
    expect(await startApplication(shell, load, reload)).toBe(false);
    expect(shell.getAttribute('role')).toBe('alert');
    expect(shell.textContent).toContain('应用启动失败');
    expect(shell.querySelector('#startup-details')!.textContent).toContain('applicationJsonSchema');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(shell.querySelector('#startup-retry')!);
    expect(reload).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(localStorage.getItem('dimlu.workbench.project.v1')).toBe(raw);
    expect(sessionStorage.getItem('unsaved-session')).toBe('keep');
  });
  it('removes the loading shell on successful module load and renders diagnostic text without HTML injection on failure', async () => {
    const shell = mountShell();
    expect(await startApplication(shell, async () => {}, vi.fn())).toBe(true);
    expect(shell.hidden).toBe(true);
    const next = mountShell();
    expect(
      await startApplication(
        next,
        async () => {
          throw new Error('<img src=x onerror=alert(1)>');
        },
        vi.fn(),
      ),
    ).toBe(false);
    expect(next.querySelector('#startup-details')!.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
    expect(next.querySelector('img')).toBeNull();
  });
  it('wires HTML to an entry with no static imports, keeping main and its static App graph behind dynamic import', () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('script[type="module"]')?.getAttribute('src')).toBe(
      '/src/bootstrap.ts',
    );
    expect(parsed.getElementById('startup-retry')).toBeTruthy();
    const source = ts.createSourceFile(
      'bootstrap.ts',
      readFileSync('src/bootstrap.ts', 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(source.statements.some(ts.isImportDeclaration)).toBe(false);
    const dynamicImports: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        dynamicImports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(dynamicImports).toContain('./main');
  });
});
