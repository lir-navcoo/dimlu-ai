import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { keyboardHarness } from './keyboard-delete-fixture';

export function escapeHarness(children?: ReactNode) {
  return keyboardHarness({ children });
}
export function escapeEvent(init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
}
export async function pressEscape(target: Element | Window, init: KeyboardEventInit = {}) {
  const event = escapeEvent(init);
  await act(async () => {
    fireEvent(target, event);
    await Promise.resolve();
  });
  return event;
}
export async function flushEscape() {
  await act(async () => {
    await Promise.resolve();
  });
}
export function startKeyboardDrag() {
  const canvas = screen.getByLabelText('页面编辑画布');
  canvas.focus();
  fireEvent.keyDown(canvas, { key: ' ' });
  return screen.getByRole('combobox', { name: '拖放位置' });
}
export function materialPointer(
  type: 'pointerdown' | 'pointermove',
  target: Element | Window,
  x = 10,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
  return event;
}
