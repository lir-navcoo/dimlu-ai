import { exampleApplication } from './fixtures/examples';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';

/** Legacy boundary scenarios explicitly restore their original fixture; the product starter may evolve. */
export function seedLegacyProject() {
  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({
      storageVersion: 1,
      savedAt: 'legacy-test-fixture',
      schema: exampleApplication,
      selection: { pageId: 'purchase', nodeId: 'purchase-heading' },
    }),
  );
}
