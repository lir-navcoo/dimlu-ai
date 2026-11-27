import { useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Dialog } from '@base-ui/react/dialog';
import { HardDrive, ChevronDown, CircleAlert } from 'lucide-react';
import { useDirtyDraftCount } from './session';
import { Button, Tip } from '../ui/primitives';
import type { ProjectStorage, ProjectStorageSnapshot } from '../../packages/editor/project-storage';

function downloadRaw(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'dimlu-project-recovery.txt';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ProjectMenu({
  project,
  snapshot,
}: {
  project: ProjectStorage;
  snapshot: ProjectStorageSnapshot;
}) {
  const [confirmation, setConfirmation] = useState<'replace' | 'reset' | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const dirtyDrafts = useDirtyDraftCount();
  const draftLabel = `${dirtyDrafts} 项未应用草稿`;
  const label =
    snapshot.status === 'saved'
      ? '已保存'
      : snapshot.status === 'saving'
        ? '保存中…'
        : snapshot.status === 'protected'
          ? '恢复受保护'
          : '保存失败';
  return (
    <>
      <div className={`project-storage ${snapshot.error ? 'has-error' : ''}`}>
        <Menu.Root>
          <Tip
            content={dirtyDrafts ? `本地项目 · ${draftLabel}` : '本地项目与保存状态'}
            side="bottom"
          >
            <Menu.Trigger className="ui-button" aria-label="本地项目菜单">
              <HardDrive size={14} />
              <span role="status" aria-label="本地保存状态">
                {label}
              </span>
              {dirtyDrafts > 0 && (
                <CircleAlert
                  size={13}
                  className="project-drafts-indicator"
                  role="img"
                  aria-label={draftLabel}
                />
              )}
              <ChevronDown size={12} />
            </Menu.Trigger>
          </Tip>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} className="menu-positioner">
              <Menu.Popup className="ui-menu project-menu">
                <p className="editor-note">项目定义自动保存在当前浏览器</p>
                {dirtyDrafts > 0 && <p className="project-drafts-indicator">{draftLabel}</p>}
                {snapshot.error && (
                  <p role="alert" className="project-error">
                    {snapshot.error}
                    {snapshot.protected ? '；原存储未改动。' : ''}
                  </p>
                )}
                {!snapshot.protected && (
                  <Menu.Item
                    className="ui-menu-item"
                    aria-keyshortcuts="Control+S Meta+S"
                    onClick={snapshot.status === 'error' ? project.retry : project.flush}
                  >
                    {snapshot.status === 'error' ? '重试保存当前项目' : '立即保存项目'}
                  </Menu.Item>
                )}
                {snapshot.raw !== null && (
                  <Menu.Item className="ui-menu-item" onClick={() => downloadRaw(snapshot.raw!)}>
                    导出恢复原文
                  </Menu.Item>
                )}
                {snapshot.protected && (
                  <Menu.Item className="ui-menu-item" onClick={() => setConfirmation('replace')}>
                    用当前项目替换本地副本…
                  </Menu.Item>
                )}
                <Menu.Item className="ui-menu-item" onClick={() => setConfirmation('reset')}>
                  重置项目…
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <Dialog.Root
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal project-confirmation" initialFocus={cancel}>
            <Dialog.Title className="project-confirmation-title">
              {confirmation === 'reset' ? '重置本地项目？' : '替换受保护的本地副本？'}
            </Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              {confirmation === 'reset'
                ? '当前项目将恢复初始示例，撤销历史和未提交草稿将清除。'
                : '将用当前已提交的项目定义覆盖无法恢复的原副本。建议先导出恢复原文；未提交的面板草稿不包含在内。'}
            </Dialog.Description>
            <div className="project-confirmation-actions">
              <Dialog.Close className="ui-button" ref={cancel}>
                取消
              </Dialog.Close>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirmation === 'reset') project.reset();
                  else project.confirmReplacement();
                  setConfirmation(null);
                }}
              >
                {confirmation === 'reset' ? '确认重置' : '确认替换'}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
