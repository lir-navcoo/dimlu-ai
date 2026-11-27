import { useLayoutEffect, useRef } from 'react';

export const resizingWindows = new WeakSet<Window>();
export const isSaveKeyFamily = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>) =>
  (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';

/** Popup libraries keep their own key policy; author actions only accept this narrow key. */
export function isAuthorEscape(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.cancelBubble &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

/** The closed drag-destination button is an author control, not a text editor. */
export function isEscapeTextTarget(
  event: KeyboardEvent,
  destination: HTMLElement | null,
  document = window.document,
): boolean {
  const target = event.target;
  const view = document.defaultView;
  if (!view || !(target instanceof view.Element) || target.ownerDocument !== document) return false;
  if (
    (target instanceof view.HTMLElement && target.isContentEditable) ||
    target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"]',
    )
  )
    return true;
  const combobox = target.closest('[role="combobox"]');
  return !!(
    combobox && !(combobox instanceof view.HTMLButtonElement && destination?.contains(combobox))
  );
}

/** Standalone Canvas only: the integrated host already has DragDrop's sole fallback endpoint. */
export function useStandaloneCanvasEscape(enabled: boolean) {
  const endpoint = useRef<{
    composing: boolean;
    candidates: WeakMap<KeyboardEvent, () => boolean>;
  } | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const current = {
      composing: false,
      candidates: new WeakMap<KeyboardEvent, () => boolean>(),
    };
    endpoint.current = current;
    const key = (event: KeyboardEvent) => {
      const action = current.candidates.get(event);
      current.candidates.delete(event);
      if (
        endpoint.current !== current ||
        current.composing ||
        !isAuthorEscape(event) ||
        isEscapeTextTarget(event, null)
      )
        return;
      if (action?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const compositionStart = () => {
      current.composing = true;
    };
    const compositionEnd = () => {
      current.composing = false;
    };
    const blur = () => {
      current.composing = false;
      current.candidates = new WeakMap();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('compositionstart', compositionStart, true);
    window.addEventListener('compositionend', compositionEnd, true);
    window.addEventListener('blur', blur);
    return () => {
      if (endpoint.current === current) endpoint.current = null;
      window.removeEventListener('keydown', key);
      window.removeEventListener('compositionstart', compositionStart, true);
      window.removeEventListener('compositionend', compositionEnd, true);
      window.removeEventListener('blur', blur);
      current.candidates = new WeakMap();
    };
  }, [enabled]);
  return (event: KeyboardEvent, action: () => boolean) => {
    const current = endpoint.current;
    if (
      !enabled ||
      !current ||
      current.composing ||
      !isAuthorEscape(event) ||
      isEscapeTextTarget(event, null)
    )
      return;
    current.candidates.set(event, action);
  };
}
