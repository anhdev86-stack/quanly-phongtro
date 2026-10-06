import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 5 — thông báo tiền phòng', () => {
  test('nhận phòng sinh nháp thông báo đầu tiên → phát hành có số chứng từ → trang in', async ({ page }, info) => {
    const code = info.project.name === 'desktop' ? 'A105' : 'B105';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách TB ${code}`, deposit: '' });

    // Bước 8 của nhận phòng: nháp thông báo tháng nhận phòng
    await page.getByRole('link', { name: /^Thông báo tháng \d{2}\/\d{4} \(nháp\)$/ }).click();
    await expect(page.getByRole('heading', { name: /Thông báo tháng \d{2}\/\d{4} \(nháp\)/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^Tiền phòng \d{2}\/\d{2}–\d{2}\/\d{2}\/\d{4}$/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Thu trước' })).toBeVisible();
    await expect(page.getByText('Hạn thanh toán')).toBeVisible();

    await page.getByRole('button', { name: 'Phát hành' }).click();
    await dialog(page).getByRole('button', { name: 'Phát hành' }).click();
    await expect(page.getByText(/Đã phát hành TB-\d{6}-\d{4}\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^TB-\d{6}-\d{4}/ })).toBeVisible();
    await expect(page.getByText('Chưa thu', { exact: true })).toBeVisible();

    const url = page.url();
    await page.goto(url.replace('/invoices/', '/print/invoices/'));
    await expect(page.getByText('THÔNG BÁO TIỀN PHÒNG')).toBeVisible();
    await expect(page.getByText('Chứng từ nội bộ, không phải hóa đơn GTGT.')).toBeVisible();
    await expect(page.getByText(`Phòng: ${code}`, { exact: false })).toBeVisible();
  });

  test('tính phí tháng: xem trước theo từng phòng không ghi chứng từ', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Một lần là đủ cho luồng xem trước.');
    await loginAs(page, 'owner');
    await page.goto(`/invoices?period=${localDate(0).slice(0, 7)}`);
    await page.getByRole('button', { name: 'Xem trước' }).click();
    await expect(page.getByRole('columnheader', { name: 'Kết quả' })).toBeVisible();
    await expect(page.getByText(/Đã có thông báo kỳ này|Còn nháp chưa phát hành|Sẵn sàng|Có lỗi chặn phát hành/).first()).toBeVisible();
  });
});
