/**
 * Dữ liệu demo luồng điện nước trên database RIÊNG (tên phải kết thúc bằng _demo, mặc định ql_tro_demo).
 * Không đụng database dev (ql_tro), integration (ql_tro_test) hay E2E (ql_tro_e2e).
 *
 *   node apps/api/prisma/tools/demo-utilities.mjs db     # tạo/dọn sạch ql_tro_demo, áp migration, seed tài khoản + tòa A/B/C
 *   node apps/api/prisma/tools/demo-utilities.mjs data   # (api demo đang chạy ở :4200) tạo Tòa Demo, giá, A101/A102, nhận phòng 01/09
 *   node apps/api/prisma/tools/demo-utilities.mjs reset  # db + data: đưa demo về trạng thái ban đầu để thử lại
 *   node apps/api/prisma/tools/demo-utilities.mjs api    # chạy api demo :4200 (bản build) trên ql_tro_demo, kho tệp .data/files-demo
 *   node apps/api/prisma/tools/demo-utilities.mjs web    # chạy web demo :3200 (thư mục build .next-demo) → api :4200
 *
 * Kết quả: Tòa Demo (điện 3.500 đ/kWh, nước 15.000 đ/m³); A101 (điện 1.000, nước 50) và A102 (điện 2.000, nước 80)
 * có khách từ 01/09/2026, thông báo tháng 9 đã phát hành (không ghi nhận thu tiền, không gửi tin).
 * Việc còn lại để thử trên giao diện: chốt chỉ số tháng tiêu thụ 09/2026 rồi lập thông báo tháng 10/2026.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const devUrl = process.env.DATABASE_URL ?? 'postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro?schema=public';
export const DEMO_DATABASE_URL = process.env.DEMO_DATABASE_URL ?? devUrl.replace(/\/([^/?]+)(\?|$)/, '/$1_demo$2');
const API = process.env.DEMO_API_URL ?? 'http://localhost:4200';

async function resetDatabase() {
  const dbName = new URL(DEMO_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_demo')) throw new Error(`Database demo phải kết thúc bằng _demo (đang là ${dbName}).`);
  const admin = new pg.Client({ connectionString: DEMO_DATABASE_URL.replace(`/${dbName}`, '/postgres') });
  await admin.connect();
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const apiDir = path.join(ROOT, 'apps', 'api');
  const env = { ...process.env, DATABASE_URL: DEMO_DATABASE_URL, NODE_ENV: 'development' };
  execFileSync(process.execPath, [path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], { cwd: apiDir, env, stdio: 'pipe' });

  const client = new pg.Client({ connectionString: DEMO_DATABASE_URL });
  await client.connect();
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  if (tables.rows.length) await client.query(`TRUNCATE TABLE ${tables.rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await client.end();

  execFileSync(process.execPath, [path.join(apiDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'prisma/seed/index.ts'], { cwd: apiDir, env, stdio: 'pipe' });
  console.log(`Đã dựng lại ${dbName} (migration + seed tài khoản).`);
}

/** Phiên đăng nhập chủ trọ qua API (cookie + CSRF), như trình duyệt. */
async function session() {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: process.env.SEED_OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Đăng nhập thất bại: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  const csrf = cookies.find((c) => c.startsWith('qt_csrf='))?.split('=')[1];
  const call = async (method, url, body, idempotent = false) => {
    const r = await fetch(`${API}/api/v1${url}`, {
      method,
      headers: {
        cookie: cookies.join('; '),
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        ...(idempotent ? { 'idempotency-key': randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  return call;
}

async function createData() {
  const call = await session();
  const building = await call('POST', '/buildings', { code: 'DEMO', name: 'Tòa Demo', address: 'Dữ liệu demo — không phải tòa thật' });
  for (const [meter_type, unit_price] of [
    ['ELECTRICITY', '3500'],
    ['WATER', '15000'],
  ]) {
    await call('POST', `/buildings/${building.id}/meter-prices`, { meter_type, unit_price, effective_from: '2026-09-01', reason: 'Giá demo' });
  }
  const rooms = [
    { code: 'A101', rent: '3000000', tenant: 'Khách Demo A101', elec: '1000', water: '50' },
    { code: 'A102', rent: '2500000', tenant: 'Khách Demo A102', elec: '2000', water: '80' },
  ];
  for (const x of rooms) {
    const room = await call('POST', '/rooms', { building_id: building.id, code: x.code, floor: 1, default_rent_vnd: x.rent, max_occupants: 2 });
    // Nhận phòng 01/09: chỉ số lúc nhận phòng là chỉ số nền của đồng hồ riêng của phòng.
    const tenancy = await call(
      'POST',
      '/tenancies/move-in',
      {
        room_id: room.id,
        start_date: '2026-09-01',
        monthly_rent_vnd: x.rent,
        deposit_required_vnd: '0',
        primary: { new_tenant: { full_name: x.tenant } },
        meter_readings: [
          { type: 'ELECTRICITY', value: x.elec },
          { type: 'WATER', value: x.water },
        ],
      },
      true,
    );
    // Thông báo tháng 9 (tiền phòng tháng 9) coi như đã phát hành trước đó; không ghi nhận thu, không gửi tin.
    const draft = (await call('GET', `/invoices?tenancy_id=${tenancy.id}&lifecycle=DRAFT`)).items[0];
    const detail = await call('GET', `/invoices/${draft.id}`);
    await call('POST', `/invoices/${draft.id}/publish`, { expected_version: detail.version, source_hash: detail.source_hash });
    console.log(`  ${x.code}: khách từ 01/09/2026, chỉ số nền điện ${x.elec}, nước ${x.water}; thông báo tháng 9 đã phát hành.`);
  }
  console.log('Đã tạo Tòa Demo (điện 3.500 đ/kWh, nước 15.000 đ/m³).');
}

/** Chạy server demo; database demo lấy từ .env nên không phải ghi mật khẩu vào cấu hình. */
function run(command, args, env, shell = false) {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit', shell });
  child.on('exit', (code) => process.exit(code ?? 0));
}

const step = process.argv[2];
if (step === 'db' || step === 'reset') await resetDatabase();
if (step === 'data' || step === 'reset') await createData();
// D-047: demo bật tích hợp ngân hàng ở chế độ mock (nhà cung cấp giả lập, không tiền thật). Khóa webhook sinh ngẫu nhiên mỗi lần chạy,
// chỉ công cụ giả lập trong chính API dùng tới — không lưu vào git hay .env.
if (step === 'api')
  run(process.execPath, ['apps/api/dist/main.js'], {
    DATABASE_URL: DEMO_DATABASE_URL,
    API_PORT: '4200',
    STORAGE_DIR: '.data/files-demo',
    NODE_ENV: 'development',
    REMINDER_JOB_ENABLED: 'false',
    ZALO_ZNS_ACCESS_TOKEN: '',
    ZALO_ZNS_TEMPLATE_ID: '',
    SMS_API_URL: '',
    SMS_API_KEY: '',
    SMS_BRANDNAME: '',
    BANK_INTEGRATION_MODE: 'mock',
    BANK_PROVIDER: 'mock',
    BANK_WEBHOOK_API_KEY: randomBytes(24).toString('hex'),
    SEPAY_API_TOKEN: '',
    BANK_MOCK_WEBHOOK_URL: '',
  });
if (step === 'web') run('pnpm', ['--filter', '@ql-tro/web', 'exec', 'next', 'dev', '--port', '3200'], { API_INTERNAL_URL: API, NEXT_DIST_DIR: '.next-demo' }, process.platform === 'win32');
if (!['db', 'data', 'reset', 'api', 'web'].includes(step)) console.log('Dùng: node apps/api/prisma/tools/demo-utilities.mjs db | data | reset | api | web');
