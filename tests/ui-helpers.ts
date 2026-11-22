import { fireEvent, screen } from '@testing-library/react';

/** Exercise the actual portaled Base UI options, or a native text input. */
export function changeControl(control: HTMLElement, value: string) {
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control.getAttribute('role') !== 'combobox'
  ) {
    fireEvent.change(control, { target: { value } });
    return;
  }
  fireEvent.click(control);
  const option = screen.getAllByRole('option').find((item) => item.dataset.value === value);
  if (!option) throw new Error(`Missing option ${value}`);
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
}
export function showMaterials() {
  fireEvent.click(screen.getByRole('tab', { name: '组件' }));
}
export function showStructure() {
  fireEvent.click(screen.getByRole('tab', { name: '大纲' }));
}
export function insertMaterial(title = '标题', intent: object = { kind: 'inside' }) {
  showMaterials();
  fireEvent.keyDown(screen.getByRole('button', { name: `拖入 ${title}` }), { key: ' ' });
  changeControl(screen.getByLabelText('拖放位置'), JSON.stringify(intent));
  fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
}
export function moveNode(id: string, intent: object) {
  showStructure();
  fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`^拖动 .* ${id}$`) }), {
    key: ' ',
  });
  changeControl(screen.getByLabelText('拖放位置'), JSON.stringify(intent));
  fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
}
export function selectPage(id: string) {
  fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
  const option = screen.getAllByRole('option').find((item) => item.dataset.value === id);
  if (!option) throw new Error(`Missing page ${id}`);
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
}
/**
 * Open the action config dialog for the nth (1-based) call of the current chain.
 * Parameters live inside the dialog, so every parameter interaction must run
 * after this. Closes a previously open dialog first: while a dialog is open the
 * compact rows are aria-hidden and unreachable.
 */
export function openActionConfig(n: number) {
  closeActionConfig();
  const open = screen.queryByRole('button', { name: `打开动作 ${n} 配置` });
  if (open) fireEvent.click(open);
}
/**
 * Close the action config dialog ("完成"). While the dialog is open the rest of
 * the panel is aria-hidden, so panel-level controls (保存事件 etc.) are only
 * reachable after closing. No-op when the dialog is not open.
 */
export function closeActionConfig() {
  const done = screen.queryByRole('button', { name: '完成' });
  if (done) fireEvent.click(done);
}
