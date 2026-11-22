import { Boxes, Database, Code2, Files, Workflow } from 'lucide-react';
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
    id: 'structure',
    title: '结构',
    icon: Boxes,
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
export type EditorPanelId = (typeof editorPanelRoutes)[number]['id'] | 'materials';
export function editorPanelRoute(id: string) {
  const normalizedId = id === 'materials' ? 'structure' : id;
  return editorPanelRoutes.find((panel) => panel.id === normalizedId);
}
