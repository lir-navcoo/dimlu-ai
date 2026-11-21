import { FormSubmissionError } from '../packages/runtime/form';
import type { Registry } from '../packages/runtime/registry';
export type RecordEntry = { id: string; name: string; department: string; amount: number };
const sampleRows = (): RecordEntry[] =>
  Array.from({ length: 23 }, (_, index) => ({
    id: `record-${index + 1}`,
    name: `成员${String(index + 1).padStart(2, '0')}`,
    department: ['研发中心', '产品设计部', '运营中心'][index % 3],
    amount: Math.round((index * 137.5 + 100) * 100) / 100,
  }));
async function wait(signal: AbortSignal, ms: number) {
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
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Each factory is an isolated mock service; query and mutation share only its business dataset. */
export function createRecordsTransports(
  options: { rows?: RecordEntry[]; delayMs?: number } = {},
): NonNullable<Registry['transports']> {
  let rows = structuredClone(options.rows ?? sampleRows());
  let failNextQuery = false;
  const delay = options.delayMs ?? 220;
  return {
    'demo.recordsQuery': {
      version: '1.0.0',
      input: {
        query: { type: 'string', required: true },
        page: { type: 'number', required: true },
        pageSize: { type: 'number', required: true },
        sortKey: { type: 'string', required: true },
        sortDirection: { type: 'string', required: true },
      },
      output: 'object',
      async execute(input, { signal }) {
        if (
          !Number.isInteger(input.page) ||
          Number(input.page) < 1 ||
          !Number.isInteger(input.pageSize) ||
          Number(input.pageSize) < 1 ||
          Number(input.pageSize) > 100
        )
          throw new Error('页码或每页条数无效');
        const key = String(input.sortKey),
          direction = String(input.sortDirection);
        if (
          (key && !['name', 'department', 'amount'].includes(key)) ||
          (key && !['asc', 'desc'].includes(direction)) ||
          (!key && direction)
        )
          throw new Error('排序参数无效');
        await wait(signal, delay);
        if (String(input.query) === '查询失败') throw new Error('模拟查询失败，请修改条件后重试');
        if (failNextQuery) {
          failNextQuery = false;
          throw new Error('模拟列表刷新失败，请仅重试刷新');
        }
        const query = String(input.query).trim();
        const filtered = rows.filter((row) => `${row.name}${row.department}`.includes(query));
        if (key)
          filtered.sort((a, b) => {
            const av = a[key as keyof RecordEntry],
              bv = b[key as keyof RecordEntry];
            const result =
              typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv), 'zh-CN', { numeric: true });
            return (direction === 'asc' ? result : -result) || a.id.localeCompare(b.id);
          });
        const pageSize = Number(input.pageSize),
          total = filtered.length,
          page = Math.min(Number(input.page), Math.max(1, Math.ceil(total / pageSize)));
        return {
          items: filtered.slice((page - 1) * pageSize, page * pageSize),
          total,
          page,
          pageSize,
          sort: key ? { key, direction } : null,
        };
      },
    },
    'demo.recordSave': {
      version: '1.0.0',
      input: { id: { type: 'string', required: true }, values: { type: 'object', required: true } },
      output: 'object',
      async execute(input, { signal }) {
        const values = input.values as Record<string, unknown>;
        if (typeof values.name !== 'string' || !values.name.trim())
          throw new FormSubmissionError('请填写姓名', { name: '请填写姓名' });
        if (typeof values.department !== 'string' || !values.department.trim())
          throw new FormSubmissionError('请填写部门', { department: '请填写部门' });
        if (
          typeof values.amount !== 'number' ||
          !Number.isFinite(values.amount) ||
          values.amount < 0
        )
          throw new FormSubmissionError('金额必须为非负数', { amount: '金额必须为非负数' });
        const saved = {
          id: String(input.id),
          name: values.name.trim(),
          department: values.department.trim(),
          amount: values.amount,
        };
        await wait(signal, delay);
        if (!rows.some((row) => row.id === saved.id)) throw new Error('记录不存在，请重新查询');
        if (saved.name.includes('保存失败'))
          throw new FormSubmissionError('模拟保存失败，输入已保留', {
            name: '姓名包含“保存失败”，请修改后重试',
          });
        rows = rows.map((row) => (row.id === saved.id ? saved : row));
        if (saved.name.includes('刷新失败')) failNextQuery = true;
        return { id: saved.id };
      },
    },
  };
}
