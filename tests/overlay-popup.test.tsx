import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { DrawerMaterial } from '../src/materials/feedback';
import { SelectMaterial } from '../src/SelectMaterial';
import { Button, Select, Tip, TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
describe('popups within modal surfaces', () => {
  it('selects a business value through a body portal inside a controlled Drawer, returns focus, and closes popup before Drawer', async () => {
    const changes = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      const [department, setDepartment] = useState<string | null>(null);
      return (
        <TipProvider>
          <DrawerMaterial
            title="采购申请"
            open={open}
            onOpenChange={setOpen}
            showTrigger={false}
            showFooter={false}
          >
            <SelectMaterial
              label="所属部门"
              options={[
                { value: 'design', label: '产品设计部' },
                { value: 'rd', label: '研发中心' },
              ]}
              value={department}
              onValueChange={(value) => {
                changes(value);
                setDepartment(value as string);
              }}
            />
          </DrawerMaterial>
        </TipProvider>
      );
    }
    render(<Host />);
    const trigger = await screen.findByRole('combobox', { name: '所属部门' });
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: '研发中心' });
    expect(screen.getByRole('dialog', { name: '采购申请' }).contains(option)).toBe(false);
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    expect(changes).toHaveBeenCalledWith('rd');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.textContent).toContain('研发中心');
    fireEvent.click(trigger);
    fireEvent.keyDown(await screen.findByRole('option', { name: '研发中心' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog', { name: '采购申请' })).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '采购申请' })).toBeNull());
  });
  it('keeps primitive Select, Menu and custom Tip usable in the inspector modal without closing the parent', async () => {
    const command = vi.fn();
    function Host() {
      const [value, setValue] = useState('literal');
      return (
        <TipProvider>
          <Dialog.Root defaultOpen>
            <Dialog.Portal>
              <Dialog.Backdrop className="drawer-backdrop" />
              <Dialog.Popup className="side-drawer right">
                <Dialog.Title>属性检查器</Dialog.Title>
                <Select aria-label="取值方式" value={value} onValueChange={setValue}>
                  <option value="literal">固定值</option>
                  <option value="expression">表达式</option>
                </Select>
                <Menu.Root>
                  <Menu.Trigger className="ui-button">检查器操作</Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="menu-positioner">
                      <Menu.Popup className="ui-menu">
                        <Menu.Item onClick={command}>应用操作</Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
                <Tip content="字段配置帮助">
                  <Button>帮助</Button>
                </Tip>
                <Dialog.Close className="ui-button">关闭检查器</Dialog.Close>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </TipProvider>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('combobox', { name: '取值方式' });
    changeControl(trigger, 'expression');
    expect(trigger.dataset.value).toBe('expression');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    const menuTrigger = screen.getByRole('button', { name: '检查器操作' });
    fireEvent.click(menuTrigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: '应用操作' }));
    expect(command).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(menuTrigger));
    const help = screen.getByRole('button', { name: '帮助' });
    fireEvent.keyDown(menuTrigger, { key: 'Tab' });
    act(() => help.focus());
    expect((await screen.findByText('字段配置帮助')).closest('[data-open]')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '属性检查器' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭检查器' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '属性检查器' })).toBeNull());
  });
});
