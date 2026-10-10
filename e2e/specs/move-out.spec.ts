import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 7 — báo trả, trả phòng, quyết toán', () => {
  test('báo trả → trả phòng: chỉ số cuối, kiểm kê → xem trước → duyệt → hoàn tất → hoàn cọc', async ({ page }, info) => {
    const code = info.project.name === 'desktop' ? 'A202' : 'B202';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách trả ${code}`, deposit: '3000000', startDate: localDate(-1) });

    await page.getByRole('button', { name: 'Báo trả phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Ghi báo trả' }).click();
    await expect(page.getByText(/Đã ghi báo trả, dự kiến trả hết ngày/)).toBeVisible();
    await expect(page.getByText('Đang báo trả', { exact: true }).or(page.getByText(/Khách đã báo trả ngày/)).first()).toBeVisible();

    // Vào trả phòng thẳng từ trang phòng (nút cạnh “Chuyển bảo trì”)
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Trả phòng', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Trả phòng ${code}` })).toBeVisible();
    await page.getByLabel('Chỉ số điện cuối kỳ').fill('1530');
    await page.getByLabel('Chỉ số nước cuối kỳ').fill('86');
    await page.getByLabel(/Kiểm kê tài sản/).fill('Đủ tài sản, nhận lại 2 chìa khóa');
    await page.getByRole('button', { name: 'Lưu & xem trước' }).click();
    await expect(page.getByRole('heading', { name: '4. Xem trước đối soát và cấn trừ' })).toBeVisible();
    await expect(page.getByText('Áp cọc vào nợ', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^Tiền phòng / })).toBeVisible();

    await page.getByRole('button', { name: 'Duyệt quyết toán' }).click();
    await expect(page.getByText(/Đã duyệt quyết toán QT\d{4}-\d{4}/)).toBeVisible();
    await page.getByRole('button', { name: 'Hoàn tất trả phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Hoàn tất trả phòng' }).click();
    await expect(page.getByText(`Đã hoàn tất trả phòng ${code}.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Quyết toán QT\d{4}-\d{4}/ })).toBeVisible();
    await expect(page.getByText('Đã hoàn tất', { exact: true })).toBeVisible();
    await expect(page.getByText('Chủ còn phải hoàn', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Hoàn cọc' }).click();
    await dialog(page).getByRole('button', { name: /^Ghi / }).click();
    await expect(page.getByText(/Hoàn cọc cho khách: đã ghi/)).toBeVisible();
    await expect(page.getByText('Đã cân bằng', { exact: true })).toBeVisible();

    await openRoom(page, code);
    await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) }).getByText('Trống')).toBeVisible();
  });
});
