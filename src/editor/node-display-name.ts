import type { NodeSchema } from '../../packages/schema/types';
import { readNodeName } from '../../packages/schema/node-name';

/** Each author surface retains its own historical fallback for unnamed nodes. */
export function displayNodeName(node: NodeSchema, legacyFallback: string): string {
  return readNodeName(node) ?? legacyFallback;
}

/** Names are not identity: keep the material type and stable node ID available. */
export function describeNodeName(node: NodeSchema, materialTitle: string): string {
  const name = readNodeName(node);
  return `${name ? name + ' · ' : ''}${materialTitle} · ${node.id}`;
}
