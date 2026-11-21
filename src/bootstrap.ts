function showStartupFailure(error: unknown) {
  const shell = document.getElementById('startup-status');
  if (!shell) return;
  const title = shell.querySelector<HTMLElement>('#startup-title');
  const message = shell.querySelector<HTMLElement>('#startup-message');
  const details = shell.querySelector<HTMLElement>('#startup-details');
  const retry = shell.querySelector<HTMLButtonElement>('#startup-retry');
  if (!title || !message || !details || !retry) return;
  shell.hidden = false;
  shell.setAttribute('role', 'alert');
  title.textContent = '应用启动失败';
  message.textContent = '界面未能正常启动。请重试；本地项目数据保持不变。';
  details.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  details.hidden = false;
  retry.hidden = false;
}

/** Keep this entry independent of React and the entire application module graph. */
export async function startApplication(
  shell: HTMLElement,
  load: () => Promise<unknown>,
  reload: () => void,
): Promise<boolean> {
  const retry = shell.querySelector<HTMLButtonElement>('#startup-retry')!;
  retry.addEventListener('click', reload);
  try {
    // Dynamic import rejects on module fetch, parsing and static dependency linking errors.
    await load();
    shell.hidden = true;
    return true;
  } catch (error) {
    showStartupFailure(error);
    return false;
  }
}

const shell = document.getElementById('startup-status');
if (shell)
  void startApplication(
    shell,
    () => import('./main'),
    () => window.location.reload(),
  );
