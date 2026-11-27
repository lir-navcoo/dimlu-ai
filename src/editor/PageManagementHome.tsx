import { useLayoutEffect, useSyncExternalStore } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { ProjectStorage, ProjectStorageSnapshot } from '../../packages/editor/project-storage';
import { refreshEditorDocument } from './refresh-document';
import { registry } from '../materials';
import { PagePanel } from './PagePanel';
import { Button } from '../ui/primitives';
import { BrandLogo } from '../ui/BrandLogo';
import { editorRoutePath } from './router';
import './page-management.css';

export function PageManagementHome({
  project,
  projectSnapshot,
  onBack,
  onManageApplication,
}: {
  project: ProjectStorage;
  projectSnapshot: ProjectStorageSnapshot;
  onBack: () => void;
  onManageApplication: () => void;
}) {
  const document = refreshEditorDocument(projectSnapshot.document, registry);
  useLayoutEffect(() => {
    project.bindDocument(document, registry);
  }, [project, document]);
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const navigatePage = (pageId: string) => {
    const current = document.getSnapshot();
    if (!current.plan.pages.has(pageId)) return;
    if (current.selection.pageId !== pageId) document.selectPage(pageId);
    window.history.pushState({}, '', editorRoutePath(pageId, 'outline'));
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  return (
    <main className="page-management-home">
      <header className="page-management-header">
        <div className="brand">
          <BrandLogo className="brand-logo" />
        </div>
        <div>
          <h1>应用页面</h1>
          <p>管理页面结构，选择页面进入搭建工作台。</p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={15} />
          返回编辑器
        </Button>
        <Button variant="ghost" onClick={onManageApplication}>
          <Settings2 size={15} />
          应用设置
        </Button>
      </header>
      {projectSnapshot.error && (
        <div className="project-storage-notice" role="alert">
          {projectSnapshot.error}
        </div>
      )}
      <section className="page-management-content">
        <PagePanel
          document={document}
          snapshot={snapshot}
          authoringAllowed
          onNavigatePage={navigatePage}
        />
      </section>
    </main>
  );
}
