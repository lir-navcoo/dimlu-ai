import { FormSubmissionError } from '../packages/runtime/form';
import type { Registry } from '../packages/runtime/registry';
import { validTemporal } from '../packages/schema/formats';
import { purchaseTotal } from './purchase';

export type PurchaseItem = { name: string; quantity: number; price: number };
export type PurchaseRecord = {
  id: string;
  number: string;
  name: string;
  applicant: string;
  department: string;
  purchaseDate: string;
  approvalReason: string;
  items: PurchaseItem[];
  amount: number;
};
const departments = ['研发中心', '产品设计部', '运营中心', '行政管理部'];
function samplePurchases(): PurchaseRecord[] {
  return Array.from({ length: 16 }, (_, index) => {
    const items = [
      {
        name: ['办公显示器', '会议设备', '办公文具', '测试设备'][index % 4],
        quantity: (index % 3) + 1,
        price: [1299, 2380, 85.5, 1650][index % 4],
      },
    ];
    return {
      id: `purchase-${index + 1}`,
      number: `CG-2026-${String(index + 1).padStart(4, '0')}`,
      name: ['研发工位设备采购', '会议室设备补充', '日常办公用品采购', '项目测试设备采购'][
        index % 4
      ],
      applicant: ['林知远', '陈嘉宁', '周予安', '许亦宁'][index % 4],
      department: departments[index % 4],
      purchaseDate: `2026-11-${String((index % 8) + 1).padStart(2, '0')}`,
      approvalReason: '',
      items,
      amount: purchaseTotal({ items }),
    };
  });
}
function validateValues(input: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  for (const [key, label] of [
    ['name', '申请名称'],
    ['applicant', '申请人'],
    ['department', '部门'],
  ] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 80)
      fields[key] = `请填写有效的${label}（最多80字）`;
  }
  if (!validTemporal(input.purchaseDate, 'date')) fields.purchaseDate = '请选择有效的采购日期';
  if (Object.keys(fields).length) throw new FormSubmissionError('请检查申请基本信息', fields);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20)
    throw new Error('采购明细需为1–20行');
  const items: PurchaseItem[] = input.items.map((item: unknown) => {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80)
      throw new Error('请填写有效的物品名称');
    if (
      typeof row.quantity !== 'number' ||
      !Number.isInteger(row.quantity) ||
      row.quantity < 1 ||
      row.quantity > 999
    )
      throw new Error('数量需为1–999的整数');
    if (
      typeof row.price !== 'number' ||
      !Number.isFinite(row.price) ||
      row.price < 0 ||
      Math.abs(row.price * 100 - Math.round(row.price * 100)) >= 0.000001
    )
      throw new Error('单价需为非负金额，最多两位小数');
    return { name: row.name.trim(), quantity: row.quantity, price: row.price };
  });
  const amount = purchaseTotal({ items });
  if (!Number.isFinite(amount) || amount > 50000) throw new Error('单笔采购金额不能超过50,000元');
  const approvalReason =
    typeof input.approvalReason === 'string' ? input.approvalReason.trim() : '';
  if (amount > 10000 && !approvalReason)
    throw new FormSubmissionError('请补充审批说明', {
      approvalReason: '超过10,000元，请填写审批说明',
    });
  return {
    name: String(input.name).trim(),
    applicant: String(input.applicant).trim(),
    department: String(input.department).trim(),
    purchaseDate: String(input.purchaseDate),
    approvalReason,
    items,
    amount,
  };
}
function wait(signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
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
/** Local business service; each factory owns an isolated dataset, never browser project storage. */
export function createPurchaseTransports(
  options: { rows?: PurchaseRecord[]; delayMs?: number } = {},
): NonNullable<Registry['transports']> {
  let rows = structuredClone(options.rows ?? samplePurchases());
  let sequence = rows.length + 1;
  let failNextQuery = false;
  const delay = options.delayMs ?? 180;
  return {
    'demo.purchasesQuery': {
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
        const pageSize = Number(input.pageSize),
          requestedPage = Number(input.page),
          key = String(input.sortKey),
          direction = String(input.sortDirection);
        if (
          !Number.isInteger(pageSize) ||
          pageSize < 1 ||
          pageSize > 100 ||
          !Number.isInteger(requestedPage) ||
          requestedPage < 1
        )
          throw new Error('页码或每页条数无效');
        if (
          (key &&
            !['number', 'name', 'applicant', 'department', 'purchaseDate', 'amount'].includes(
              key,
            )) ||
          (key && !['asc', 'desc'].includes(direction)) ||
          (!key && direction)
        )
          throw new Error('排序参数无效');
        await wait(signal, delay);
        if (String(input.query).trim() === '查询失败')
          throw new Error('查询暂时失败，请修改条件后重试');
        if (failNextQuery) {
          failNextQuery = false;
          throw new Error('申请已保存，但列表刷新失败，请仅重试刷新');
        }
        const query = String(input.query).trim();
        const filtered = rows.filter((row) =>
          `${row.number} ${row.name} ${row.applicant} ${row.department}`.includes(query),
        );
        if (key)
          filtered.sort((a, b) => {
            const left = a[key as keyof PurchaseRecord],
              right = b[key as keyof PurchaseRecord];
            return (
              (direction === 'asc' ? 1 : -1) *
                (typeof left === 'number' && typeof right === 'number'
                  ? left - right
                  : String(left).localeCompare(String(right), 'zh-CN', { numeric: true })) ||
              a.id.localeCompare(b.id)
            );
          });
        const total = filtered.length,
          page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
        const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((row) => ({
          ...row,
          editValues: {
            name: row.name,
            applicant: row.applicant,
            department: row.department,
            purchaseDate: row.purchaseDate,
            approvalReason: row.approvalReason,
            items: row.items,
          },
        }));
        return {
          items: structuredClone(items),
          total,
          page,
          pageSize,
          sort: key ? { key, direction } : null,
        };
      },
    },
    'demo.purchaseSave': {
      version: '1.0.0',
      input: { id: { type: 'string', required: true }, values: { type: 'object', required: true } },
      output: 'object',
      async execute(input, { signal }) {
        const values = validateValues(input.values as Record<string, unknown>),
          id = String(input.id);
        if (id && !rows.some((row) => row.id === id))
          throw new Error('申请不存在，请刷新列表后重新选择');
        await wait(signal, delay);
        if (values.name.includes('保存失败'))
          throw new FormSubmissionError('申请保存失败，已保留输入，请修改后重试', {
            name: '申请名称包含“保存失败”，请修改后重试',
          });
        let saved: PurchaseRecord;
        if (id) {
          const previous = rows.find((row) => row.id === id)!;
          saved = { ...previous, ...values };
          rows = rows.map((row) => (row.id === id ? saved : row));
        } else {
          while (rows.some((row) => row.id === `purchase-${sequence}`)) sequence++;
          saved = {
            ...values,
            id: `purchase-${sequence}`,
            number: `CG-2026-${String(sequence).padStart(4, '0')}`,
          };
          sequence++;
          rows.unshift(saved);
        }
        if (values.name.includes('刷新失败')) failNextQuery = true;
        return { id: saved.id, number: saved.number, amount: saved.amount };
      },
    },
  };
}
