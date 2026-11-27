import { createElement, Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';

const allowedTags = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);
const droppedTags = new Set(['iframe', 'object', 'script', 'style', 'svg', 'math', 'template']);
const safeStyleProperties = new Set([
  'color',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
  'line-height',
  'margin-left',
  'text-indent',
]);

export function normalizeLegacyListHtml(html: string) {
  const rewriteList = (tag: 'ul' | 'ol', style: string) =>
    html.replace(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'), (_match, inner) =>
      (inner as string).replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_item, content) =>
          `<p class="slate-legacyListHtml" data-slate-type="legacyListHtml" data-slate-list-style-type="${style}">${content}</p>`,
      ),
    );
  return rewriteList('ul', 'disc').replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner) =>
    (inner as string).replace(
      /<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_item, content) =>
        `<p class="slate-legacyListHtml" data-slate-type="legacyListHtml" data-slate-list-style-type="decimal">${content}</p>`,
    ),
  );
}

export function safeUrl(value: string, kind: 'href' | 'src') {
  const url = value.trim();
  if (!url || /[\u0000-\u0020\\]/.test(url) || url.startsWith('//')) return undefined;
  if (/^https?:/i.test(url)) {
    try {
      return /^https?:\/\/[^/]/i.test(url) && new URL(url).hostname ? url : undefined;
    } catch {
      return undefined;
    }
  }
  if (kind === 'href' && /^(mailto:|tel:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  return url;
}

function safeStyle(source: string): CSSProperties | undefined {
  if (typeof document === 'undefined') return undefined;
  const parsed = document.createElement('span');
  parsed.setAttribute('style', source);
  const result: Record<string, string> = {};
  for (const property of safeStyleProperties) {
    const value = parsed.style.getPropertyValue(property);
    if (value && !/url\s*\(|expression|[<>]/i.test(value)) {
      const key = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      result[key] = value;
    }
  }
  return Object.keys(result).length ? (result as CSSProperties) : undefined;
}

function safeAttributes(element: Element) {
  const attributes: Record<string, string | number | CSSProperties> = {};
  for (const name of ['data-list-style-type', 'data-list-start']) {
    const value = element.getAttribute(name);
    if (value && (name !== 'data-list-style-type' || /^[a-z-]+$/i.test(value))) {
      attributes[name] = value;
    }
  }
  const style = element.getAttribute('style');
  if (style) {
    const filtered = safeStyle(style);
    if (filtered) attributes.style = filtered;
  }
  if (element.tagName === 'A') {
    const href = element.getAttribute('href');
    const safe = href && safeUrl(href, 'href');
    if (safe) {
      attributes.href = safe;
      attributes.rel = 'noopener noreferrer';
    }
    if (element.getAttribute('target') === '_blank') attributes.target = '_blank';
  }
  if (element.tagName === 'IMG') {
    const src = element.getAttribute('src');
    const safe = src && safeUrl(src, 'src');
    if (safe) attributes.src = safe;
    const alt = element.getAttribute('alt');
    if (alt !== null) attributes.alt = alt;
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    if (width && /^\d{1,4}$/.test(width)) attributes.width = Number(width);
    if (height && /^\d{1,4}$/.test(height)) attributes.height = Number(height);
  }
  if (element.tagName === 'OL') {
    const start = element.getAttribute('start');
    if (start && /^\d{1,6}$/.test(start)) attributes.start = Number(start);
  }
  return attributes;
}

function renderNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase();
  if (droppedTags.has(tag)) return null;
  const children = Array.from(node.childNodes).map((child, index) =>
    renderNode(child, `${key}.${index}`),
  );
  if (!allowedTags.has(tag)) return <Fragment key={key}>{children}</Fragment>;
  if (tag === 'img') {
    const props = safeAttributes(node);
    return props.src ? <img key={key} {...props} /> : null;
  }
  if (tag === 'br' || tag === 'hr') return createElement(tag, { key, ...safeAttributes(node) });
  return createElement(tag, { key, ...safeAttributes(node) }, children);
}

export function RichTextView({
  html,
  className = 'plate-rich-text-editor',
}: {
  html: string;
  className?: string;
}) {
  const content = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const template = document.createElement('template');
    template.innerHTML = html;
    return Array.from(template.content.childNodes).map((node, index) =>
      renderNode(node, String(index)),
    );
  }, [html]);
  return <div className={className}>{content}</div>;
}
