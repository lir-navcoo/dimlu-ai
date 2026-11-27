import type { NodeSchema, Value } from '../packages/schema/types';

const literal = (value: string | number): Value => ({ kind: 'literal', value });

/**
 * Designed page header shared by every example case: an emphasized title with an
 * optional muted description, so cases no longer look like migrated leftovers.
 */
export function pageHeader(id: string, title: string, note?: string): NodeSchema[] {
  const heading: NodeSchema = {
    id,
    component: 'ui.text',
    props: { value: literal(title) },
    style: {
      fontSize: literal(22),
      fontWeight: literal(700),
      color: literal('#1e293b'),
      lineHeight: literal(1.4),
      ...(note ? { marginBottom: literal(2) } : {}),
    },
  };
  if (note === undefined) return [heading];
  return [
    heading,
    {
      id: `${id}-note`,
      component: 'ui.text',
      props: { value: literal(note), tone: literal('muted') },
      style: { fontSize: literal(13), lineHeight: literal(1.7) },
    },
  ];
}
