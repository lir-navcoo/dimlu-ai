import { describe, it, expect } from 'vitest';
import { registry } from '../src/materials';

describe('audit: all components declare onClick', () => {
  it('every component has onClick in events', () => {
    const missing: string[] = [];
    for (const [name, contract] of Object.entries(registry.components)) {
      if (!(contract.events ?? []).includes('onClick')) missing.push(name);
    }
    if (missing.length) console.log('MISSING_ONCLICK:', missing.join(', '));
    expect(missing).toEqual([]);
  });
});
