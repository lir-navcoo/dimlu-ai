import { mkdir, writeFile } from 'node:fs/promises';
import { applicationJsonSchema } from '../packages/schema/schema.ts';
import { purchaseManagementExample } from '../src/purchase-management-example.ts';

await mkdir('public/schema', { recursive: true });
await mkdir('public/examples', { recursive: true });
await writeFile(
  'public/schema/application.v0.1.json',
  JSON.stringify(applicationJsonSchema, null, 2) + '\n',
);
await writeFile(
  'public/examples/starter.json',
  JSON.stringify(purchaseManagementExample, null, 2) + '\n',
);
await writeFile(
  'public/examples/purchase-management.json',
  JSON.stringify(purchaseManagementExample, null, 2) + '\n',
);
console.log('Exported application schema, starter, action and data source examples.');
