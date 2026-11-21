import { useContext, type ReactNode } from 'react';
import { editorContext } from '../editor/context';

export type RuntimeDomEnvironment = {
  document: Document;
  portalRoot: HTMLElement;
  isCurrent: () => boolean;
};
export type RuntimeDomValue = RuntimeDomEnvironment | null | undefined;
const RuntimeDom = editorContext<RuntimeDomValue>('runtime-dom-environment', undefined);
export const useRuntimeDomEnvironment = () => useContext(RuntimeDom);
export function RuntimeDomProvider({
  environment,
  children,
}: {
  environment: RuntimeDomValue;
  children: ReactNode;
}) {
  return <RuntimeDom.Provider value={environment}>{children}</RuntimeDom.Provider>;
}
export function isLiveDocument(document: Document | undefined): boolean {
  try {
    return !!document?.defaultView && document.defaultView.document === document;
  } catch {
    return false;
  }
}
/** Undefined retains legacy defaults; configured unavailable environments never escape them. */
export function runtimePortalContainer(
  environment: RuntimeDomValue,
  localRoot?: HTMLElement | null,
): HTMLElement | null | undefined {
  if (environment === undefined) return undefined;
  if (!environment) return null;
  try {
    const { document, portalRoot } = environment;
    if (
      !environment.isCurrent() ||
      !isLiveDocument(document) ||
      !portalRoot.isConnected ||
      portalRoot.ownerDocument !== document
    )
      return null;
    const root = localRoot === undefined ? portalRoot : localRoot;
    return root?.isConnected && root.ownerDocument === document ? root : null;
  } catch {
    return null;
  }
}
export function isDocumentNode(
  value: EventTarget | null,
  document: Document | undefined,
): value is Node {
  try {
    return (
      isLiveDocument(document) &&
      value instanceof document!.defaultView!.Node &&
      value.ownerDocument === document
    );
  } catch {
    return false;
  }
}
export function isDocumentElement(
  value: EventTarget | null,
  document: Document | undefined,
): value is Element {
  try {
    return isDocumentNode(value, document) && value instanceof document!.defaultView!.Element;
  } catch {
    return false;
  }
}
export function isDocumentInput(
  value: EventTarget | null,
  document: Document | undefined,
): value is HTMLInputElement {
  try {
    return (
      isDocumentNode(value, document) && value instanceof document!.defaultView!.HTMLInputElement
    );
  } catch {
    return false;
  }
}
