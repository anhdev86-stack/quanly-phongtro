#!/usr/bin/env node
// Khôi phục database từ bản sao lưu — RUNBOOK.md mục “Khôi phục” và “Diễn tập khôi phục”.
//
//   pnpm db:restore:drill                                   # sao lưu ngay rồi khôi phục vào ql_tro_restore_drill và đối chiếu
//   pnpm db:restore backups/ql_tro-….dump                   # khôi phục vào ql_tro_restore_drill (không đụng database chính)
//   pnpm db:restore backups/ql_tro-….dump --target ql_tro_staging
//
// Ghi đè database CHÍNH chỉ khi khắc phục sự cố, do người vận hành tự chạy (script tự sao lưu bản hiện tại trước):
//   CONFIRM_RESTORE=<tên database chính> pnpm db:restore <file> --target <tên database chính> --overwrite-main
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup } from './db-backup.mjs';
import { BACKUP_RE, assertDbName, backupDir, composeExecArgs, loadEnvFile, parseArgs, pgConfig, pipe, run } from './db-common.mjs';

const DRILL_DB = 'ql_tro_restore_drill';

const args = parseArgs(process.argv.slice(2));
const envFile = typeof args['env-file'] === 'string' ? args['env-file'] : undefined;
loadEnvFile(envFile);
const { user, db: mainDb } = pgConfig();

const psql = (database, sql) => run('docker', composeExecArgs(envFile, ['psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]));

/** Số dòng mỗi bảng + số ràng buộc/index (để chắc SQL thủ công cũng được khôi phục). */
function snapshot(database) {
  // Một lần gọi psql: đếm dòng mọi bảng bằng query_to_xml.
  const out = psql(
    database,
    `SELECT tablename || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text
       FROM pg_tables WHERE schemaname = 'public'
     UNION ALL SELECT '#constraints|' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
     UNION ALL SELECT '#indexes|' || count(*) FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const counts = {};
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [name, n] = line.split('|');
    counts[name] = Number(n);
  }
  const { '#constraints': constraints, '#indexes': indexes, ...tables } = counts;
  return { counts: tables, constraints, indexes };
}

function verifyChecksum(file) {
  const sumFile = `${file}.sha256`;
  if (!fs.existsSync(sumFile)) return console.warn('Cảnh báo: không có file .sha256, bỏ qua kiểm tra toàn vẹn.');
  const expected = fs.readFileSync(sumFile, 'utf8').split(/\s+/)[0];
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (expected !== actual) throw new Error('Checksum không khớp: file sao lưu bị hỏng hoặc bị sửa.');
}

async function restoreInto(file, target) {
  assertDbName(target);
  verifyChecksum(file);
  // Tạo lại database đích (chỉ database đích đã được kiểm tra ở trên).
  psql('postgres', `DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
  psql('postgres', `CREATE DATABASE "${target}" OWNER "${user}"`);
  await pipe('docker', composeExecArgs(envFile, ['pg_restore', '-U', user, '-d', target, '--no-owner', '--no-privileges', '--exit-on-error']), { stdinFile: file });
}

function latestBackup() {
  const dir = backupDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort() : [];
  if (!files.length) throw new Error(`Chưa có bản sao lưu trong ${dir}. Chạy pnpm db:backup trước.`);
  return path.join(dir, files.at(-1));
}

async function main() {
  if (args.drill) {
    const started = Date.now();
    console.log(`Diễn tập khôi phục: sao lưu ${mainDb} rồi khôi phục vào ${DRILL_DB}.`);
    const before = snapshot(mainDb);
    const file = await backup({ envFile });
    await restoreInto(file, DRILL_DB);
    const after = snapshot(DRILL_DB);
    const diffs = Object.keys({ ...before.counts, ...after.counts }).filter((t) => before.counts[t] !== after.counts[t]);
    const rows = Object.values(after.counts).reduce((a, b) => a + b, 0);
    console.log(`Khôi phục ${path.basename(file)} → ${DRILL_DB}: ${Object.keys(after.counts).length} bảng, ${rows} dòng, ${after.constraints} ràng buộc, ${after.indexes} index (${((Date.now() - started) / 1000).toFixed(1)} giây).`);
    if (before.constraints !== after.constraints || before.indexes !== after.indexes) {
      throw new Error(`Ràng buộc/index lệch: nguồn ${before.constraints}/${before.indexes}, khôi phục ${after.constraints}/${after.indexes}.`);
    }
    if (diffs.length) {
      console.warn(`Số dòng khác nhau ở: ${diffs.join(', ')} (có ghi mới trong lúc sao lưu?). Kiểm tra lại khi hệ thống không có thao tác.`);
      process.exitCode = 2;
      return;
    }
    console.log(`ĐẠT: số dòng mọi bảng, số ràng buộc và index khớp với ${mainDb}. Database ${DRILL_DB} giữ lại để kiểm tra; có thể xóa sau.`);
    return;
  }

  const file = args._[0] ? path.resolve(args._[0]) : latestBackup();
  if (!fs.existsSync(file)) throw new Error(`Không thấy file ${file}`);
  const target = typeof args.target === 'string' ? args.target : DRILL_DB;
  if (target === mainDb) {
    if (!args['overwrite-main'] || process.env.CONFIRM_RESTORE !== mainDb) {
      throw new Error(`Từ chối ghi đè database chính “${mainDb}”. Chỉ làm khi khắc phục sự cố: dừng api, đặt CONFIRM_RESTORE=${mainDb} và thêm --overwrite-main.`);
    }
    const safety = await backup({ envFile });
    console.log(`Đã sao lưu an toàn bản hiện tại trước khi ghi đè: ${path.relative(process.cwd(), safety)}`);
  }
  await restoreInto(file, target);
  const s = snapshot(target);
  console.log(`Đã khôi phục ${path.basename(file)} → ${target}: ${Object.keys(s.counts).length} bảng, ${s.constraints} ràng buộc, ${s.indexes} index.`);
}

main().catch((e) => {
  console.error(`Khôi phục thất bại: ${e.message}`);
  process.exit(1);
});
