import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, openRoom } from '../fixtures/tenancy';

test.describe('Phase 2 — nhận phòng, cọc, tiền giữ chỗ', () => {
  test('OWNER nhận phòng qua wizard, ghi nhận thêm cọc; phòng chuyển Đang thuê', async ({ page }, info) => {
    const code = info.project.name === 'desktop' ? 'A101' : 'B101';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await expect(page.getByRole('heading', { name: `Nhận phòng ${code}` })).toBeVisible();
    await finishWizard(page, { tenant: `Khách E2E ${code}`, deposit: '3000000' });

    await expect(page.getByText(`Đại diện: Khách E2E ${code}`)).toBeVisible();
    await expect(page.getByText('Thuê theo tháng', { exact: true })).toBeVisible();
    await expect(page.getByText('Chỉ số lúc nhận phòng: Điện 1520 · Nước 85')).toBeVisible();

    await page.getByRole('button', { name: 'Ghi giao dịch cọc' }).click();
    await dialog(page).getByLabel('Loại giao dịch').selectOption('TOP_UP');
    await dialog(page).getByLabel('Số tiền').fill('500000');
    await dialog(page).getByRole('button', { name: 'Ghi giao dịch' }).click();
    await expect(page.getByText(/Đã ghi nhận thêm cọc 500\.000 ₫/)).toBeVisible();
    await expect(page.locator('dd', { hasText: '3.500.000 ₫' }).first()).toBeVisible();

    await openRoom(page, code);
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) }).getByText('Đang thuê')).toBeVisible();
  });

  test('giữ phòng có tiền giữ chỗ, rồi nhận phòng từ lượt giữ: tiền giữ chỗ chuyển thành cọc', async ({ page }, info) => {
    const code = info.project.name === 'desktop' ? 'A102' : 'B102';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('button', { name: 'Giữ phòng' }).click();
    await dialog(page).getByLabel('Người giữ chỗ').fill(`Người giữ ${code}`);
    await dialog(page).getByRole('button', { name: 'Giữ phòng' }).click();
    await expect(page.getByText(`Đã giữ phòng ${code} cho Người giữ ${code}.`)).toBeVisible();

    await page.getByRole('button', { name: 'Tiền giữ chỗ' }).click();
    await dialog(page).getByRole('button', { name: 'Ghi giao dịch' }).click();
    const tx = page.locator('dialog[open]').last();
    await tx.getByLabel('Số tiền').fill('1000000');
    await tx.getByRole('button', { name: 'Ghi giao dịch' }).click();
    await expect(page.getByText(/Đã ghi nhận tiền giữ chỗ 1\.000\.000 ₫/)).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Nhận phòng từ lượt giữ này' }).click();
    await expect(page.getByText('Nhận phòng từ lượt giữ chỗ')).toBeVisible();
    await page.getByRole('button', { name: 'Tiếp' }).click();
    await expect(page.locator('#mi-p-full_name')).toHaveValue(`Người giữ ${code}`);
    await page.getByRole('button', { name: 'Quay lại' }).click();
    await finishWizard(page, { tenant: `Người giữ ${code}`, deposit: '2000000' });

    await expect(page.getByRole('cell', { name: /Chuyển từ tiền giữ chỗ\s*Liên kết/ })).toBeVisible();
    await expect(page.locator('dd', { hasText: '3.000.000 ₫' }).first()).toBeVisible();
  });
});
