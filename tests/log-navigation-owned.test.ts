import { describe, expect, it } from 'vitest';
import { EditorNavigation, type LocateRequest } from '../src/editor/navigation';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { registry } from '../src/materials';

const application: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'owned-navigation',
  title: 'Local',
  entryPageId: 'page',
  dependencies: { components: { 'ui.text': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: 'Page',
      state: [],
      children: ['target', 'other'].map((id) => ({
        id,
        component: 'ui.text',
        props: { value: { kind: 'literal' as const, value: id } },
      })),
    },
  ],
};
function setup() {
  const document = new EditorDocument(application, registry);
  const navigation = new EditorNavigation();
  const environment = {
    document,
    plan: document.getSnapshot().plan,
    pageId: 'page',
    enabled: true,
    dragging: false,
  };
  navigation.bind(environment);
  return { document, navigation, environment };
}

describe('043 independently owned exact navigation request protocol', () => {
  it('returns its exact locally allocated object with unchanged fields and leaves original callers strictly boolean', () => {
    const { document, navigation } = setup();
    const first = navigation.requestLocateOwned('tree', 'target');
    expect(first).toBe(navigation.getSnapshot().request);
    expect(first).toEqual({
      sequence: 1,
      destination: 'tree',
      nodeId: 'target',
      pageId: 'page',
      document,
      plan: document.getSnapshot().plan,
      selection: document.getSnapshot().selection,
    });
    expect(navigation.requestLocate('canvas', 'target', 'instance-1')).toBe(true);
    expect(navigation.getSnapshot().request).toMatchObject({
      sequence: 2,
      destination: 'canvas',
      nodeId: 'target',
      instanceKey: 'instance-1',
    });
    expect(navigation.requestLocate('tree', 'unknown')).toBe(false);
  });

  it('early same-target nested replacement cannot substitute public foreignR2 for exact returned ownR1', () => {
    const { navigation } = setup();
    let nested = false;
    let foreign: LocateRequest | null = null;
    navigation.subscribe(() => {
      if (nested || !navigation.getSnapshot().request) return;
      nested = true;
      expect(navigation.requestLocate('tree', 'target')).toBe(true);
      foreign = navigation.getSnapshot().request;
    });
    const own = navigation.requestLocateOwned('tree', 'target');
    expect(own).not.toBeNull();
    expect(own).not.toBe(foreign);
    expect(own?.sequence).toBe(1);
    expect(foreign).toMatchObject({ sequence: 2 });
    expect(navigation.getSnapshot().request).toBe(foreign);
    expect(navigation.isCurrent(own!)).toBe(false);
    navigation.complete(own!, '');
    expect(navigation.getSnapshot().request).toBe(foreign);
    navigation.complete(foreign!, 'foreign completed');
    expect(navigation.getSnapshot().message).toBe('foreign completed');
  });

  it('nested hover retains ownR1 and exact cancellation clears that request without dropping foreign hover', () => {
    const { navigation } = setup();
    let nested = false;
    navigation.subscribe(() => {
      if (nested || !navigation.getSnapshot().request) return;
      nested = true;
      navigation.setHover({ pageId: 'page', nodeId: 'other' }, 'tree');
    });
    const own = navigation.requestLocateOwned('tree', 'target');
    expect(own).toBe(navigation.getSnapshot().request);
    expect(navigation.isCurrent(own!)).toBe(true);
    expect(navigation.getSnapshot().hover?.nodeId).toBe('other');
    navigation.complete(own!, '');
    expect(navigation.getSnapshot().request).toBeNull();
    expect(navigation.getSnapshot().hover?.nodeId).toBe('other');
  });

  it('returns exact own object even when an early subscriber synchronously completes it before return', () => {
    const { navigation } = setup();
    let seen: LocateRequest | null = null;
    navigation.subscribe(() => {
      const request = navigation.getSnapshot().request;
      if (!request || seen) return;
      seen = request;
      navigation.complete(request, 'early consumer');
    });
    const own = navigation.requestLocateOwned('tree', 'target');
    expect(own).toBe(seen);
    expect(own).not.toBeNull();
    expect(navigation.getSnapshot().request).toBeNull();
    expect(navigation.isCurrent(own!)).toBe(false);
    expect(navigation.getSnapshot().message).toBe('early consumer');
    expect(navigation.requestLocate('tree', 'other')).toBe(true);
  });

  it('availability refusal publishes nothing and allocates no sequence for old or additive APIs', () => {
    const { navigation, environment } = setup();
    const first = navigation.requestLocateOwned('tree', 'target')!;
    navigation.bind({ ...environment, enabled: false });
    let publications = 0;
    const stop = navigation.subscribe(() => publications++);
    expect(navigation.requestLocateOwned('tree', 'target')).toBeNull();
    expect(navigation.requestLocate('tree', 'target')).toBe(false);
    expect(publications).toBe(0);
    navigation.bind(environment);
    const next = navigation.requestLocateOwned('tree', 'other')!;
    stop();
    expect(next.sequence).toBe(first.sequence + 1);
  });

  it('same-target owned nested calls each return their own object instead of reading latest snapshot', () => {
    const { navigation } = setup();
    let nested = false;
    let inner: LocateRequest | null = null;
    navigation.subscribe(() => {
      if (nested || !navigation.getSnapshot().request) return;
      nested = true;
      inner = navigation.requestLocateOwned('tree', 'target');
    });
    const outer = navigation.requestLocateOwned('tree', 'target');
    expect(outer).not.toBe(inner);
    expect(outer?.sequence).toBe(1);
    expect(inner).toMatchObject({ sequence: 2 });
    expect(navigation.getSnapshot().request).toBe(inner);
    navigation.complete(outer!, '');
    expect(navigation.getSnapshot().request).toBe(inner);
  });
});
