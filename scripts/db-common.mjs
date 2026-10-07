// Tiện ích chung cho db-backup / db-restore (RUNBOOK.md). Chỉ dùng thư viện chuẩn của Node.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Đọc tham số dòng lệnh dạng --key value / --flag. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Nạp biến từ file env (mặc định .env ở gốc) mà không ghi đè biến đã có. */
export function loadEnvFile(file) {
  const p = path.resolve(ROOT, file ?? '.env');
  if (!fs.existsSync(p)) return p;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return p;
}

export function pgConfig() {
  return { user: process.env.POSTGRES_USER || 'ql_tro', db: process.env.POSTGRES_DB || 'ql_tro' };
}

/** Lệnh `docker compose [--env-file f] exec -T postgres …`. */
export function composeExecArgs(envFile, cmd) {
  return ['compose', ...(envFile ? ['--env-file', envFile] : []), 'exec', '-T', 'postgres', ...cmd];
}

/** Chạy lệnh, trả stdout (chuỗi); lỗi thì dừng với thông báo rõ ràng. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`Không chạy được ${cmd}: ${r.error.message}. Docker Desktop và container postgres có đang chạy không?`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} … lỗi (mã ${r.status}): ${(r.stderr || '').trim().slice(0, 800)}`);
  return r.stdout;
}

/** Chạy lệnh, chuyển stdout vào file / stdin từ file (dump có thể lớn, không giữ trong bộ nhớ). */
export function pipe(cmd, args, { stdoutFile, stdinFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: [stdinFile ? 'pipe' : 'ignore', stdoutFile ? 'pipe' : 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    if (stdoutFile) child.stdout.pipe(fs.createWriteStream(stdoutFile));
    if (stdinFile) fs.createReadStream(stdinFile).pipe(child.stdin);
    child.on('error', (e) => reject(new Error(`Không chạy được ${cmd}: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} lỗi (mã ${code}): ${stderr.trim().slice(0, 800)}`))));
  });
}

/** Tên database hợp lệ (chặn chèn SQL qua tên). */
export function assertDbName(name) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Tên database không hợp lệ: ${name}`);
  return name;
}

export const backupDir = () => path.resolve(ROOT, process.env.BACKUP_DIR || 'backups');
export const BACKUP_RE = /^ql_tro-\d{8}-\d{6}\.dump$/;

// ------------------------------------------------------------------ Tệp riêng tư (V1.1 Phase 13)
// FILES_BACKUP: local (mặc định: thư mục STORAGE_DIR trên máy chạy lệnh, như `pnpm dev`) | container (volume /data/files của
// service api trong profile full) | off. Dùng `tar` có sẵn trên Windows 10+, macOS, Linux và trong image api.

export const filesMode = () => (process.env.FILES_BACKUP || 'local').toLowerCase();

/** Thư mục tệp ở chế độ local: STORAGE_DIR tương đối được hiểu từ apps/api (nơi `pnpm dev` chạy api). */
export const localFilesDir = () => path.resolve(ROOT, 'apps/api', process.env.STORAGE_DIR || '.data/files');

export function composeApiExecArgs(envFile, cmd) {
  return ['compose', ...(envFile ? ['--env-file', envFile] : []), '--profile', 'full', 'exec', '-T', 'api', ...cmd];
}

export const filesArchiveOf = (dumpFile) => dumpFile.replace(/\.dump$/, '.files.tar');

/** `tar` của hệ điều hành. Trên Windows dùng bsdtar của Windows (GNU tar của Git Bash hiểu “C:” là máy chủ từ xa). */
export const TAR = process.platform === 'win32' && fs.existsSync(path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'))
  ? path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe')
  : 'tar';
