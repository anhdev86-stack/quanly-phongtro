import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { AppConfig } from '../../config/env.js';
import type { NormalizedBankTransaction } from '../../domain/bank/normalize.js';
import { BankPayloadError, parseSepayListItem, parseSepayWebhook, SEPAY_ACK } from '../../domain/bank/sepay-format.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export type BankEnv = 'MOCK' | 'TEST' | 'LIVE';

export interface FetchPage {
  items: NormalizedBankTransaction[];
  /** Id lớn nhất đã duyệt trong trang (kể cả dòng bị lọc) — mốc đồng bộ tiếp theo; null nếu trang rỗng. */
  lastId: string | null;
  /** Trang đầy (còn có thể có trang sau). */
  full: boolean;
}

/**
 * Lớp tách nhà cung cấp khỏi nghiệp vụ thu tiền (D-047). Mỗi adapter tự xác thực webhook, tự đọc payload về dạng chuẩn hóa
 * và (nếu nhà cung cấp hỗ trợ) lấy bù giao dịch qua API. Nghiệp vụ đối chiếu/ghi phiếu thu không biết tới payload gốc.
 */
export interface BankAdapter {
  readonly provider: 'mock' | 'sepay';
  readonly environment: BankEnv;
  /** Ném UNAUTHENTICATED nếu xác thực sai. Không tin dữ liệu client, trang redirect hay ảnh chụp chuyển khoản. */
  verifyWebhook(headers: Record<string, string | string[] | undefined>): void;
  /** Ném BankPayloadError nếu payload sai định dạng. */
  parseWebhook(body: unknown): NormalizedBankTransaction;
  /** Phản hồi nhà cung cấp coi là đã nhận (SePay: `{"success": true}`). */
  readonly webhookAck: Record<string, unknown>;
  /** Giao dịch có id lớn hơn `afterId` theo thứ tự tăng dần; tôn trọng giới hạn `limit` của nhà cung cấp. */
  fetchAfter(accountNumber: string, afterId: string | null, limit: number): Promise<FetchPage>;
}

export const BANK_ADAPTER = Symbol('BANK_ADAPTER');

const digest = (s: string) => createHash('sha256').update(s).digest();

/** So khóa `Authorization: Apikey <khóa>` (định dạng SePay) theo thời gian hằng. */
export function verifyApikeyHeader(headers: Record<string, string | string[] | undefined>, expected: string): void {
  const raw = headers['authorization'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const m = typeof value === 'string' ? /^Apikey\s+(.+)$/i.exec(value.trim()) : null;
  if (!m || !timingSafeEqual(digest(m[1]!), digest(expected))) throw new AppError('UNAUTHENTICATED', 'Xác thực webhook không hợp lệ.');
}

const byNumericId = (a: { providerTransactionId: string }, b: { providerTransactionId: string }) => {
  const x = BigInt(/^\d+$/.test(a.providerTransactionId) ? a.providerTransactionId : '0');
  const y = BigInt(/^\d+$/.test(b.providerTransactionId) ? b.providerTransactionId : '0');
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Nhà cung cấp giả lập: cùng định dạng payload và cách xác thực với SePay; “ngân hàng giả” là bảng mock_bank_transactions
 * (nguồn cho API đối soát giả lập — mô phỏng webhook bị mất rồi lấy bù).
 */
export class MockBankAdapter implements BankAdapter {
  readonly provider = 'mock' as const;
  readonly environment = 'MOCK' as const;
  readonly webhookAck = SEPAY_ACK;

  constructor(
    private readonly apiKey: string,
    private readonly prisma: PrismaService,
  ) {}

  verifyWebhook(headers: Record<string, string | string[] | undefined>) {
    verifyApikeyHeader(headers, this.apiKey);
  }

  parseWebhook(body: unknown) {
    return parseSepayWebhook(body);
  }

  async fetchAfter(accountNumber: string, afterId: string | null, limit: number): Promise<FetchPage> {
    const rows = await this.prisma.mockBankTransaction.findMany({
      where: afterId ? { id: { gt: BigInt(afterId) } } : {},
      orderBy: { id: 'asc' },
      take: limit,
    });
    const items: NormalizedBankTransaction[] = [];
    for (const r of rows) {
      const t = parseSepayWebhook(r.payload);
      if (t.accountNumber === accountNumber) items.push(t);
    }
    return { items, lastId: rows.length ? rows[rows.length - 1]!.id.toString() : null, full: rows.length === limit };
  }
}

/**
 * SePay (docs.sepay.vn). Webhook: header `Authorization: Apikey <khóa>`, chống trùng theo `id`, phản hồi `{"success": true}`.
 * Lấy bù: `GET {base}/transactions/list?account_number=&since_id=&limit=` (since_id: id ≥ giá trị; limit tối đa 5000), token Bearer.
 * CHƯA XÁC MINH với tài khoản SePay thật (chưa có chủ trọ/tài khoản) — bật test trước khi live (RUNBOOK).
 */
export class SepayAdapter implements BankAdapter {
  readonly provider = 'sepay' as const;
  readonly webhookAck = SEPAY_ACK;

  constructor(
    readonly environment: BankEnv,
    private readonly apiKey: string,
    private readonly apiToken: string,
    private readonly baseUrl: string,
  ) {}

  verifyWebhook(headers: Record<string, string | string[] | undefined>) {
    verifyApikeyHeader(headers, this.apiKey);
  }

  parseWebhook(body: unknown) {
    return parseSepayWebhook(body);
  }

  async fetchAfter(accountNumber: string, afterId: string | null, limit: number): Promise<FetchPage> {
    const sinceId = afterId ? (BigInt(afterId) + 1n).toString() : '0';
    const url = `${this.baseUrl.replace(/\/$/, '')}/transactions/list?account_number=${encodeURIComponent(accountNumber)}&since_id=${sinceId}&limit=${Math.min(limit, 5000)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`SePay trả HTTP ${res.status}.`);
    const json = (await res.json()) as { transactions?: unknown[] };
    if (!Array.isArray(json.transactions)) throw new BankPayloadError('Phản hồi SePay không có danh sách transactions.');
    const items = json.transactions.map(parseSepayListItem).sort(byNumericId);
    return { items, lastId: items.length ? items[items.length - 1]!.providerTransactionId : null, full: json.transactions.length >= Math.min(limit, 5000) };
  }
}

/** Tạo adapter theo cấu hình. off → null. Cấu hình test/live thiếu khóa đã bị chặn ở parseEnv (không âm thầm dùng mock). */
export function createBankAdapter(config: AppConfig, prisma: PrismaService): BankAdapter | null {
  const mode = config.BANK_INTEGRATION_MODE;
  if (mode === 'off') return null;
  const key = config.BANK_WEBHOOK_API_KEY;
  if (!key || !config.BANK_PROVIDER) throw new Error(`Thiếu cấu hình nhà cung cấp cho BANK_INTEGRATION_MODE=${mode}.`);
  if (mode === 'mock') {
    if (config.BANK_PROVIDER !== 'mock') throw new Error('Chế độ mock chỉ dùng BANK_PROVIDER=mock.');
    return new MockBankAdapter(key, prisma);
  }
  if (config.BANK_PROVIDER !== 'sepay' || !config.SEPAY_API_TOKEN) throw new Error(`Chế độ ${mode} cần BANK_PROVIDER=sepay và SEPAY_API_TOKEN.`);
  return new SepayAdapter(mode === 'live' ? 'LIVE' : 'TEST', key, config.SEPAY_API_TOKEN, config.SEPAY_API_BASE_URL);
}
