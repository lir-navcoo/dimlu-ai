import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import postcss, { type ChildNode } from 'postcss';
import { describe, expect, it } from 'vitest';

// Frozen independently from the current partitioned sources after isolating project-storage UI.
// Keep this test runnable from the repository alone; no external pipeline/snapshot dependency.
// Pre-extraction styles.css: 9fac727d2c13b1e1fafd0c798566509fd130c8838d341127d66864ed8ba18fa1.
// Normalization: drop imports; flatten ONLY top-level @layer base into [base, raw child];
// preserve every other raw top-level subtree as [null, raw node], in its original order.
const PARTITIONED_LEAF_DIGEST = 'cfcf216abee7a1f421ead784356319c8a9a76dc1f79f8f94cb24dca95b1121de';
const PROJECT_STORAGE_DIGEST = 'f0e77e43ae3e28a475ee6db291126a7cb792a3a2e2871a8f8594cfc53a955aa2';
const ORIGINAL_MARKER_DIGEST = '9a71e4d94563ca07dfb96e8aa0f623a2b93f743d3f6d93d42c95086a3975da53';
const ORIGINAL_OVERLAY_REMAINDER_DIGEST =
  '9226f94d7b03cf4c0b1f172f37b52322d2c949729a53679545b684e4c9d1fec4';
const sourceEntry = new FileURL('../src/styles.css', import.meta.url);
const overlayEntry = new FileURL('../src/editor/overlay-focus.css', import.meta.url);
const ORDERED_IMPORTS = [
  './ui/styles/base-tokens.css',
  './editor/styles/shell-base.css',
  './ui/styles/base-controls.css',
  './ui/styles/primitives.css',
  './editor/styles/shell-frame.css',
  './ui/styles/popup-positioner.css',
  './editor/styles/shell-panels.css',
  './ui/styles/runtime-errors.css',
  './editor/styles/shell-tree.css',
  './editor/styles/content-dropzones.css',
  './editor/styles/shell-drag.css',
  './editor/styles/content-markers.css',
  './editor/styles/shell-selection.css',
  './materials/styles/legacy.css',
  './editor/styles/shell-options.css',
  './materials/styles/legacy-overrides.css',
  './editor/styles/shell-responsive.css',
  './ui/styles/tooltip-positioner.css',
  './editor/styles/shell-inspectors.css',
  './ui/styles/tooltip.css',
  './editor/styles/content-cursors.css',
];
const BASE_WRAPPER_IMPORTS = [
  './ui/styles/base-tokens.css',
  './editor/styles/shell-base.css',
  './ui/styles/base-controls.css',
];
const ADDITIVE_IMPORTS = [
  './editor/styles/project-storage.css',
  './editor/styles/workbench-navigation.css',
];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// The original reviewed digest was captured with CRLF. Keep the raw subtree
// comparison stable across Git checkout settings without changing that baseline.
const read = (file: FileURL) => readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n');
function importPath(node: ChildNode): string {
  expect(node.type).toBe('atrule');
  if (node.type !== 'atrule') throw new Error('Expected a CSS import');
  expect(node.name).toBe('import');
  expect(node.params).toMatch(/^'[^']+'$/);
  return node.params.slice(1, -1);
}

describe('runtime shared CSS partition', () => {
  it('preserves all 460 ordered raw nodes through the shared imports and three named base wrappers', () => {
    const entry = postcss.parse(read(sourceEntry));
    const imports = entry.nodes.map(importPath);
    expect(imports).toEqual(['tailwindcss', ...ORDERED_IMPORTS, ...ADDITIVE_IMPORTS]);
    const leaves: [string | null, string][] = [];
    const baseFiles: string[] = [];
    let baseLeaves = 0;
    // Actual ordered imports are the implementation under test; the digest locks the reviewed
    // shared partition and is never rebuilt from these files during the test.
    for (const relative of imports.slice(1, 1 + ORDERED_IMPORTS.length)) {
      const chunk = postcss.parse(read(new FileURL(relative, sourceEntry)));
      for (const node of chunk.nodes) {
        if (node.type === 'atrule' && node.name === 'layer' && node.params === 'base') {
          baseFiles.push(relative);
          expect(chunk.nodes).toHaveLength(1);
          expect(node.nodes).toBeDefined();
          for (const child of node.nodes ?? []) {
            leaves.push(['base', child.toString()]);
            baseLeaves++;
          }
        } else {
          leaves.push([null, node.toString()]);
        }
      }
    }
    expect(baseFiles).toEqual(BASE_WRAPPER_IMPORTS);
    expect(baseLeaves).toBe(11);
    expect(leaves).toHaveLength(460);
    expect(digest(JSON.stringify(leaves))).toBe(PARTITIONED_LEAF_DIGEST);
  });

  it('extracts only the exact hidden marker while preserving the three original parent overlay subtrees', () => {
    const overlay = postcss.parse(read(overlayEntry));
    expect(overlay.nodes).toHaveLength(4);
    expect(importPath(overlay.nodes[0])).toBe('./styles/content-visibility.css');
    const markerFile = new FileURL('./styles/content-visibility.css', overlayEntry);
    const markerText = read(markerFile);
    expect(postcss.parse(markerText).nodes).toHaveLength(1);
    expect(digest(markerText)).toBe(ORIGINAL_MARKER_DIGEST);
    const remainder = overlay.nodes.slice(1).map((node) => node.toString());
    expect(remainder).toHaveLength(3);
    expect(digest(JSON.stringify(remainder))).toBe(ORIGINAL_OVERLAY_REMAINDER_DIGEST);
  });

  it('keeps project storage styles isolated from the shared CSS partition', () => {
    const projectStorage = postcss.parse(read(new FileURL(ADDITIVE_IMPORTS[0], sourceEntry)));
    expect(projectStorage.nodes).toHaveLength(12);
    expect(digest(JSON.stringify(projectStorage.nodes.map((node) => node.toString())))).toBe(
      PROJECT_STORAGE_DIGEST,
    );
  });

  it('keeps new workbench navigation styles outside the frozen shared partition', () => {
    const navigation = postcss.parse(read(new FileURL(ADDITIVE_IMPORTS[1], sourceEntry)));
    expect(navigation.nodes.length).toBeGreaterThan(0);
    expect(navigation.nodes.every((node) => node.type !== 'atrule' || node.name !== 'import')).toBe(
      true,
    );
    expect(read(new FileURL('./editor/styles/shell-frame.css', sourceEntry))).not.toContain(
      '.app-header-context',
    );
    expect(read(new FileURL('./editor/styles/shell-responsive.css', sourceEntry))).not.toContain(
      '.app-header-context',
    );
  });
});
