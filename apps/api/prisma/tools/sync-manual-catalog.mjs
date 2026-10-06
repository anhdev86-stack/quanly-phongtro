// Đồng bộ khối ```json manual-constraints trong prisma/MANUAL_SQL.md với định nghĩa thực tế trong database dev.
// Dùng sau khi thêm SQL thủ công vào migration:  node prisma/tools/sync-manual-catalog.mjs <tên> [<tên>…]
// Tên mới được thêm vào cuối danh mục; tên đã có được cập nhật định nghĩa. Không xóa mục nào.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const names = process.argv.slice(2);
const catalogPath = new URL('../MANUAL_SQL.md', import.meta.url);
const md = fs.readFileSync(catalogPath, 'utf8');
const re = /```json manual-constraints\r?\n([\s\S]*?)```/;
const entries = JSON.parse(re.exec(md)[1]);

function psql(sql) {
  return execFileSync('docker', ['exec', 'ql-tro-postgres-1', 'psql', '-U', 'ql_tro', '-d', 'ql_tro', '-tAc', sql], { encoding: 'utf8' }).trim();
}

for (const name of names) {
  const safe = name.replace(/[^a-z0-9_]/gi, '');
  let found = psql(
    `SELECT CASE contype WHEN 'c' THEN 'check' WHEN 'x' THEN 'exclude' ELSE contype::text END || '|' || conrelid::regclass || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${safe}'`,
  );
  if (!found) {
    found = psql(`SELECT 'index|' || indrelid::regclass || '|' || pg_get_indexdef(indexrelid) FROM pg_index JOIN pg_class c ON c.oid = indexrelid WHERE c.relname = '${safe}'`);
  }
  if (!found) throw new Error(`Không tìm thấy ràng buộc/index: ${name}`);
  const [kind, table, ...rest] = found.split('|');
  const entry = { name: safe, kind, table: table.replace(/"/g, ''), definition: rest.join('|') };
  const i = entries.findIndex((e) => e.name === safe);
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  console.log(`${i >= 0 ? 'cập nhật' : 'thêm'}: ${safe} (${kind} on ${entry.table})`);
}

fs.writeFileSync(catalogPath, md.replace(re, () => '```json manual-constraints\n' + JSON.stringify(entries, null, 2) + '\n```'));
console.log(`Danh mục: ${entries.length} mục.`);
