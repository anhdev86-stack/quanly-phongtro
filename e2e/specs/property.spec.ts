import { expect, test } from '@playwright/test';
import { dialog, loginAs, uniqueCode } from '../fixtures/session';

test.describe('Phase 1 — tòa, phòng, giữ phòng', () => {
  test('OWNER thêm phòng, giữ phòng, hủy giữ phòng, chuyển bảo trì rồi lưu trữ', async ({ page }) => {
    const code = uniqueCode('E');
    await loginAs(page, 'owner');
    await page.goto('/rooms');
    await page.getByRole('button', { name: 'Thêm phòng' }).click();
    const d = dialog(page);
    await d.getByLabel('Tòa').selectOption({ label: 'C — Tòa C — Ngõ Bình Yên' });
    await d.getByLabel('Mã phòng').fill(code);
    await d.getByLabel('Giá thuê mặc định / tháng').fill('2750000');
    await d.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(`Đã thêm phòng ${code}.`)).toBeVisible();

    await page.getByLabel('Tìm mã phòng / tên khách').fill(code);
    await page.getByRole('link', { name: new RegExp(code) }).first().click();
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) })).toBeVisible();
    await expect(page.getByText('2.750.000 ₫')).toBeVisible();

    // Giữ phòng hôm nay → trạng thái "Đã giữ"
    await page.getByRole('button', { name: 'Giữ phòng' }).click();
    await dialog(page).getByLabel('Người giữ chỗ').fill('Khách E2E');
    await dialog(page).getByRole('button', { name: 'Giữ phòng' }).click();
    await expect(page.getByText(`Đã giữ phòng ${code} cho Khách E2E.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) }).getByText('Đã giữ')).toBeVisible();

    // Hủy giữ phòng cần lý do
    await page.getByRole('button', { name: 'Hủy giữ phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Hủy giữ phòng' }).click();
    await expect(dialog(page).getByText('Vui lòng nhập lý do')).toBeVisible();
    await dialog(page).getByLabel('Lý do').fill('Khách đổi ý (E2E)');
    await dialog(page).getByRole('button', { name: 'Hủy giữ phòng' }).click();
    await expect(page.getByText('Lý do: Khách đổi ý (E2E)')).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) }).getByText('Trống')).toBeVisible();

    // Bảo trì
    await page.getByRole('button', { name: 'Chuyển bảo trì' }).click();
    await dialog(page).getByLabel('Lý do').fill('Sơn lại tường');
    await dialog(page).getByRole('button', { name: 'Chuyển bảo trì' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) }).getByText('Bảo trì')).toBeVisible();

    // Dọn dữ liệu E2E: lưu trữ phòng
    await page.getByRole('button', { name: 'Lưu trữ' }).click();
    await expect(page.getByText('Đã lưu trữ phòng.')).toBeVisible();
  });

  test('quản lý tòa B, C chỉ thấy phòng của tòa B, C', async ({ page }) => {
    await loginAs(page, 'managerBC');
    await page.goto('/rooms');
    await expect(page.getByTestId('room-grid')).toBeVisible();
    const buildingCodes = await page.getByTestId('room-building').allTextContents();
    expect(buildingCodes.length).toBeGreaterThan(0);
    expect(new Set(buildingCodes)).toEqual(new Set(['B', 'C']));
  });
});
