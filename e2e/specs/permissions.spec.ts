import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';

test.describe('Phase 10 — phân quyền theo người dùng và nhật ký', () => {
  test('chủ trọ cấp riêng quyền xem báo cáo cho quản lý; quản lý thấy Báo cáo và Nhật ký vận hành', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/settings/users');
    const row = page.getByRole('row', { name: /Quản lý Tòa A/ });
    await row.getByRole('button', { name: 'Quyền' }).click();
    const reports = dialog(page).getByTestId('perm-reports.view');
    await reports.getByRole('combobox').selectOption('grant');
    await expect(reports.getByText('Có', { exact: true })).toBeVisible();
    // Quyền chỉ chủ trọ có không cấp được
    await expect(dialog(page).getByTestId('perm-users.manage').getByRole('combobox')).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Lưu quyền' }).click();
    await expect(page.getByText('Đã lưu quyền riêng.')).toBeVisible();
    await expect(row.getByText('1 quyền riêng')).toBeVisible();

    // Chủ trọ xem toàn bộ nhật ký, có thao tác vừa làm
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Nhật ký thao tác', level: 1 })).toBeVisible();
    await expect(page.getByText('user.set_permission_overrides').first()).toBeVisible();
  });

  test('quản lý: có Nhật ký (chỉ vận hành), không vào được Người dùng', async ({ page }) => {
    await loginAs(page, 'managerA');
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Nhật ký thao tác', level: 1 })).toBeVisible();
    await expect(page.locator('#au-cat option')).toHaveText(['Tất cả được xem', 'Vận hành']);
    await page.goto('/settings/users');
    await expect(page.getByText(/không có quyền|Bạn không có quyền/i).first()).toBeVisible();
  });

  test('nhân viên không thấy mục Nhật ký', async ({ page }) => {
    await loginAs(page, 'staffA');
    await expect(page.getByRole('link', { name: 'Nhật ký' })).toHaveCount(0);
  });
});
