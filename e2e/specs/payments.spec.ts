import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, openRoom } from '../fixtures/tenancy';

test.describe('Phase 6 — thu tiền, VietQR, link xem thông báo', () => {
  test('phát hành → QR → ghi nhận thu một phần → link gửi khách mở được không cần đăng nhập', async ({ page, browser }, info) => {
    const code = info.project.name === 'desktop' ? 'A201' : 'B201';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách QR ${code}`, deposit: '' });
    await page.getByRole('link', { name: /^Thông báo tháng \d{2}\/\d{4} \(nháp\)$/ }).click();
    await page.getByRole('button', { name: 'Phát hành' }).click();
    await dialog(page).getByRole('button', { name: 'Phát hành' }).click();
    await expect(page.getByText(/Đã phát hành TB-\d{6}-\d{4}\./)).toBeVisible();

    // QR với tài khoản demo, kèm thông tin chuyển tay
    await expect(page.getByRole('img', { name: 'Mã VietQR' })).toBeVisible();
    await expect(page.getByText('0011223344')).toBeVisible();
    await expect(page.getByText(/Tài khoản demo — không chuyển tiền thật/)).toBeVisible();

    await page.getByRole('button', { name: 'Ghi nhận thu' }).click();
    await dialog(page).getByLabel('Số tiền thu').fill('500000');
    await dialog(page).getByLabel('Mã giao dịch / tham chiếu').fill('FT-E2E-001');
    await expect(dialog(page).getByLabel('Người nhận tiền')).toHaveValue(/.+/); // mặc định: người đang đăng nhập (D-045)
    await expect(dialog(page).getByLabel('Người nhận tiền').locator('option', { hasText: 'Chủ trọ Demo (tôi)' })).toHaveCount(1);
    await dialog(page).getByRole('button', { name: /^Ghi nhận 500\.000 ₫$/ }).click();
    await expect(page.getByText(/Đã ghi phiếu thu PT-\d{6}-\d{4}: 500\.000 ₫/)).toBeVisible();
    await expect(page.getByText('Thu một phần').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /FT-E2E-001/ })).toBeVisible();
    await expect(page.getByText('Người nhận: Chủ trọ Demo')).toBeVisible();

    await page.getByRole('button', { name: 'Sao chép link gửi khách' }).click();
    const toast = page.getByText(/Đã tạo và sao chép link/);
    await expect(toast).toBeVisible();
    const url = /(https?:\/\/\S+\/p\/[A-Za-z0-9_-]+)/.exec((await toast.textContent()) ?? '')![1]!;

    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto(url);
    await expect(pub.getByRole('heading', { name: /Thông báo tiền phòng tháng/ })).toBeVisible();
    await expect(pub.getByText('Còn phải thanh toán')).toBeVisible();
    await expect(pub.getByRole('img', { name: 'Mã VietQR' })).toBeVisible();
    await expect(pub.getByText(`Khách QR ${code}`)).toHaveCount(0);
    await pub.goto(url.replace(/.{4}$/, 'zzzz'));
    await expect(pub.getByRole('heading', { name: 'Link không còn hiệu lực' })).toBeVisible();
    await anon.close();

    await page.goto('/payments');
    await expect(page.getByRole('link', { name: new RegExp(`· ${code}$`) })).toBeVisible();
  });
});
