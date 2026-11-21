import { StrictMode, useCallback, useReducer } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { ReferencePaths } from '../src/editor/ReferencePaths';
import { bindingDraft } from '../src/editor/ValueEditor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { acceptedReference, referenceAuthor } from './reference-paths-fixture';

/** Real store and helper; an intentionally held parent dispatch distinguishes request from ACK. */
export function reopenHarness(options: { strict?: boolean } = {}) {
  const { author, request } = referenceAuthor();
  const initial = bindingDraft(acceptedReference(author), { type: 'string' });
  let session!: ReturnType<typeof useEditorSession>;
  let refresh!: () => void;
  let hold = false;
  let allowed = true;
  let renders = 0;
  const observation = vi.fn();
  const chosen = vi.fn();
  function Owner() {
    session = useEditorSession();
    const [, dispatch] = useReducer((value: number) => value + 1, 0);
    refresh = dispatch;
    const requestCallerRender = useCallback(() => {
      observation();
      if (!hold) dispatch();
    }, []);
    renders++;
    const entry = session.drafts.read('reopen-owner', 'canonical', initial);
    const snapshot = author.getSnapshot();
    const page = snapshot.plan.pages.get('a')!.schema;
    return (
      <ReferencePaths
        label="续开"
        owner={{
          document: author,
          snapshot,
          nodeId: 'bound',
          property: 'value',
          draftIdentity: entry.value,
          subscribeDraft: session.drafts.subscribe,
          canChoose: () => allowed,
          requestCallerRender,
        }}
        page={page}
        source={page.dataSources![0]}
        binding={entry.value}
        onChoose={chosen}
      />
    );
  }
  const content = (
    <EditorSessionProvider>
      <TipProvider>
        <Owner />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(options.strict ? <StrictMode>{content}</StrictMode> : content);
  return {
    author,
    request,
    view,
    chosen,
    observation,
    session: () => session,
    entry: () => session.drafts.read('reopen-owner', 'canonical', initial),
    hold: (next: boolean) => {
      hold = next;
    },
    allow: (next: boolean) => {
      allowed = next;
    },
    acknowledge: () => refresh(),
    renders: () => renders,
  };
}
