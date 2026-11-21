import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, selectPage } from './ui-helpers';

const originalWidth = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

describe('Base UI workbench', () => {
  it('selects a portaled option with the keyboard and restores focus to its trigger', async () => {
    seedLegacyProject();
    render(<App />);
    const trigger = screen.getByRole('combobox', { name: '标题绑定方式' });
    fireEvent.click(trigger);
    const expression = screen.getByRole('option', { name: '表达式' });
    fireEvent.keyDown(expression, { key: 'Enter' });
    expect(trigger.getAttribute('data-value')).toBe('expression');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    changeControl(screen.getByRole('textbox', { name: '标题' }), '"键盘编辑"');
    expect(screen.getByRole('heading', { name: '键盘编辑' })).toBeTruthy();
  });

  it('preserves React local state when switching design and inspector tabs', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const counter = screen.getByRole('button', { name: /本地计数/ });
    fireEvent.click(counter);
    fireEvent.click(screen.getByRole('tab', { name: '结构' }));
    fireEvent.click(screen.getByRole('tab', { name: '添加组件' }));
    fireEvent.click(screen.getByRole('tab', { name: '组件树' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    expect(screen.getByRole('button', { name: /本地计数/ })).toBe(counter);
    expect(counter.textContent).toContain('1');
  });

  it('opens narrow-screen panels, restores focus and retains form input after closing', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const input = screen.getByRole('textbox', { name: '申请名称' });
    changeControl(input, '抽屉开关保留');
    const trigger = screen.getByRole('button', { name: '打开属性检查器' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '属性检查器' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭属性检查器' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole('textbox', { name: '申请名称' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('抽屉开关保留');
    fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
    expect(screen.getByRole('dialog', { name: '页面设计' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭页面设计' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
