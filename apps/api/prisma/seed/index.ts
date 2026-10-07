import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../../src/config/load-env.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { SEED_ANCHOR_DATE } from './anchor.js';
import { seedDemoPaymentAccount, seedDemoPrices, seedDemoRooms } from './demo.js';
import { DEV_SEED_USER_KEYS, SEED_USERS, seedFoundation } from './foundation.js';

async function main(): Promise<void> {
  loadEnv();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed chỉ dùng cho môi trường dev. Từ chối chạy khi NODE_ENV=production.');
  }
  const owner = process.env.SEED_OWNER_PASSWORD;
  const staff = process.env.SEED_STAFF_PASSWORD;
  if (!owner || owner.length < 8 || !staff || staff.length < 8) {
    throw new Error('Thiếu SEED_OWNER_PASSWORD / SEED_STAFF_PASSWORD (tối thiểu 8 ký tự) trong .env.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await seedFoundation(prisma, { owner, staff }, DEV_SEED_USER_KEYS);
    const rooms = await seedDemoRooms(prisma);
    console.log(`Phòng demo: ${rooms}`);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: SEED_USERS.owner.email } });
    console.log(`Giá demo mới: ${await seedDemoPrices(prisma, ownerUser.id)}`);
    if (await seedDemoPaymentAccount(prisma, ownerUser.id)) console.log('Tài khoản nhận tiền DEMO: Vietcombank 0011223344 (không chuyển tiền thật).');
    console.log(`Seed xong (anchor ${SEED_ANCHOR_DATE}). Tài khoản dev:`);
    for (const u of DEV_SEED_USER_KEYS.map((k) => SEED_USERS[k])) {
      const scope = u.role === 'OWNER' ? 'mọi tòa' : `tòa ${u.buildings.join(', ')}`;
      console.log(`  - ${u.email} (${u.role}, ${scope}) — mật khẩu: biến ${u.role === 'OWNER' ? 'SEED_OWNER_PASSWORD' : 'SEED_STAFF_PASSWORD'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
