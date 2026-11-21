import { nodePath } from '../../packages/editor/node-path';
import type { NodeSchema, PageSchema } from '../../packages/schema/types';
import type { MaterialPresentation } from '../../packages/react-runtime/Renderer';
import { catalog } from './catalog';
import { nodeRect } from './geometry';
import { canvasViewport, nearestInstance, clippingBounds, intersectRect } from './CanvasHost';
import { toParentRect } from './coordinates';
function mappedRect(marker: HTMLElement) {
  const rect = nodeRect(marker);
  return rect && toParentRect(rect, marker.ownerDocument);
}
export type OverlayFocus = {
  pageId: string;
  nodeId: string;
  instanceKey: string;
  ancestors: string[];
  branch: string[];
  instances: number;
};
export function isDesignOverlay(node: NodeSchema) {
  return catalog[node.component]?.design?.kind === 'overlay';
}
export function overlayDefinition(page: PageSchema, nodeId: string | null) {
  return nodePath(page, nodeId)
    .reverse()
    .find((entry) => isDesignOverlay(entry.node))?.node;
}
export function resolveOverlayFocus(
  surface: HTMLElement,
  page: PageSchema,
  nodeId: string | null,
  selectedInstance?: { nodeId: string; instanceKey?: string } | null,
): OverlayFocus | null {
  const definition = overlayDefinition(page, nodeId);
  if (!definition) return null;
  const markers = [...surface.querySelectorAll<HTMLElement>('[data-editor-node]')];
  const targets = markers.filter(
    (marker) => marker.dataset.editorNode === definition.id && !marker.dataset.editorInactive,
  );
  if (!targets.length) return null;
  const selected =
    selectedInstance?.nodeId === nodeId && selectedInstance.instanceKey
      ? markers.find((marker) => marker.dataset.editorInstance === selectedInstance.instanceKey)
      : undefined;
  const exact = selected?.closest<HTMLElement>('[data-editor-overlay]');
  let target = exact?.dataset.editorNode === definition.id ? exact : undefined;
  if (!target) {
    const direct = targets.flatMap((marker) => {
      const rect = mappedRect(marker);
      return rect ? [{ key: marker.dataset.editorInstance!, rect, marker }] : [];
    });
    const visible = direct.filter((item) => {
      const bounds = clippingBounds(item.marker, surface);
      return bounds && intersectRect(item.rect, bounds);
    });
    const proxies = direct.length
      ? []
      : targets.flatMap((marker) => {
          let ancestor = marker.parentElement?.closest<HTMLElement>('[data-editor-node]') ?? null;
          while (ancestor) {
            const rect = mappedRect(ancestor);
            if (rect) return [{ key: marker.dataset.editorInstance!, rect, marker }];
            ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-editor-node]') ?? null;
          }
          return [];
        });
    target =
      nearestInstance(
        visible.length ? visible : direct.length ? direct : proxies,
        canvasViewport(surface),
      )?.marker ?? targets[0];
  }
  const branch: string[] = [],
    ancestors: string[] = [];
  let ancestor = target.parentElement?.closest<HTMLElement>('[data-editor-node]') ?? null;
  while (ancestor) {
    if (ancestor.dataset.editorInstance) branch.push(ancestor.dataset.editorInstance);
    if (ancestor.hasAttribute('data-editor-overlay') && ancestor.dataset.editorInstance)
      ancestors.push(ancestor.dataset.editorInstance);
    ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-editor-node]') ?? null;
  }
  return {
    pageId: page.id,
    nodeId: definition.id,
    instanceKey: target.dataset.editorInstance!,
    ancestors,
    branch,
    instances: targets.length,
  };
}
export function overlayPresentation(
  focus: OverlayFocus | null,
  node: NodeSchema,
  instanceKey: string,
): MaterialPresentation {
  const inside =
    !!focus &&
    (instanceKey === focus.instanceKey || instanceKey.startsWith(focus.instanceKey + '/'));
  return {
    hidden: !!focus && !inside && !focus.branch.includes(instanceKey),
    ...(isDesignOverlay(node)
      ? {
          overlay:
            focus?.instanceKey === instanceKey
              ? ('expanded' as const)
              : focus?.ancestors.includes(instanceKey)
                ? ('ancestor' as const)
                : ('collapsed' as const),
        }
      : {}),
  };
}
