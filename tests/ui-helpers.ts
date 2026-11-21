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
  fireEvent.click(screen.getByRole('tab', { name: '结构' }));
  fireEvent.click(screen.getByRole('tab', { name: '添加组件' }));
}
export function showStructure() {
  fireEvent.click(screen.getByRole('tab', { name: '结构' }));
  fireEvent.click(screen.getByRole('tab', { name: '组件树' }));
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
