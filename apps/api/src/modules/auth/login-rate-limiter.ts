import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../infrastructure/clock/clock.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Giới hạn số lần đăng nhập sai trong 15 phút: 5 lần mỗi (IP, email), 30 lần mỗi IP.
 * Lưu trong bộ nhớ: đủ cho một tiến trình API (MVP). Chạy nhiều instance thì phải chuyển sang DB/Redis
 * (xem docs/DECISIONS.md D-009).
 */
@Injectable()
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  isBlocked(ip: string, email: string): boolean {
    return this.count(`acct:${ip}:${email}`) >= MAX_FAILURES_PER_ACCOUNT || this.count(`ip:${ip}`) >= MAX_FAILURES_PER_IP;
  }

  recordFailure(ip: string, email: string): void {
    this.increment(`acct:${ip}:${email}`);
    this.increment(`ip:${ip}`);
  }

  recordSuccess(ip: string, email: string): void {
    this.buckets.delete(`acct:${ip}:${email}`);
  }

  reset(): void {
    this.buckets.clear();
  }

  private count(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    if (bucket.resetAt <= this.clock.now().getTime()) {
      this.buckets.delete(key);
      return 0;
    }
    return bucket.count;
  }

  private increment(key: string): void {
    const now = this.clock.now().getTime();
    const current = this.count(key);
    const existing = this.buckets.get(key);
    this.buckets.set(key, { count: current + 1, resetAt: existing?.resetAt ?? now + WINDOW_MS });
  }
}
