import { Database, Code2, Files, LayoutGrid, ListTree, Workflow } from 'lucide-react';
/** Local panel routes share labels, size policy and mounting policy. */
export const editorPanelRoutes = [
  {
    id: 'pages',
    title: '页面',
    icon: Files,
    minWidth: 192,
    className: 'sidebar-content',
    lazy: true,
  },
  {
    id: 'materials',
    title: '组件',
    icon: LayoutGrid,
    minWidth: 192,
    className: 'sidebar-content components-workspace',
    lazy: false,
  },
  {
    id: 'outline',
    title: '大纲',
    icon: ListTree,
    minWidth: 192,
    className: 'sidebar-content components-workspace',
    lazy: false,
  },
  {
    id: 'data',
    title: '数据',
    icon: Database,
    minWidth: 280,
    className: 'sidebar-content data-content',
    lazy: true,
  },
  {
    id: 'logic',
    title: '页面逻辑',
    icon: Workflow,
    minWidth: 280,
    className: 'sidebar-content data-content',
    lazy: true,
  },
  {
    id: 'code',
    title: '代码',
    icon: Code2,
    minWidth: 360,
    className: 'sidebar-content code-content',
    lazy: true,
  },
] as const;
export type EditorPanelId = (typeof editorPanelRoutes)[number]['id'];
export function editorPanelRoute(id: string) {
  // 会话里可能残留拆分前的 'structure' 值：大纲面板承接它。
  const normalizedId = id === 'structure' ? 'outline' : id;
  return editorPanelRoutes.find((panel) => panel.id === normalizedId);
}
