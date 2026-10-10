import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 14 — chuyển phòng', () => {
  test('trả phòng cũ (quyết toán) → chuyển sang phòng mới, cọc chuyển theo, hai lần thuê liên kết nhau', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Luồng dài nhiều bước: kiểm trên desktop.');
    const from = 'A203';
    const to = 'A204';
    await loginAs(page, 'owner');
    await openRoom(page, from);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: 'Khách chuyển A203', deposit: '3000000', startDate: localDate(-1) });

    // Bước 1: trả phòng cũ bằng quy trình sẵn có (ngày cuối tính tiền mặc định là hôm nay).
    await page.getByRole('button', { name: 'Báo trả phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Ghi báo trả' }).click();
    await expect(page.getByText(/Đã ghi báo trả, dự kiến trả hết ngày/)).toBeVisible();
    await page.getByRole('link', { name: 'Trả phòng', exact: true }).click();
    // Chuyển phòng giữa tháng: tính tiền phòng cũ tới ngày chuyển (mặc định hết tháng chỉ dùng khi dọn đi hẳn — D-046)
    await expect(page.getByLabel('Ngày cuối tính tiền phòng')).toHaveValue(/-(28|29|30|31)$/);
    await page.getByLabel('Ngày cuối tính tiền phòng').fill(localDate(0));
    await page.getByLabel('Chỉ số điện cuối kỳ').fill('1530');
    await page.getByLabel('Chỉ số nước cuối kỳ').fill('86');
    await page.getByLabel(/Kiểm kê tài sản/).fill('Đủ, chuyển sang phòng khác');
    await page.getByRole('button', { name: 'Lưu & xem trước' }).click();
    await page.getByRole('button', { name: 'Duyệt quyết toán' }).click();
    await expect(page.getByText(/Đã duyệt quyết toán QT\d{4}-\d{4}/)).toBeVisible();
    await page.getByRole('button', { name: 'Hoàn tất trả phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Hoàn tất trả phòng' }).click();
    await expect(page.getByText(`Đã hoàn tất trả phòng ${from}.`)).toBeVisible();

    // Bước 2: chuyển phòng ở trang lần thuê cũ.
    await page.goto(page.url().replace(/\/move-out.*$/, ''));
    const section = page.getByTestId('transfer-section');
    await section.getByRole('button', { name: 'Chuyển sang phòng khác' }).click();
    const option = dialog(page).locator('#tr-room option', { hasText: `· ${to} —` });
    await dialog(page).getByLabel('Phòng mới (đang trống)').selectOption((await option.getAttribute('value'))!);
    await dialog(page).getByLabel('Chỉ số điện ban đầu (phòng mới)').fill('200');
    await dialog(page).getByLabel('Lý do / ghi chú').fill('Khách muốn phòng tầng thấp');
    await dialog(page).getByRole('button', { name: 'Chuyển phòng' }).click();
    await expect(page.getByText(/Đã chuyển phòng: lần thuê mới LT\d{4}-\d{4}, chuyển cọc [\d.]+ ₫\./)).toBeVisible();

    // Trang lần thuê mới: liên kết về phòng cũ, có cọc chuyển sang
    await expect(page.getByTestId('transfer-section').getByText(new RegExp(`Chuyển từ A · ${from}`))).toBeVisible();
    await page.getByTestId('transfer-section').getByRole('link').click();
    await expect(page.getByTestId('transfer-section').getByText(new RegExp(`Đã chuyển sang A · ${to}`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chuyển sang phòng khác' })).toHaveCount(0);
  });
});
