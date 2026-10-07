import { expect, test } from '@playwright/test';
import { dialog, loginAs, uniqueCode } from '../fixtures/session';

test.describe('Phase 12 — chi phí và báo cáo tài chính', () => {
  test('ghi chi phí, đảo có lý do; báo cáo dòng tiền và thu nhập vận hành hiển thị', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Luồng nhập liệu dài: kiểm trên desktop; mobile kiểm hiển thị ở test sau.');
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Chi phí' }).click();
    await expect(page.getByRole('heading', { name: 'Chi phí', level: 1 })).toBeVisible();
    const note = `Sửa ống nước ${uniqueCode('E')}`;
    await page.getByRole('button', { name: 'Ghi chi phí' }).click();
    await dialog(page).getByLabel('Tòa').selectOption({ index: 1 }); // tòa đầu tiên (A)
    await dialog(page).getByLabel('Số tiền').fill('350000');
    await dialog(page).getByLabel('Ghi chú').fill(note);
    await dialog(page).getByRole('button', { name: 'Ghi chi phí' }).click();
    await expect(page.getByText(/Đã ghi PC-\d{4}-\d{4}: 350\.000/)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(note) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Đảo' }).click();
    await dialog(page).getByLabel(/Lý do/).fill('Ghi nhầm tòa');
    await dialog(page).getByRole('button', { name: 'Đảo khoản chi' }).click();
    await expect(page.getByText(/Đã đảo PC-\d{4}-\d{4}\./)).toBeVisible();
    await expect(row.getByText('Đã đảo')).toBeVisible();

    await page.goto('/reports');
    await page.getByRole('tab', { name: 'Dòng tiền' }).click();
    await expect(page.getByRole('columnheader', { name: 'Nhận cọc' })).toBeVisible();
    await expect(page.getByText(/Chênh lệch tiền không phải lợi nhuận/)).toBeVisible();
    await page.getByRole('tab', { name: 'Chi phí & thu nhập vận hành' }).click();
    await expect(page.getByRole('columnheader', { name: 'Thu nhập vận hành' })).toBeVisible();
    await page.getByRole('tab', { name: 'Doanh thu theo khoản/tòa/phòng' }).click();
    // DB E2E chạy riêng spec này có thể chưa có thông báo đã phát hành
    await expect(page.getByText(/^Tiền phòng$|Chưa có doanh thu trong khoảng này/).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Lấp đầy' }).click();
    await expect(page.getByRole('columnheader', { name: 'Tỷ lệ' })).toBeVisible();
  });

  test('quản lý xem chi phí nhưng không ghi, không có mục Báo cáo (mặc định)', async ({ page }) => {
    await loginAs(page, 'managerA');
    await expect(page.getByRole('link', { name: 'Báo cáo' })).toHaveCount(0);
    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: 'Chi phí', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ghi chi phí' })).toHaveCount(0);
  });
});
