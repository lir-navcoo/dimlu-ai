export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  const visited = new WeakSet<object>();
  const pending: object[] = [value as object];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const child of Object.values(current))
      if (child !== null && typeof child === 'object') pending.push(child);

    if (!Object.isFrozen(current)) Object.freeze(current);
  }

  return value;
}
