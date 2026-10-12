import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, openRoom } from '../fixtures/tenancy';

/**
 * D-047 — tự động ghi nhận chuyển khoản qua VietQR bằng nhà cung cấp giả lập (mock). Đúng kịch bản demo:
 * phát hành → QR thử nghiệm → giả lập chuyển khoản qua webhook → phiếu thu tự động, hết nợ → gửi lại webhook không ghi trùng
 * → giao dịch sai mã vào “Chờ đối chiếu” → đối chiếu tay.
 */
test.describe('D-047 — giao dịch ngân hàng (mock)', () => {
  test('QR thử nghiệm → webhook giả lập ghi nhận thu, không ghi trùng; sai mã chờ đối chiếu rồi đối chiếu tay', async ({ page, browser }, info) => {
    const code = info.project.name === 'desktop' ? 'A302' : 'B302';
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách CK ${code}`, deposit: '' });
    await page.getByRole('link', { name: /^Thông báo tháng \d{2}\/\d{4} \(nháp\)$/ }).click();
    await page.getByRole('button', { name: 'Phát hành' }).click();
    await dialog(page).getByRole('button', { name: 'Phát hành' }).click();
    const published = page.getByText(/Đã phát hành TB-\d{6}-\d{4}\./);
    await expect(published).toBeVisible();
    const number = /TB-\d{6}-\d{4}/.exec((await published.textContent()) ?? '')![0];
    const payCode = number.replace(/-/g, '');
    const invoiceUrl = page.url();

    // QR hiện rõ môi trường thử nghiệm; link công khai cũng vậy
    await expect(page.getByText('Môi trường thử nghiệm — không chuyển tiền thật')).toBeVisible();
    await page.getByRole('button', { name: 'Sao chép link gửi khách' }).click();
    const toast = page.getByText(/Đã tạo và sao chép link/);
    const link = /(https?:\/\/\S+\/p\/[A-Za-z0-9_-]+)/.exec((await toast.textContent()) ?? '')![1]!;
    const anon = await browser.newContext();
    const pub = await anon.newPage();
    await pub.goto(link);
    await expect(pub.getByText('Môi trường thử nghiệm — không chuyển tiền thật')).toBeVisible();
    await expect(pub.getByRole('img', { name: 'Mã VietQR' })).toBeVisible();

    // Giả lập chuyển khoản: chọn thông báo → nội dung và số tiền điền sẵn → gửi webhook
    await page.goto('/payments?tab=bank');
    await expect(page.getByText(/Môi trường thử nghiệm — không chuyển tiền thật · Nhà cung cấp: mock/)).toBeVisible();
    await page.getByRole('button', { name: 'Giả lập giao dịch' }).click();
    const pick = dialog(page).getByLabel('Lấy theo thông báo (điền sẵn nội dung và số tiền)');
    await pick.selectOption((await pick.locator('option', { hasText: number }).getAttribute('value'))!);
    await expect(dialog(page).getByLabel('Nội dung chuyển khoản')).toHaveValue(`${payCode} ${code}`);
    await dialog(page).getByRole('button', { name: 'Tạo giao dịch' }).click();
    await expect(page.getByText(/Webhook trả HTTP 200\. Trạng thái: MATCHED\./)).toBeVisible();

    // Chi tiết mở ngay: đã đối chiếu, có phiếu thu; gửi lại webhook → vẫn một phiếu thu
    await expect(dialog(page).getByText('Đã đối chiếu')).toBeVisible();
    await expect(dialog(page).getByText(/PT-\d{6}-\d{4} · tạo từ giao dịch này/)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Gửi lại webhook (mock)' }).click();
    await expect(page.getByText('Đã gửi lại webhook — giao dịch không bị ghi trùng.')).toBeVisible();
    await expect(dialog(page).getByText(/PT-\d{6}-\d{4} · tạo từ giao dịch này/)).toHaveCount(1);
    await dialog(page).getByRole('button', { name: 'Đóng' }).first().click();

    // Thông báo hết nợ, phiếu thu “Tự động (ngân hàng)”
    await page.goto(invoiceUrl);
    await expect(page.getByText('Đã thu đủ').first()).toBeVisible();
    await expect(page.getByText(/Đã thu đủ — không còn hiển thị QR/)).toBeVisible();
    await pub.reload();
    await expect(pub.getByText('Đã thanh toán.')).toBeVisible();
    await expect(pub.getByRole('img', { name: 'Mã VietQR' })).toHaveCount(0);
    await anon.close();

    // Giao dịch sai mã → chờ đối chiếu, có lý do; đối chiếu tay bằng “Không áp dụng”
    await page.goto('/payments?tab=bank');
    await page.getByRole('button', { name: 'Giả lập giao dịch' }).click();
    await dialog(page).getByLabel('Nội dung chuyển khoản').fill(`chuyen tien phong ${code}`);
    await dialog(page).getByLabel('Số tiền', { exact: true }).fill('150000');
    await dialog(page).getByRole('button', { name: 'Tạo giao dịch' }).click();
    await expect(dialog(page).getByText('Chờ đối chiếu')).toBeVisible();
    await expect(dialog(page).getByText('Không tìm thấy mã thanh toán trong nội dung chuyển khoản.')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Không áp dụng' }).click();
    const reason = page.locator('dialog[open]').last();
    await reason.getByRole('textbox').fill('Khách chuyển nhầm, đã trả lại');
    await reason.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText('Đã đánh dấu không áp dụng.')).toBeVisible();
    await expect(dialog(page).getByText('Giao dịch đã xử lý xong — không xử lý lại.')).toBeVisible();
  });
});
