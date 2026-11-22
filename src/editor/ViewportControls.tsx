import { useEffect, useId, useState } from 'react';
import { Info, Monitor, RotateCcw, Scan, Smartphone, Tablet } from 'lucide-react';
import { Button, Input, Select, Tip } from '../ui/primitives';
import { useEditorViewport } from './session';
import { useDragDrop } from './DragDrop';
import { resolveViewport, type ViewportPreset } from './viewport';
const percentages = [50, 67, 75, 80, 90, 100, 110, 125, 150];
export function ViewportControls({ mode }: { mode: 'edit' | 'preview' }) {
  const { viewport, state } = useEditorViewport();
  const metrics = resolveViewport(state, mode);
  const dragging = !!useDragDrop()?.isInteracting || state.interacting;
  const preview = mode === 'preview';
  const [draft, setDraft] = useState(String(state.customWidth));
  const [error, setError] = useState('');
  const errorId = useId();
  useEffect(() => {
    setDraft(String(state.customWidth));
    setError('');
  }, [state.customWidth, state.preset]);
  const commit = () => {
    if (dragging) return;
    const value = Number(draft.trim());
    if (!/^\d+$/.test(draft.trim()) || !Number.isInteger(value) || value < 240 || value > 3840) {
      setError('请输入 240–3840 之间的整数宽度');
      return;
    }
    viewport.setCustomWidth(value);
    setDraft(String(value));
    setError('');
  };
  const percentage = Number((metrics.scale * 100).toFixed(1));
  const width = Number(metrics.width.toFixed(1));
  const manualPercent =
    state.zoom.kind === 'manual' ? Number((state.zoom.scale * 100).toFixed(6)) : 100;
  const zoomValue = preview ? '100' : state.zoom.kind === 'fit' ? 'fit' : String(manualPercent);
  const options = percentages.includes(manualPercent)
    ? percentages
    : [...percentages, manualPercent].sort((a, b) => a - b);
  const DeviceIcon = state.preset === 'phone' ? Smartphone : state.preset === 'tablet' ? Tablet : Monitor;
  return (
    <div className="viewport-controls" role="group" aria-label="画布视口">
      <div className="viewport-device-group" role="group" aria-label="页面布局宽度">
        <DeviceIcon size={14} aria-hidden="true" />
        <Tip content="页面布局宽度" side="bottom" disabled={dragging}>
          <span className="viewport-device-select">
            <Select
              aria-label="画布设备宽度"
              value={state.preset}
              disabled={dragging}
              onValueChange={(value) => viewport.setPreset(value as ViewportPreset)}
            >
              <option value="auto">自适应</option>
              <option value="desktop">桌面 · 1440</option>
              <option value="tablet">平板 · 768</option>
              <option value="phone">手机 · 390</option>
              <option value="custom">自定义宽度</option>
            </Select>
          </span>
        </Tip>
        {state.preset === 'custom' && (
          <label className="viewport-custom-width">
            <Input
              aria-label="自定义画布宽度"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              inputMode="numeric"
              value={draft}
              disabled={dragging}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraft(String(state.customWidth));
                  setError('');
                }
              }}
            />
            <span aria-hidden="true">px</span>
          </label>
        )}
        <output className="viewport-width" aria-label="实际页面宽度">
          {width} px
        </output>
      </div>
      <div className="viewport-zoom-group">
        <Tip
          content={
            preview
              ? '预览按100%显示，返回编辑恢复原倍率'
              : '画布显示比例，选择百分比将退出适应宽度'
          }
          side="bottom"
          disabled={dragging}
        >
          <span className="viewport-zoom-select">
            <Select
              aria-label="画布缩放"
              value={zoomValue}
              disabled={dragging || preview}
              onValueChange={(value) =>
                value === 'fit' ? viewport.setFit() : viewport.setScale(Number(value) / 100)
              }
            >
              <option value="fit">
                {state.zoom.kind === 'fit' && !preview ? '适应 · ' + percentage + '%' : '适应宽度'}
              </option>
              {options.map((value) => (
                <option key={value} value={String(value)}>
                  {Number(value.toFixed(1))}%
                </option>
              ))}
            </Select>
          </span>
        </Tip>
        <Tip content="适应画布可用宽度" side="bottom" disabled={dragging || preview}>
          <Button
            variant="ghost"
            aria-label="适应画布宽度"
            aria-pressed={!preview && state.zoom.kind === 'fit'}
            disabled={dragging || preview}
            onClick={() => viewport.setFit()}
          >
            <Scan size={14} />
          </Button>
        </Tip>
        <Tip content="恢复100%显示" side="bottom" disabled={dragging || preview}>
          <Button
            variant="ghost"
            aria-label="恢复画布100%"
            disabled={dragging || preview}
            onClick={() => viewport.setScale(1)}
          >
            <RotateCcw size={13} />
            <span>100%</span>
          </Button>
        </Tip>
      </div>
      {preview ? (
        <span className="viewport-feedback">预览按100%显示</span>
      ) : metrics.fitClamped ? (
        <span className="viewport-feedback" role="status">
          已达{metrics.scale === 0.5 ? '50%下限' : '150%上限'}，当前 {percentage}%
        </span>
      ) : null}
      <Tip
        content="仅调整页面容器宽度；媒体查询和视口单位仍以浏览器窗口为准。"
        side="bottom"
        disabled={dragging}
      >
        <Button
          className="viewport-info"
          variant="ghost"
          aria-label="画布宽度说明"
          disabled={dragging}
        >
          <Info size={13} />
        </Button>
      </Tip>
      {error && (
        <span className="viewport-width-error" role="alert" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
