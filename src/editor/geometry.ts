/** display:contents hosts have no own box; measure their visible material descendants. */
export function nodeRect(
  marker: Element,
):
  | { left: number; top: number; right: number; bottom: number; width: number; height: number }
  | undefined {
  // Accessibility helpers may have a positive box at viewport (0, 0), despite
  // being completely clipped. They must not enlarge selection or drop bounds.
  const clipped = new Map<Element, boolean>();
  const isClipped = (element: Element): boolean => {
    if (element === marker) return false;
    const cached = clipped.get(element);
    if (cached !== undefined) return cached;
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    const clipPath = style.clipPath.replace(/\s/g, '');
    const clip = style.clip.replace(/\s|px/g, '');
    const hidden =
      style.display === 'none' ||
      clipPath === 'inset(50%)' ||
      clip === 'rect(0,0,0,0)' ||
      (!!element.parentElement && isClipped(element.parentElement));
    clipped.set(element, hidden);
    return hidden;
  };
  const rects = [...marker.querySelectorAll('*')]
    .filter(
      (element) =>
        !element.classList.contains('editor-node') &&
        !element.classList.contains('canvas-overlays') &&
        !isClipped(element) &&
        !['hidden', 'collapse'].includes(
          element.ownerDocument.defaultView!.getComputedStyle(element).visibility,
        ),
    )
    .map((element) => element.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return;
  const left = Math.min(...rects.map((r) => r.left)),
    top = Math.min(...rects.map((r) => r.top)),
    right = Math.max(...rects.map((r) => r.right)),
    bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Sibling insertion follows the actual parent layout, including horizontal rows. */
export function nodeFlow(marker: Element): { axis: 'x' | 'y'; reverse: boolean } {
  let parent = marker.parentElement;
  while (
    parent &&
    parent.ownerDocument.defaultView!.getComputedStyle(parent).display === 'contents'
  )
    parent = parent.parentElement;
  if (!parent) return { axis: 'y', reverse: false };
  const style = parent.ownerDocument.defaultView!.getComputedStyle(parent);
  const horizontal =
    (style.display.includes('flex') && !style.flexDirection.startsWith('column')) ||
    (style.display.includes('grid') && style.gridTemplateColumns.trim().split(/\s+/).length > 1);
  if (!horizontal) return { axis: 'y', reverse: style.flexDirection === 'column-reverse' };
  return {
    axis: 'x',
    reverse: (style.flexDirection === 'row-reverse') !== (style.direction === 'rtl'),
  };
}
