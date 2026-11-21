/** Settle promptly on cancellation, even if an adapter ignores its signal. */
export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
}

export function abortable<T>(signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      Promise.resolve(operation()).then(
        (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}
