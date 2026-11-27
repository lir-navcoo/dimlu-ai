/** Viewport settings belong to the editing session, never to the page schema. */
export type ViewportPreset = 'auto' | 'desktop' | 'tablet' | 'phone' | 'custom';
export type ViewportZoom = { kind: 'manual'; scale: number } | { kind: 'fit' };
export type ViewportSettings = {
  preset: ViewportPreset;
  customWidth: number;
  zoom: ViewportZoom;
};
export type ViewportState = ViewportSettings & {
  availableWidth: number;
  availableHeight: number;
  measured: boolean;
  interacting: boolean;
};
export type ViewportMetrics = {
  width: number;
  scale: number;
  availableWidth: number;
  availableHeight: number;
  measured: boolean;
  fitClamped: boolean;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function resolveViewport(state: ViewportState, _mode: 'edit' | 'preview'): ViewportMetrics {
  const width =
    state.preset === 'auto'
      ? Math.max(240, state.availableWidth)
      : state.preset === 'desktop'
        ? 1440
        : state.preset === 'tablet'
          ? 768
          : state.preset === 'phone'
            ? 390
            : state.customWidth;
  const fit = state.availableWidth / width;
  return {
    width,
    scale: state.zoom.kind === 'fit' ? clamp(fit, 0.5, 1.5) : state.zoom.scale,
    availableWidth: state.availableWidth,
    availableHeight: state.availableHeight,
    measured: state.measured,
    fitClamped: state.zoom.kind === 'fit' && (fit < 0.5 || fit > 1.5),
  };
}
export class ViewportStore {
  private state: ViewportState = {
    preset: 'auto',
    customWidth: 960,
    zoom: { kind: 'manual', scale: 1 },
    availableWidth: 960,
    availableHeight: 600,
    measured: false,
    interacting: false,
  };
  private listeners = new Set<() => void>();
  private pendingSize:
    { availableWidth: number; availableHeight: number; measured: true } | undefined;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(next: ViewportState) {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false;
    this.state = next;
    this.listeners.forEach((listener) => listener());
    return true;
  }
  setPreset = (preset: ViewportPreset) => {
    if (
      this.state.interacting ||
      !['auto', 'desktop', 'tablet', 'phone', 'custom'].includes(preset)
    )
      return false;
    return this.update({ ...this.state, preset });
  };
  setCustomWidth = (width: number) => {
    if (this.state.interacting || !Number.isInteger(width) || width < 240 || width > 3840)
      return false;
    return this.update({ ...this.state, preset: 'custom', customWidth: width });
  };
  setScale = (scale: number) => {
    if (this.state.interacting || !Number.isFinite(scale)) return false;
    return this.update({ ...this.state, zoom: { kind: 'manual', scale: clamp(scale, 0.5, 1.5) } });
  };
  setFit = () =>
    this.state.interacting ? false : this.update({ ...this.state, zoom: { kind: 'fit' } });
  measure = (width: number, height: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const size = {
      availableWidth: Math.max(0, width),
      availableHeight: Math.max(0, height),
      measured: true as const,
    };
    if (this.state.interacting) {
      this.pendingSize = size;
      return;
    }
    this.update({ ...this.state, ...size });
  };
  setInteracting = (interacting: boolean) => {
    const size = !interacting ? this.pendingSize : undefined;
    if (!interacting) this.pendingSize = undefined;
    this.update({ ...this.state, ...size, interacting });
  };
}
