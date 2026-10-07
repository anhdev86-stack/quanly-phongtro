#!/usr/bin/env node
// Sao lưu database (pg_dump định dạng custom) — RUNBOOK.md mục “Sao lưu”.
//   pnpm db:backup                       # dùng .env
//   pnpm db:backup --env-file .env.production
// Biến: BACKUP_DIR (mặc định ./backups), BACKUP_RETENTION_DAYS (mặc định 14; luôn giữ ít nhất 3 bản mới nhất),
//       FILES_BACKUP (local | container | off — tệp riêng tư, lưu cạnh bản dump: ql_tro-<giờ>.files.tar).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_RE, backupDir, TAR, composeApiExecArgs, composeExecArgs, filesArchiveOf, filesMode, loadEnvFile, localFilesDir, parseArgs, pgConfig, pipe, run } from './db-common.mjs';

export async function backup({ envFile, quiet = false } = {}) {
  const { user, db } = pgConfig();
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `ql_tro-${stamp}.dump`);
  const tmp = `${file}.partial`;

  await pipe('docker', composeExecArgs(envFile, ['pg_dump', '-U', user, '-d', db, '--format=custom', '--no-owner', '--no-privileges']), { stdoutFile: tmp });
  const size = fs.statSync(tmp).size;
  if (size < 1024) throw new Error(`File sao lưu quá nhỏ (${size} byte), nghi lỗi.`);
  // Kiểm tra file đọc được (mục lục dump hợp lệ) trước khi coi là bản sao lưu.
  const toc = run('docker', composeExecArgs(envFile, ['pg_restore', '--list']), { input: fs.readFileSync(tmp) });
  const tables = (toc.match(/ TABLE DATA public /g) ?? []).length;
  fs.renameSync(tmp, file);
  const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`);
  if (!quiet) console.log(`Đã sao lưu ${db} → ${path.relative(process.cwd(), file)} (${(size / 1024).toFixed(0)} KB, ${tables} bảng, sha256 ${sha.slice(0, 12)}…)`);

  const files = await backupFiles(envFile, file);
  if (!quiet && files) console.log(`Đã sao lưu tệp riêng tư → ${path.relative(process.cwd(), files.archive)} (${files.count} tệp, ${(files.size / 1024).toFixed(0)} KB)`);

  pruneOldBackups(dir, quiet);
  return file;
}

/** Gói toàn bộ kho tệp thành .files.tar cạnh bản dump (tệp bất biến, khóa duy nhất nên gói đầy đủ mỗi lần). */
async function backupFiles(envFile, dumpFile) {
  const mode = filesMode();
  if (mode === 'off') return null;
  const archive = filesArchiveOf(dumpFile);
  const tmp = `${archive}.partial`;
  if (mode === 'container') {
    await pipe('docker', composeApiExecArgs(envFile, ['tar', '-cf', '-', '-C', '/data/files', '.']), { stdoutFile: tmp });
  } else {
    const dir = localFilesDir();
    fs.mkdirSync(dir, { recursive: true });
    run(TAR, ['-cf', tmp, '-C', dir, '.']);
  }
  const list = run(TAR, ['-tf', tmp]).split(/\r?\n/).filter((l) => l && !l.endsWith('/'));
  fs.renameSync(tmp, archive);
  const sha = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(`${archive}.sha256`, `${sha}  ${path.basename(archive)}\n`);
  return { archive, count: list.length, size: fs.statSync(archive).size };
}

function pruneOldBackups(dir, quiet) {
  const days = Number(process.env.BACKUP_RETENTION_DAYS || 14);
  const files = fs
    .readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .sort()
    .reverse();
  const cutoff = Date.now() - days * 86_400_000;
  // Chỉ xóa file sao lưu do script này tạo (đúng mẫu tên), cũ hơn hạn giữ, và luôn giữ 3 bản mới nhất.
  for (const f of files.slice(3)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) {
      fs.rmSync(p);
      fs.rmSync(`${p}.sha256`, { force: true });
      fs.rmSync(filesArchiveOf(p), { force: true });
      fs.rmSync(`${filesArchiveOf(p)}.sha256`, { force: true });
      if (!quiet) console.log(`Xóa bản sao lưu quá ${days} ngày: ${f}`);
    }
  }
}

if (process.argv[1]?.endsWith('db-backup.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const envFile = typeof args['env-file'] === 'string' ? args['env-file'] : undefined;
  loadEnvFile(envFile);
  backup({ envFile }).catch((e) => {
    console.error(`Sao lưu thất bại: ${e.message}`);
    process.exit(1);
  });
}
