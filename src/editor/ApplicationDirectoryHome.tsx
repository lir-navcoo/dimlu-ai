import { useState } from 'react';
import { Check, FolderKanban, Plus } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import type { ApplicationDirectory } from '../../packages/editor/application-directory';
import type { ApplicationDirectoryEntry } from '../../packages/editor/application-directory';
import { Button } from '../ui/primitives';
import { BrandLogo } from '../ui/BrandLogo';
import './page-management.css';

export function ApplicationDirectoryHome({
  directory,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  directory: ApplicationDirectory;
  onSelect: (appId: string) => void;
  onDuplicate: (appId: string) => string;
  onDelete: (appId: string, replacementAppId?: string) => void;
}) {
  const [applications, setApplications] = useState(() => directory.getApplications());
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ApplicationDirectoryEntry | null>(null);
  const [replacementAppId, setReplacementAppId] = useState('');
  const open = (application: ApplicationDirectoryEntry) => onSelect(application.key);
  const create = () => {
    try {
      const id = directory.createApplication();
      onSelect(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setApplications(directory.getApplications());
    }
  };
  const duplicate = (application: ApplicationDirectoryEntry) => {
    try {
      const id = onDuplicate(application.key);
      onSelect(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setApplications(directory.getApplications());
    }
  };
  const remove = () => {
    if (!deleting) return;
    try {
      onDelete(deleting.key, deleting.active ? replacementAppId : undefined);
      setDeleting(null);
      setError(null);
      setApplications(directory.getApplications());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <main className="page-management-home">
      <header className="page-management-header">
        <div className="brand">
          <BrandLogo className="brand-logo" />
        </div>
        <div>
          <h1>我的应用</h1>
          <p>选择一个应用开始搭建；每个应用拥有独立页面、逻辑定义与本地项目存储。</p>
        </div>
        <Button variant="primary" onClick={create}>
          <Plus size={15} />
          新建空白应用
        </Button>
      </header>
      {error && (
        <div className="project-storage-notice" role="alert">
          {error}
        </div>
      )}
      <section className="application-directory-content" aria-label="应用列表">
        {applications.map((application) => (
          <article className="application-directory-card" key={application.id}>
            <div className="application-directory-icon">
              <FolderKanban size={18} />
            </div>
            <div className="application-directory-info">
              <h2>{application.title}</h2>
              <code>{application.id}</code>
              <p>{application.pageCount} 个页面</p>
            </div>
            <div className="application-directory-actions">
              {application.active && (
                <span>
                  <Check size={14} /> 当前应用
                </span>
              )}
              <Button
                variant={application.active ? 'ghost' : 'primary'}
                onClick={() => open(application)}
              >
                {application.active ? '继续搭建' : '打开应用'}
              </Button>
              <Button variant="ghost" onClick={() => duplicate(application)}>
                复制
              </Button>
              <Button
                variant="danger"
                disabled={applications.length === 1}
                onClick={() => {
                  setReplacementAppId(
                    applications.find((item) => item.key !== application.key)?.key ?? '',
                  );
                  setDeleting(application);
                }}
              >
                删除
              </Button>
            </div>
          </article>
        ))}
      </section>
      <Dialog.Root open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal application-delete-dialog">
            <Dialog.Title>删除应用？</Dialog.Title>
            <Dialog.Description>
              将从应用目录中移除“{deleting?.title}”。本地存储文件会保留，不会物理删除。
            </Dialog.Description>
            {deleting?.active && (
              <label className="application-delete-replacement">
                替代当前应用
                <select
                  value={replacementAppId}
                  onChange={(event) => setReplacementAppId(event.target.value)}
                >
                  {applications
                    .filter((application) => application.key !== deleting.key)
                    .map((application) => (
                      <option key={application.key} value={application.key}>
                        {application.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="application-delete-actions">
              <Dialog.Close className="ui-button">取消</Dialog.Close>
              <Button
                variant="danger"
                onClick={remove}
                disabled={deleting?.active && !replacementAppId}
              >
                确认删除
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
