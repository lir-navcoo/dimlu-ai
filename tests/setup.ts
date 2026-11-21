// Workbench tests start at the supported desktop viewport; responsive cases resize explicitly.
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
// Persistence is real in App tests; each test starts with its own browser project.
import { beforeEach } from 'vitest';
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/editor');
});
