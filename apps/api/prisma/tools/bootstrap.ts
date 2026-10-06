import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../../src/config/load-env.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { bootstrapProduction } from '../seed/bootstrap.js';

/** `pnpm db:bootstrap` — chạy sau `prisma migrate deploy` ở mỗi lần triển khai (RUNBOOK.md). */
async function main(): Promise<void> {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    // eslint-disable-next-line no-console -- công cụ dòng lệnh, in kết quả cho người vận hành
    for (const line of await bootstrapProduction(prisma, process.env)) console.log(line);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
