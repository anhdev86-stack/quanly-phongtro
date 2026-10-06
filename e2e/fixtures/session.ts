import { expect, type Page } from '@playwright/test';
import { accounts } from './accounts';

export async function loginAs(page: Page, who: keyof typeof accounts) {
  const acc = accounts[who];
  await page.goto('/login');
  await page.getByLabel('Email').fill(acc.email);
  await page.getByLabel('Mật khẩu').fill(acc.password());
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: `Xin chào, ${acc.name}` })).toBeVisible();
}

/** Mã duy nhất cho dữ liệu E2E (chạy lặp lại trên database dev không trùng). */
export const uniqueCode = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-5)}`;

export const dialog = (page: Page) => page.locator('dialog[open]');
