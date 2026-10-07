import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 3 — hợp đồng, gia hạn, đổi giá', () => {
  test('nhận phòng kèm hợp đồng sắp hết hạn → gia hạn có giá mới → hủy kỳ gia hạn → giảm giá một tháng', async ({ page }, info) => {
    const desktop = info.project.name === 'desktop';
    const code = desktop ? 'A103' : 'B103';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách HĐ ${code}`, deposit: '3000000', contractEnd: localDate(20) });

    await expect(page.getByText('Có hợp đồng')).toBeVisible();
    await expect(page.getByText(/Hợp đồng HD\d{4}-\d{4} hết hạn ngày .* \(còn 20 ngày\)/)).toBeVisible();
    await expect(page.getByText('Đang hiệu lực')).toBeVisible();

    // Danh sách sắp hết hạn có phòng này
    await page.goto('/contracts?expiring_within_days=30');
    // Phase 11 thêm thẻ cảnh báo phía trên cũng có link phòng: chỉ xét bảng danh sách.
    await expect(page.getByRole('table').getByRole('link', { name: new RegExp(`· ${code}$`) })).toBeVisible();
    await page.getByRole('table').getByRole('link', { name: new RegExp(`· ${code}$`) }).click();

    // Gia hạn với giá mới
    await page.getByRole('button', { name: 'Gia hạn' }).click();
    await dialog(page).getByLabel('Giá thuê theo kỳ này').fill('3300000');
    const confirmMid = dialog(page).getByLabel(/Tôi xác nhận tiền phòng tháng đó/);
    if (await confirmMid.isVisible()) await confirmMid.check();
    await dialog(page).getByRole('button', { name: 'Lưu kỳ gia hạn' }).click();
    await expect(page.getByText(/Đã gia hạn hợp đồng HD\d{4}-\d{4}\./)).toBeVisible();
    await expect(page.getByText('Chưa bắt đầu')).toBeVisible();
    await expect(page.getByText(/hết hạn ngày/)).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '3.300.000 ₫' }).first()).toBeVisible();
    // Cột ghi chú của bảng giá chỉ hiện từ màn hình sm trở lên
    if (desktop) await expect(page.getByRole('cell', { name: /\(theo hợp đồng\)/ })).toBeVisible();

    // Hủy kỳ gia hạn chưa bắt đầu → giá theo hợp đồng bị vô hiệu
    await page.getByRole('row', { name: /Chưa bắt đầu/ }).getByRole('button', { name: 'Hủy' }).click();
    await dialog(page).getByLabel('Lý do').fill('Khách không gia hạn');
    await dialog(page).getByRole('button', { name: 'Hủy hợp đồng' }).click();
    await expect(page.getByText(/Đã hủy HD\d{4}-\d{4}; vô hiệu hóa 1 mục giá\/dịch vụ phụ thuộc\./)).toBeVisible();
    await expect(page.getByText('Lý do: Khách không gia hạn')).toBeVisible();
    if (desktop) await expect(page.getByRole('cell', { name: /^Vô hiệu: Hủy hợp đồng/ })).toBeVisible();

    // Giảm giá một tháng (mặc định từ ngày 1 tháng sau)
    await page.getByRole('button', { name: 'Đổi giá thuê' }).click();
    await dialog(page).getByLabel('Giá thuê mỗi tháng').fill('1800000');
    await dialog(page).getByLabel('Lý do').fill('Giảm giá tháng sửa chữa');
    await dialog(page).getByLabel(/Chỉ áp dụng cho tháng này/).check();
    await dialog(page).getByRole('button', { name: 'Lưu giá mới' }).click();
    await expect(page.getByText(/Đã đặt giá 1\.800\.000 ₫ từ .* \(chỉ tháng này\)\./)).toBeVisible();
    await expect(page.getByRole('cell', { name: '1.800.000 ₫' })).toBeVisible();
    if (desktop) await expect(page.getByRole('cell', { name: 'Giảm giá tháng sửa chữa' })).toBeVisible();
  });
});
