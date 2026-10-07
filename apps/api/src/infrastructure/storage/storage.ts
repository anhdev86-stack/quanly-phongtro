import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Kho tệp riêng tư (MASTER_PLAN 3.1: thư mục riêng ở dev, S3/R2 ở production). Không bao giờ phục vụ trực tiếp ra web:
 * mọi lần tải đi qua API kiểm tra quyền. Khóa (key) do server sinh, không chứa tên gốc hay dữ liệu cá nhân.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Readiness: kho ghi/đọc được. */
  check(): Promise<boolean>;
}

export const STORAGE = Symbol('STORAGE');

const KEY_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/** Lưu trên đĩa của server (dev và triển khai một máy; volume Docker riêng). S3/R2 chưa cấu hình (D-039). */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('Khóa lưu trữ không hợp lệ.');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Khóa lưu trữ không hợp lệ.');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Ghi tệp tạm rồi đổi tên: không để lại tệp dở dang khi lỗi giữa chừng.
    const tmp = `${full}.tmp-${process.pid}`;
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async check(): Promise<boolean> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, `.ready-${process.pid}`);
      await fs.writeFile(probe, 'ok');
      await fs.rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
