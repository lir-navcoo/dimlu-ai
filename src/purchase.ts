/** Ordinary TypeScript shared by the runtime computation, React preview and mock service. */
export function lineTotal(item: Readonly<Record<string, unknown>>): number {
  const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
  const price = typeof item.price === 'number' ? item.price : 0;
  return Math.round(quantity * price * 100) / 100;
}
export function purchaseTotal(values: Readonly<Record<string, unknown>>): number {
  const items = Array.isArray(values.items) ? values.items : [];
  return items.reduce((cents, item) => cents + Math.round(lineTotal(item) * 100), 0) / 100;
}
