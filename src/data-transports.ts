import type { Registry } from '../packages/runtime/registry';
import { createRecordsTransports } from './records-transports';
import { createPurchaseTransports } from './purchase-transports';
const people = [
  { id: 'p1', name: '林知远', department: '研发中心' },
  { id: 'p2', name: '陈嘉宁', department: '产品设计部' },
  { id: 'p3', name: '周予安', department: '运营中心' },
];
export const demoTransports: NonNullable<Registry['transports']> = {
  ...createRecordsTransports(),
  ...createPurchaseTransports(),
  'demo.peopleQuery': {
    version: '1.0.0',
    input: { query: { type: 'string', required: true } },
    output: 'object',
    async execute(input, { signal }) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 180);
        signal.addEventListener('abort', abort, { once: true });
      });
      const query = String(input.query).trim();
      if (query === '失败') throw new Error('模拟查询失败，请修改查询条件后重试');
      const rows = people.filter((person) => `${person.name}${person.department}`.includes(query));
      return { rows, total: rows.length };
    },
  },
};
