import { expect, test } from '@playwright/test';
import { dialog, loginAs, uniqueCode } from '../fixtures/session';

test.describe('Phase 8B — nhắc đóng tiền', () => {
  test('ghi nhận đồng ý nhận tin, bật nhắc, chạy nhắc ngay; ngoài production chỉ ghi log', async ({ page }) => {
    await loginAs(page, 'owner');
    const name = `Khách nhắc ${uniqueCode('N')}`;
    await page.goto('/tenants');
    await page.getByRole('button', { name: 'Thêm người thuê' }).click();
    await page.locator('#tn-full_name').fill(name);
    await page.locator('#tn-phone').fill('0912345678');
    await dialog(page).getByRole('button', { name: 'Lưu' }).click();
    await page.getByLabel('Tìm theo tên, số điện thoại').fill(name);
    await page.getByRole('link', { name }).click();

    const consent = page.getByTestId('reminder-consent');
    await expect(consent.getByText('Chưa nhận tin')).toBeVisible();
    await consent.getByRole('button', { name: 'Ghi nhận đồng ý' }).click();
    await dialog(page).getByRole('button', { name: 'Bật nhận tin' }).click();
    await expect(dialog(page).getByText('Ghi lại cách người thuê đồng ý nhận tin.')).toBeVisible();
    await dialog(page).getByLabel('Cách người thuê đồng ý').fill('Ký phụ lục hợp đồng');
    await dialog(page).getByRole('button', { name: 'Bật nhận tin' }).click();
    await expect(consent.getByText('Đã đồng ý nhận tin')).toBeVisible();
    await expect(consent.getByTestId('consent-detail')).toContainText('Ký phụ lục hợp đồng');

    await page.goto('/settings/reminders');
    await expect(page.getByTestId('reminder-sending-mode')).toContainText('Chưa gửi tin thật');
    const enabled = page.getByLabel('Bật nhắc đóng tiền tự động');
    if (!(await enabled.isChecked())) await enabled.check();
    await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
    await expect(page.getByText('Đã lưu cấu hình nhắc đóng tiền.')).toBeVisible();

    await page.goto('/reminders');
    await expect(page.getByRole('heading', { name: 'Nhắc đóng tiền', level: 1 })).toBeVisible();
    await expect(page.getByTestId('log-only-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Chạy nhắc ngay' }).click();
    await expect(page.getByText(/^Đã chạy: \d+ tin mới/)).toBeVisible();
  });

  test('nhân viên xem được nhật ký nhắc nhưng không chạy hay sửa cấu hình', async ({ page }) => {
    await loginAs(page, 'staffA');
    await page.goto('/reminders');
    await expect(page.getByRole('heading', { name: 'Nhắc đóng tiền', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chạy nhắc ngay' })).toHaveCount(0);
    await page.goto('/settings/reminders');
    await expect(page.getByText('Bạn chỉ có quyền xem cấu hình.')).toBeVisible();
  });
});
