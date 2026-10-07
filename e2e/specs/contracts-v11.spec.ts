import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 11 — phụ lục hợp đồng, cảnh báo hết hạn, kỳ phát hành', () => {
  test('hợp đồng còn 10 ngày → cảnh báo mốc 15 ngày; lập phụ lục kéo dài → cảnh báo hết', async ({ page }, info) => {
    const code = info.project.name === 'desktop' ? 'A104' : 'B104';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách PL ${code}`, deposit: '3000000', contractEnd: localDate(10) });
    const tenancyUrl = page.url();

    // Cảnh báo theo mốc trên trang Hợp đồng
    await page.goto('/contracts');
    const alerts = page.getByTestId('contract-alerts');
    const row = alerts.getByRole('listitem').filter({ hasText: code });
    await expect(row).toContainText('Mốc 15 ngày');

    // Phụ lục: kéo dài thêm 6 tháng
    await page.goto(tenancyUrl);
    await page.getByRole('button', { name: 'Phụ lục' }).click();
    await dialog(page).getByLabel('Ngày kết thúc mới').fill(localDate(190));
    await dialog(page).getByLabel(/Lý do \/ nội dung thỏa thuận/).fill('Gia hạn thêm 6 tháng theo phụ lục');
    await dialog(page).getByRole('button', { name: 'Lập phụ lục' }).click();
    await expect(page.getByText(/Đã lập phụ lục số 1 cho HD\d{4}-\d{4}\./)).toBeVisible();
    await expect(page.getByText(/Số 1 · từ .* kết thúc/)).toBeVisible();

    await page.goto('/contracts');
    await expect(page.getByTestId('contract-alerts').getByRole('listitem').filter({ hasText: code })).toHaveCount(0);
  });

  test('trang kỳ phát hành: chủ trọ thấy danh sách kỳ; nhân viên không có nút đóng', async ({ page }) => {
    await loginAs(page, 'owner');
    await page.goto('/invoices');
    await page.getByRole('link', { name: 'Kỳ phát hành' }).click();
    await expect(page.getByRole('heading', { name: 'Kỳ phát hành', level: 1 })).toBeVisible();
    await expect(page.getByText(/Đang mở|Đã đóng|Chưa có kỳ phát hành/).first()).toBeVisible();
    await loginAs(page, 'staffA');
    await page.goto('/invoices/periods');
    await expect(page.getByRole('heading', { name: 'Kỳ phát hành', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đóng kỳ' })).toHaveCount(0);
  });
});
