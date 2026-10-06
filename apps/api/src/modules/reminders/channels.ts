import { Inject, Injectable, Logger } from '@nestjs/common';
import { REMINDER_CHANNEL_LABELS } from '@ql-tro/shared';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { maskPhone } from '../../domain/reminders/schedule.js';

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  /** `transient`: lỗi tạm thời (mạng, quá tải) → thử lại sau; ngược lại lỗi cố định (sai số, sai mẫu…). */
  | { ok: false; code: string; message: string; transient: boolean };

/** Kênh gửi tin (MASTER_PLAN 9.7). `message` không bao giờ chứa khóa API; số điện thoại được che trước khi lưu. */
export interface MessageChannel {
  readonly code: string;
  /** Đã có đủ cấu hình và adapter đã được kiểm chứng với nhà cung cấp. */
  ready(): boolean;
  send(to: string, text: string, ref: { messageId: string }): Promise<SendResult>;
}

/** Mặc định ở dev/test: chỉ ghi log (số đã che, không in nội dung chứa link), không gửi gì. */
export class LogOnlyChannel implements MessageChannel {
  readonly code = 'LOG_ONLY';
  private readonly logger = new Logger('LogOnlyChannel');
  ready() {
    return true;
  }
  async send(to: string, text: string, ref: { messageId: string }): Promise<SendResult> {
    this.logger.log(`[không gửi thật] tin nhắc ${ref.messageId} tới ${maskPhone(to)} (${text.length} ký tự)`);
    return { ok: true, providerMessageId: `log-${ref.messageId}` };
  }
}

/**
 * Adapter Zalo ZNS / SMS brandname: chưa chốt nhà cung cấp và chưa có tài khoản (N-1…N-5) nên chưa gọi API thật.
 * `ready()` luôn false để không bao giờ gửi thật khi chưa được kiểm chứng; khi có tài khoản, thay `send` bằng lời gọi
 * API của nhà cung cấp và đặt `verified = true` sau khi chủ dự án gửi thử thành công.
 */
abstract class UnverifiedProviderChannel implements MessageChannel {
  abstract readonly code: string;
  protected readonly verified: boolean = false;
  constructor(protected readonly hasKeys: boolean) {}
  configured() {
    return this.hasKeys;
  }
  ready() {
    return this.hasKeys && this.verified;
  }
  async send(): Promise<SendResult> {
    return { ok: false, code: 'ADAPTER_NOT_VERIFIED', message: `Kênh ${this.code} chưa được kiểm chứng với nhà cung cấp, chưa gửi thật.`, transient: false };
  }
}

export class ZaloZnsChannel extends UnverifiedProviderChannel {
  readonly code = 'ZALO_ZNS';
}

export class SmsChannel extends UnverifiedProviderChannel {
  readonly code = 'SMS';
}

export interface ResolvedChannels {
  channels: MessageChannel[];
  /** true khi gửi qua kênh thật (đủ ba điều kiện của MASTER_PLAN 9.7). */
  real: boolean;
}

@Injectable()
export class ChannelRegistry {
  readonly logOnly = new LogOnlyChannel();
  private readonly providers: Record<'ZALO_ZNS' | 'SMS', UnverifiedProviderChannel>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.providers = {
      ZALO_ZNS: new ZaloZnsChannel(!!(config.ZALO_ZNS_ACCESS_TOKEN && config.ZALO_ZNS_TEMPLATE_ID)),
      SMS: new SmsChannel(!!(config.SMS_API_URL && config.SMS_API_KEY && config.SMS_BRANDNAME)),
    };
  }

  /** Trạng thái từng kênh cho màn hình cấu hình (không trả khóa). */
  status() {
    return (['ZALO_ZNS', 'SMS'] as const).map((code) => ({ code, label: REMINDER_CHANNEL_LABELS[code], configured: this.providers[code].ready() }));
  }

  /** Gửi thật chỉ khi: production + đã bật + có adapter thật sẵn sàng. Ngược lại dùng LogOnlyChannel. */
  resolve(enabled: boolean, order: string[]): ResolvedChannels {
    const real = order.map((c) => this.providers[c as 'ZALO_ZNS' | 'SMS']).filter((ch): ch is UnverifiedProviderChannel => !!ch && ch.ready());
    if (this.config.NODE_ENV === 'production' && enabled && real.length) return { channels: real, real: true };
    return { channels: [this.logOnly], real: false };
  }
}
