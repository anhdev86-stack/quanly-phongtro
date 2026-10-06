import { toBusinessDate } from '../../domain/dates/business-date.js';

/** Nguồn thời gian duy nhất của ứng dụng. Không gọi `new Date()` rải rác trong nghiệp vụ. */
export interface Clock {
  now(): Date;
  /** Ngày nghiệp vụ hôm nay theo múi giờ nghiệp vụ, dạng YYYY-MM-DD. */
  today(): string;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  constructor(private readonly timeZone: string) {}

  now(): Date {
    return new Date();
  }

  today(): string {
    return toBusinessDate(this.now(), this.timeZone);
  }
}

/** Đồng hồ cố định cho test; có thể dịch chuyển thời gian. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(
    instant: Date | string,
    private readonly timeZone: string = 'Asia/Ho_Chi_Minh',
  ) {
    this.current = new Date(instant);
  }

  now(): Date {
    return new Date(this.current);
  }

  today(): string {
    return toBusinessDate(this.current, this.timeZone);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
