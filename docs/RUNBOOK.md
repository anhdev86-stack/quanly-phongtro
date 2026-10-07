# Runbook

Vận hành môi trường dev, test, và production (Phase 9: Docker, Caddy, sao lưu/khôi phục, nâng cấp và rollback).
Mọi lệnh chạy ở thư mục gốc repository. AI agent không tự deploy production và không tự ghi đè database chính.

## Database dev

| Việc | Lệnh (chạy ở thư mục gốc) |
|---|---|
| Khởi động PostgreSQL | `pnpm db:up` |
| Dừng (giữ dữ liệu) | `pnpm db:down` |
| Tạo migration mới từ schema | `pnpm --filter @ql-tro/api exec prisma migrate dev --create-only --name <tên>` rồi làm theo `apps/api/prisma/MANUAL_SQL.md` |
| Áp migration (dev) | `pnpm db:migrate` |
| Áp migration không tạo mới (CI/production) | `pnpm db:deploy` |
| Seed dữ liệu dev | `pnpm db:seed` |
| Reset database dev (**xóa toàn bộ dữ liệu dev**) | `pnpm db:reset` — Prisma sẽ hỏi xác nhận |

Container: `ql-tro-postgres-1`, cổng host `55432` (đổi bằng `POSTGRES_PORT`). Dữ liệu nằm trong volume `ql-tro_pgdata`.
`docker compose down -v` sẽ **xóa volume**, chỉ dùng khi chắc chắn muốn mất dữ liệu dev.

## Database test

- Tên: `ql_tro_test` (tạo tự động lần đầu container khởi động với volume trống).
- `pnpm test:integration` tự áp migration còn thiếu (`migrate deploy`) và tự xóa dữ liệu giữa các file test.
- Nếu test báo `prisma migrate deploy (database test) thất bại` vì một migration đã áp bị sửa lại, hãy **tự** reset database test:

  PowerShell:
  ```powershell
  $env:DATABASE_URL = "postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro_test?schema=public"
  pnpm --filter @ql-tro/api exec prisma migrate reset
  Remove-Item Env:DATABASE_URL
  ```

  macOS/Linux:
  ```bash
  DATABASE_URL="postgresql://ql_tro:ql_tro_dev_only@localhost:55432/ql_tro_test?schema=public" pnpm --filter @ql-tro/api exec prisma migrate reset
  ```

  Kiểm tra kỹ tên database **kết thúc bằng `_test`** trước khi xác nhận. AI agent không chạy lệnh này thay bạn (D-008).

## Database E2E

- Tên: `ql_tro_e2e` (cùng server PostgreSQL dev). `pnpm test:e2e` tự tạo nếu chưa có, áp migration, **xóa sạch dữ liệu E2E** rồi seed lại.
- Stack E2E: API bản build ở cổng 4100, web Next dev ở cổng 3100 (thư mục build `.next-e2e`), không ảnh hưởng `pnpm dev` (3000/4000).
- Dữ liệu dev (`ql_tro`) không bị E2E đụng tới.

## Sao lưu và khôi phục database

Script Node (`scripts/db-backup.mjs`, `scripts/db-restore.mjs`) chạy `pg_dump`/`pg_restore` **bên trong** container postgres,
nên máy chạy lệnh chỉ cần Node và Docker (Windows PowerShell, macOS, Linux như nhau).

| Việc | Lệnh |
|---|---|
| Sao lưu ngay | `pnpm db:backup` (production: `pnpm db:backup --env-file .env.production`) |
| Diễn tập khôi phục | `pnpm db:restore:drill` |
| Khôi phục một bản vào database thử | `pnpm db:restore backups/ql_tro-YYYYMMDD-HHMMSS.dump` (mặc định vào `ql_tro_restore_drill`) |
| Khôi phục vào database khác | `pnpm db:restore <file> --target ql_tro_staging` |

- File: `backups/ql_tro-<giờ UTC>.dump` (định dạng custom của PostgreSQL) kèm `.sha256`. Đổi thư mục bằng `BACKUP_DIR`.
- Sau khi dump, script kiểm tra file đọc được (`pg_restore --list`) rồi mới đổi tên từ `.partial`.
- Giữ `BACKUP_RETENTION_DAYS` ngày (mặc định 14), luôn giữ ít nhất 3 bản mới nhất; chỉ xóa file đúng mẫu tên do script tạo.
- **Lịch sao lưu (production):** chạy `pnpm db:backup --env-file .env.production` mỗi ngày (cron trên Linux, Task Scheduler trên
  Windows) và **chép thư mục `backups/` ra ngoài máy chủ** (ổ ngoài, dịch vụ lưu trữ). Bản sao lưu nằm cùng máy với database
  không bảo vệ được khi hỏng máy.
- **Diễn tập:** ít nhất mỗi tháng và trước mỗi lần nâng cấp có migration. `db:restore:drill` sao lưu ngay, khôi phục vào
  `ql_tro_restore_drill`, đối chiếu số dòng từng bảng, số ràng buộc (gồm CHECK/EXCLUDE thủ công) và số index. In `ĐẠT` là đủ.
  Mã thoát 2: số dòng lệch do có ghi mới trong lúc sao lưu, chạy lại khi không có thao tác.
- Bản sao lưu chứa dữ liệu cá nhân của người thuê: lưu nơi có kiểm soát truy cập.
- Script gọi `docker compose --env-file <file> exec postgres`: nếu stack chạy với tên project khác mặc định, đặt
  `COMPOSE_PROJECT_NAME=<tên>` trong file env đó.

### Khôi phục database chính khi sự cố (người vận hành tự làm)

1. Dừng ghi: `docker compose --env-file .env.production --profile full stop api web`.
2. Kiểm tra bản sao lưu trước bằng `pnpm db:restore <file> --env-file .env.production` (vào database thử) và xem dữ liệu.
3. Ghi đè database chính (script tự sao lưu bản hiện tại trước khi ghi đè):

   PowerShell:
   ```powershell
   $env:CONFIRM_RESTORE = "ql_tro"
   pnpm db:restore <file> --env-file .env.production --target ql_tro --overwrite-main
   Remove-Item Env:CONFIRM_RESTORE
   ```
   macOS/Linux:
   ```bash
   CONFIRM_RESTORE=ql_tro pnpm db:restore <file> --env-file .env.production --target ql_tro --overwrite-main
   ```
4. Bản sao lưu của phiên bản cũ hơn: chạy đúng phiên bản code tương ứng, hoặc để service `migrate` nâng schema khi khởi động.
5. Khởi động lại: `docker compose --env-file .env.production --profile full up -d`.

## Triển khai production (Docker + Caddy)

Một máy chủ có Docker Engine + Compose v2 (hoặc Docker Desktop). Caddy phục vụ một tên miền: `/api/*` → api, còn lại → web,
tự lấy chứng chỉ HTTPS. PostgreSQL chỉ mở cổng trên `127.0.0.1`.

| Service | Image (target trong `infra/docker/Dockerfile`) | Ghi chú |
|---|---|---|
| `postgres` | `postgres:18.6-alpine` | Volume `<project>_pgdata` |
| `migrate` | `migrate` | Chạy một lần: `prisma migrate deploy` rồi `db:bootstrap`; api chỉ khởi động khi bước này thành công |
| `api` | `api` | `NODE_ENV=production`, healthcheck `/api/v1/health/ready`, chạy bằng user `node` |
| `web` | `web` | Next.js standalone, chạy bằng user `node` |
| `caddy` | `caddy:2.10-alpine` | `infra/caddy/Caddyfile`; trả 404 cho `/api/v1/docs*` và `/api/v1/health*` từ bên ngoài; log che token link |

Migration **không** chạy lúc app khởi động; chỉ service `migrate` chạy `migrate deploy` (không bao giờ `reset`).

### Lần đầu

1. Lấy code đúng phiên bản đã nghiệm thu (tag/commit).
2. Tạo `.env.production` (không commit; `.env.*` đã bị git và Docker bỏ qua):

   ```dotenv
   POSTGRES_USER=ql_tro
   POSTGRES_PASSWORD=<mật khẩu ngẫu nhiên dài>
   POSTGRES_DB=ql_tro
   JWT_ACCESS_SECRET=<chuỗi ngẫu nhiên ≥ 32 ký tự>
   SITE_ADDRESS=tro.ten-mien-cua-ban.vn
   PUBLIC_BASE_URL=https://tro.ten-mien-cua-ban.vn
   # Chỉ lần đầu (database chưa có người dùng):
   BOOTSTRAP_WORKSPACE_NAME=Nhà trọ …
   BOOTSTRAP_OWNER_EMAIL=chu-tro@…
   BOOTSTRAP_OWNER_NAME=…
   BOOTSTRAP_OWNER_PASSWORD=<tối thiểu 12 ký tự>
   ```

   Tạo chuỗi ngẫu nhiên: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
   API từ chối khởi động nếu secret là bản dev hoặc `PUBLIC_BASE_URL` không phải `https://` (không in giá trị bí mật).
3. Trỏ DNS của tên miền về máy chủ, mở cổng 80 và 443.
4. `docker compose --env-file .env.production --profile full up -d --build`
5. Theo dõi: `docker compose --env-file .env.production --profile full ps -a` (api/web `healthy`, migrate `Exited (0)`) và
   `docker compose --env-file .env.production --profile full logs migrate`.
6. Đăng nhập bằng tài khoản chủ trọ vừa tạo, rồi **xóa các dòng `BOOTSTRAP_*`** khỏi `.env.production`.
7. Trong ứng dụng: nhập **tài khoản nhận tiền thật** (Cấu hình → Tài khoản nhận tiền), quét thử một mã QR bằng app ngân hàng.
8. Đặt lịch sao lưu hằng ngày và chạy `pnpm db:restore:drill --env-file .env.production` lần đầu.

Production không có dữ liệu demo: seed dev từ chối chạy khi `NODE_ENV=production`; `db:bootstrap` chỉ tạo nhà trọ,
danh mục dịch vụ mặc định và một chủ trọ.

### Nâng cấp phiên bản

1. Đọc `docs/IMPLEMENTATION_STATUS.md`/ghi chú phát hành: có migration mới, có biến môi trường mới không.
2. Sao lưu: `pnpm db:backup --env-file .env.production` (bắt buộc khi có migration).
3. Lấy code mới, rồi `docker compose --env-file .env.production --profile full up -d --build`.
   `migrate` áp migration chưa có và đồng bộ quyền của vai trò; api mới chỉ khởi động khi migrate thành công.
4. Kiểm tra: đăng nhập, mở Tổng quan, một thông báo, trang công nợ.

### Rollback

- **Không có migration mới:** checkout commit/tag trước đó, `docker compose --env-file .env.production --profile full up -d --build`.
- **Có migration mới:** Prisma không có migration “down”; không sửa tay bảng. Dừng api/web, khôi phục bản sao lưu chụp ngay trước khi
  nâng cấp (mục “Khôi phục database chính”), checkout phiên bản cũ rồi `up -d --build`. Dữ liệu ghi sau lúc sao lưu sẽ mất:
  ghi lại các thao tác tiền trong khoảng đó để nhập lại.
- Migration lỗi giữa chừng (`migrate` thoát mã khác 0, api không khởi động): không chạy `migrate reset`. Khôi phục bản sao lưu như trên,
  sửa migration ở môi trường thử rồi nâng cấp lại.

### Chạy thử profile full trên máy dev

Dùng project compose riêng để không đụng database dev:

```powershell
# .env.trial: như .env.production nhưng SITE_ADDRESS=localhost, PUBLIC_BASE_URL=https://localhost:8443,
# HTTPS_PORT=8443, HTTP_PORT=8080, POSTGRES_PORT=55433, COMPOSE_PROJECT_NAME=ql-tro-trial, BACKUP_DIR=backups/trial
docker compose -p ql-tro-trial --env-file .env.trial --profile full up -d --build
node scripts/db-restore.mjs --drill --env-file .env.trial   # diễn tập trên stack thử
# Mở https://localhost:8443 (Caddy dùng chứng chỉ nội bộ: trình duyệt cảnh báo, chấp nhận để thử)
docker compose -p ql-tro-trial --env-file .env.trial --profile full stop
```

Mỗi lượt build image dùng vài GB build cache; kiểm tra dung lượng ổ dữ liệu Docker trước khi build (`docker system df`).

## Đóng kỳ phát hành (V1.1)

- Sau khi phát hành xong thông báo của một tháng và đối chiếu, vào **Thông báo tiền phòng → Kỳ phát hành → Đóng kỳ** (cần quyền phát hành
  và phạm vi mọi tòa). Kỳ đã đóng không cho tạo/sửa chứng từ và chỉ số của tháng đó; thu tiền nợ cũ vẫn bình thường.
- Cần sửa: **Mở lại** (quyền `period.reopen`, nhập lý do — ghi nhật ký), sửa, rồi đóng lại.

## Nhắc đóng tiền (Zalo/SMS)

- Job chạy mỗi 15 phút trong tiến trình api (`REMINDER_JOB_ENABLED`). Nhật ký ở màn hình “Nhắc đóng tiền”.
- **Hiện chưa gửi tin thật** (D-034): adapter Zalo ZNS/SMS chưa được kiểm chứng; mọi tin chỉ ghi log. Khi có tài khoản nhà cung cấp:
  đặt `ZALO_ZNS_*` / `SMS_*` trong `.env.production` (không lưu DB, không commit), hoàn thiện adapter, chủ trọ tự gửi thử tới số
  của mình trên môi trường thử rồi mới bật.

## Health check

- Liveness: `GET /api/v1/health/live` → `200 {"status":"ok"}`.
- Readiness: `GET /api/v1/health/ready` → `200` khi database sẵn sàng, `503` khi không. Không trả biến môi trường hay chi tiết lỗi.
- Production: container api/web có `HEALTHCHECK`; Caddy trả 404 cho `/api/v1/health*` và `/api/v1/docs*` từ bên ngoài.

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `port is already allocated` khi `pnpm db:up` | Cổng 55432 bị chiếm: đổi `POSTGRES_PORT`, `DATABASE_URL`, `DATABASE_URL_TEST` trong `.env`. |
| Web báo “Đã có lỗi xảy ra” ngay sau khi chạy `pnpm dev` | API chưa khởi động xong (tsc watch mất khoảng 15 giây). Chờ log `Found 0 errors` rồi bấm “Thử lại”. |
| Đăng nhập báo “Bạn đã thử quá nhiều lần” | Sai 5 lần trong 15 phút. Chờ hết thời gian, hoặc khởi động lại API (bộ đếm lưu trong bộ nhớ, D-009). |
| `Failed to load native binding` từ `@swc/core` | Dự án không dùng SWC (D-004). Kiểm tra không có công cụ nào bật builder `swc`. |
| `pnpm` không chạy trong Git Bash | Dùng PowerShell hoặc `pnpm.cmd` (D-005). |
| Docker báo lỗi 500 / build treo, ổ đĩa đầy | Image và build cache nằm trong ổ dữ liệu của Docker Desktop. Kiểm tra `docker system df`, dọn `docker builder prune`, hoặc dời Disk image location sang ổ còn trống. |
| api trong profile full không lên, log `Cấu hình môi trường không hợp lệ` | Sửa `.env.production` theo dòng báo lỗi (secret, `PUBLIC_BASE_URL` https). Giá trị bí mật không bị in ra. |
| Đăng nhập được nhưng bị đăng xuất ngay (profile full) | Truy cập qua `http://` thay vì `https://`: cookie `Secure` không được gửi. Dùng đúng địa chỉ https. |
