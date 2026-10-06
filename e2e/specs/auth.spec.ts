import { expect, type Page, test } from '@playwright/test';
import { accounts } from '../fixtures/accounts';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('chưa đăng nhập thì bị chuyển về trang đăng nhập', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('sai thông tin đăng nhập hiện thông báo tiếng Việt và vẫn ở trang đăng nhập', async ({ page }) => {
  // Email không tồn tại: không làm tài khoản thật chạm giới hạn 5 lần sai khi chạy E2E nhiều lần.
  await login(page, 'khong-ton-tai.e2e@example.test', 'sai-mat-khau-e2e');
  // Chỉ tìm trong form: Next.js có sẵn một phần tử role="alert" (route announcer).
  await expect(page.locator('form').getByRole('alert')).toHaveText('Email hoặc mật khẩu không đúng.');
  await expect(page).toHaveURL(/\/login$/);
});

test('kiểm tra định dạng ở form trước khi gọi API', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('khong-phai-email');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByText('Email không hợp lệ.')).toBeVisible();
  await expect(page.getByText('Vui lòng nhập mật khẩu.')).toBeVisible();
});

test('OWNER đăng nhập thấy cả 3 tòa; token phiên không đọc được bằng JavaScript; đăng xuất', async ({ page, isMobile }) => {
  await login(page, accounts.owner.email, accounts.owner.password());
  await expect(page.getByRole('heading', { name: `Xin chào, ${accounts.owner.name}` })).toBeVisible();
  await expect(page.getByTestId('building-list').getByRole('listitem')).toHaveCount(3);

  const jsCookies = await page.evaluate(() => document.cookie);
  expect(jsCookies).toContain('qt_csrf=');
  expect(jsCookies).not.toContain('qt_access');
  expect(jsCookies).not.toContain('qt_refresh');

  if (isMobile) {
    await page.getByRole('button', { name: 'Mở menu' }).click();
    await expect(page.getByRole('link', { name: 'Tổng quan' }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Đóng menu' }).click();
    await expect(page.getByRole('button', { name: 'Đóng menu' })).toHaveCount(0);
  }

  await logout(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('STAFF chỉ thấy tòa trong phạm vi được giao', async ({ page }) => {
  await login(page, accounts.staffA.email, accounts.staffA.password());
  await expect(page.getByRole('heading', { name: `Xin chào, ${accounts.staffA.name}` })).toBeVisible();
  const items = page.getByTestId('building-list').getByRole('listitem');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Tòa A');
  await logout(page);
});

test('access token hết hạn thì web tự refresh và giữ phiên', async ({ page, context }) => {
  await login(page, accounts.staffBC.email, accounts.staffBC.password());
  await expect(page.getByRole('heading', { name: `Xin chào, ${accounts.staffBC.name}` })).toBeVisible();

  // Giả lập access token hết hạn: xóa riêng cookie access, giữ refresh + CSRF.
  const remaining = (await context.cookies()).filter((c) => c.name !== 'qt_access');
  await context.clearCookies();
  await context.addCookies(remaining);

  await page.reload();
  await expect(page.getByRole('heading', { name: `Xin chào, ${accounts.staffBC.name}` })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === 'qt_access')).toBe(true);
  await logout(page);
});
