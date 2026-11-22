import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { registry } from '../src/materials';
import { DebugDock } from '../src/editor/DebugDock';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';

afterEach(cleanup);

describe('history timeline panel', () => {
  it('lists operations with the current step highlighted and jumps on click', () => {
    const document = new EditorDocument(structuredClone(purchaseManagementExample), registry);
    document.select('purchases', 'purchase-heading');
    document.setProp('purchases', 'purchase-heading', 'title', {
      kind: 'literal',
      value: '第一次修改',
    });
    document.setProp('purchases', 'purchase-heading', 'title', {
      kind: 'literal',
      value: '第二次修改',
    });

    const runtimes: PageRuntime[] = [];
    function Scene() {
      const [open, setOpen] = useState(true);
      const runtime = new PageRuntime(document.getSnapshot().plan, 'purchases');
      runtimes.push(runtime);
      return (
        <DebugDock
          document={document}
          runtime={runtime}
          plan={runtime.plan}
          authorSnapshot={document.getSnapshot()}
          open={open}
          setOpen={setOpen}
          height={240}
          maxHeight={500}
          setHeight={() => {}}
          mobile={false}
        />
      );
    }
    render(
      <EditorSessionProvider>
        <TipProvider>
          <Scene />
        </TipProvider>
      </EditorSessionProvider>,
    );
    // Cleanup runs after the assertions below via afterEach + dispose at the end.
    fireEvent.click(screen.getByRole('tab', { name: '操作历史' }));
    const timeline = screen.getByRole('list', { name: '操作历史时间线' });
    expect(timeline.textContent).toContain('修改属性 title');
    // Steps: oldest → newest; the current step is not a button.
    const steps = [...timeline.querySelectorAll('button.history-step')];
    expect(steps).toHaveLength(2);
    // Click the oldest entry → jump to step 0.
    fireEvent.click(steps[0]);
    expect(
      findNode(
        document.getSnapshot().plan.schema.pages[0],
        'purchase-heading',
      )!.node.props.title,
    ).toEqual({ kind: 'literal', value: '采购申请管理' });
    // Timeline reflects the jump: one redoable future entry.
    expect(document.getHistory().future).toHaveLength(2);
    runtimes.forEach((runtime) => runtime.dispose());
  });
});
