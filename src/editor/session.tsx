import { editorContext } from './context';
import {
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Button } from '../ui/primitives';
import { EditorNavigation } from './navigation';
import { ViewportStore } from './viewport';
import { editorPanelRoute, type EditorPanelId } from './panel-routes';

type Entry<T> = { value: T; source: string; dirty: boolean };
class DraftStore {
  private entries = new Map<string, Entry<unknown>>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  read<T>(key: string, source: string, initial: T): Entry<T> {
    let entry = this.entries.get(key) as Entry<T> | undefined;
    if (!entry || (!entry.dirty && entry.source !== source)) {
      entry = { value: initial, source, dirty: false };
      this.entries.set(key, entry);
    }
    return entry;
  }
  write<T>(key: string, value: Entry<T>) {
    this.entries.set(key, value);
    this.listeners.forEach((fn) => fn());
  }
  clear(key: string) {
    this.entries.delete(key);
    this.listeners.forEach((fn) => fn());
  }
  clearPrefix(prefix: string) {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
    this.listeners.forEach((fn) => fn());
  }
}
type DataTarget = {
  pageId: string;
  formId?: string;
  fieldId?: string;
  create?: boolean;
  nodeId?: string;
};
type Session = {
  drafts: DraftStore;
  navigation: EditorNavigation;
  viewport: ViewportStore;
  activatePanel: (id: string, reveal?: boolean) => void;
  leftTab: EditorPanelId;
  setLeftTab: (value: string) => void;
  leftOpen: boolean;
  setLeftOpen: (value: boolean) => void;
  revealLeft: boolean;
  setRevealLeft: (value: boolean) => void;
  dataTarget: DataTarget | null;
  openData: (target: DataTarget) => void;
};
const Context = editorContext<Session | null>('session', null);
export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new DraftStore());
  const [navigation] = useState(() => new EditorNavigation());
  useLayoutEffect(() => () => navigation.resetKeyboardInteraction(), [navigation]);
  const [viewport] = useState(() => new ViewportStore());
  const [leftTab, setLeftTab] = useState<EditorPanelId>('outline');
  const [leftOpen, setLeftOpen] = useState(false);
  const [revealLeft, setRevealLeft] = useState(false);
  const [dataTarget, setDataTarget] = useState<DataTarget | null>(null);
  const activatePanel = (id: string, reveal = true) => {
    const panel = editorPanelRoute(id);
    if (!panel) return;
    setLeftTab(panel.id);
    if (reveal) {
      setLeftOpen(true);
      setRevealLeft(true);
    }
  };
  return (
    <Context.Provider
      value={{
        drafts,
        navigation,
        viewport,
        activatePanel,
        leftTab,
        setLeftTab: (id) => activatePanel(id, false),
        leftOpen,
        setLeftOpen,
        revealLeft,
        setRevealLeft,
        dataTarget,
        openData: (target) => {
          setDataTarget(target);
          activatePanel('data');
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useEditorViewport() {
  const session = useContext(Context);
  const [fallback] = useState(() => new ViewportStore());
  const viewport = session?.viewport ?? fallback;
  const state = useSyncExternalStore(
    viewport.subscribe,
    viewport.getSnapshot,
    viewport.getSnapshot,
  );
  return { viewport, state };
}
export function useEditorNavigation() {
  const session = useContext(Context);
  const [fallback] = useState(() => new EditorNavigation());
  const navigation = session?.navigation ?? fallback;
  const state = useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot,
  );
  return { navigation, state };
}
export function useOptionalEditorSession() {
  return useContext(Context);
}
export function useEditorSession() {
  const session = useContext(Context);
  if (!session) throw new Error('EditorSessionProvider is required');
  return session;
}
/** Draft identity is independent of panel mounting and document revisions. */
export function useDraft<T>(key: string, source: string, initial: T) {
  const { drafts } = useEditorSession();
  const entry = useSyncExternalStore(drafts.subscribe, () => drafts.read(key, source, initial));
  const set = (next: SetStateAction<T>) => {
    const current = drafts.read(key, source, initial);
    const value = typeof next === 'function' ? (next as (value: T) => T)(current.value) : next;
    drafts.write(key, {
      value,
      source: current.source,
      dirty: JSON.stringify(value) !== JSON.stringify(initial),
    });
  };
  return [
    entry.value,
    set,
    {
      dirty: entry.dirty,
      stale: entry.dirty && entry.source !== source,
      reset: () => drafts.clear(key),
      rebase: () => drafts.write(key, { ...entry, source }),
    },
  ] as const;
}
export function useSessionState<T>(key: string, initial: T) {
  const [value, set] = useDraft(`ui:${key}`, 'ui', initial);
  return [value, set] as const;
}
export function DraftNotice({
  dirty,
  stale,
  reset,
  rebase,
}: {
  dirty: boolean;
  stale: boolean;
  reset: () => void;
  rebase: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className={`draft-notice ${stale ? 'stale' : ''}`} role="status">
      <span>
        {stale ? '当前定义已变化，草稿已保留。确认后可用草稿替换此配置。' : '有未保存草稿'}
      </span>
      <div>
        {stale && (
          <Button onClick={rebase} type="button">
            确认使用草稿
          </Button>
        )}
        <Button onClick={reset} type="button">
          放弃草稿
        </Button>
      </div>
    </div>
  );
}
