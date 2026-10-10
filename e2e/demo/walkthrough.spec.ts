import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { loginAs } from '../fixtures/session';

/**
 * Vòng demo trên Tòa Demo (dữ liệu từ demo-utilities.mjs): chụp ảnh từng bước để chủ dự án xem lại.
 * Chạy trên database demo riêng; không gửi tin thật (nhắc chỉ ghi log), QR và tài khoản nhận tiền là dữ liệu mẫu.
 */
const OUT = path.join(import.meta.dirname, 'screenshots');
let n = 0;
async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
}
const dialog = (page: Page) => page.locator('dialog[open]');

test('Demo toàn bộ luồng nghiệp vụ trên Tòa Demo', async ({ page, browser }) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  await loginAs(page, 'owner');
  const buildings = (await (await page.request.get('/api/v1/buildings')).json()) as { id: string; code: string }[];
  const demo = buildings.find((b) => b.code === 'DEMO')!;
  expect(demo, 'Chưa có Tòa Demo — chạy demo-utilities.mjs reset').toBeTruthy();

  await test.step('Tổng quan', async () => {
    await expect(page.getByRole('heading', { name: 'Việc cần xử lý' })).toBeVisible();
    await shot(page, 'tong-quan');
  });

  await test.step('Tòa/khu: giá điện nước theo tòa, sửa tòa có giá', async () => {
    await page.goto('/buildings');
    await expect(page.getByRole('link', { name: 'Giá điện nước tòa DEMO' })).toContainText('3.500 ₫/kWh');
    await shot(page, 'toa-khu-gia-dien-nuoc');
    await page.getByRole('button', { name: 'Sửa tòa DEMO' }).click();
    await expect(dialog(page).getByLabel('Giá điện (đ/kWh)')).toHaveValue('3.500');
    await shot(page, 'sua-toa-co-gia');
    await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  });

  await test.step('Điện nước: chốt tháng 09/2026, tiền riêng từng phòng', async () => {
    await page.goto(`/readings?building_id=${demo.id}&month=2026-09`);
    await expect(page.getByTestId('billing-target')).toContainText('vào thông báo tháng 10/2026');
    await page.getByLabel('Ngày đọc đồng hồ').fill('2026-09-30'); // chốt cuối tháng tiêu thụ
    await page.getByLabel('Chỉ số mới điện phòng A101').fill('1100');
    await page.getByLabel('Chỉ số mới nước phòng A101').fill('55');
    await page.getByLabel('Chỉ số mới điện phòng A102').fill('2080');
    await page.getByLabel('Chỉ số mới nước phòng A102').fill('84');
    await expect(page.getByTestId('room-total-A101')).toContainText('425.000 ₫');
    await expect(page.getByTestId('room-total-A102')).toContainText('340.000 ₫');
    await shot(page, 'dien-nuoc-nhap-so-moi');
    await page.getByRole('button', { name: /^Lưu tất cả/ }).click();
    await expect(page.getByText('Đã lưu chỉ số cả danh sách.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('sheet-progress')).toContainText('Đã chốt 2/2 phòng');
    await shot(page, 'dien-nuoc-da-luu-sau-tai-lai');
  });

  await test.step('Thông báo tháng 10: tạo nháp, xem chi tiết, phát hành', async () => {
    await page.getByRole('link', { name: 'Lập thông báo tháng 10/2026' }).click();
    await page.getByRole('button', { name: 'Tạo nháp' }).click();
    await expect(page.getByText(/Đã tạo 2 nháp/)).toBeVisible();
    await shot(page, 'thong-bao-tao-nhap');
    await page.getByRole('link', { name: 'DEMO · A101' }).first().click();
    await expect(page.getByRole('cell', { name: /Điện tháng 09\/2026/ })).toBeVisible();
    await shot(page, 'thong-bao-nhap-A101');
    await page.getByRole('button', { name: 'Phát hành' }).click();
    await dialog(page).getByRole('button', { name: 'Phát hành' }).click();
    await expect(page.getByText(/Đã phát hành TB-\d{6}-\d{4}\./)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Mã VietQR' })).toBeVisible();
    await shot(page, 'thong-bao-da-phat-hanh-QR');
  });

  const invoiceUrl = page.url();

  await test.step('Thu tiền: thu một phần, đảo phiếu thu, thu đủ', async () => {
    await page.getByRole('button', { name: 'Ghi nhận thu' }).click();
    await dialog(page).getByLabel('Số tiền thu').fill('1000000');
    await dialog(page).getByLabel('Mã giao dịch / tham chiếu').fill('DEMO-001');
    await dialog(page).getByRole('button', { name: /^Ghi nhận 1\.000\.000 ₫$/ }).click();
    await expect(page.getByText(/Đã ghi phiếu thu PT-\d{6}-\d{4}: 1\.000\.000 ₫/)).toBeVisible();
    await expect(page.getByText('Thu một phần').first()).toBeVisible();
    await shot(page, 'thu-mot-phan');
    await page.getByRole('button', { name: /^Đảo phiếu thu PT-/ }).click();
    await dialog(page).getByLabel('Lý do').fill('Demo: ghi nhầm số tiền');
    await dialog(page).getByRole('button', { name: 'Đảo phiếu thu' }).click();
    await expect(page.getByText(/Đã đảo phiếu thu PT-/)).toBeVisible();
    await shot(page, 'dao-phieu-thu');
    await page.getByRole('button', { name: 'Ghi nhận thu' }).click();
    await dialog(page).getByLabel('Mã giao dịch / tham chiếu').fill('DEMO-002');
    await dialog(page).getByRole('button', { name: /^Ghi nhận 3\.425\.000 ₫$/ }).click();
    await expect(page.getByText('Đã thu đủ').first()).toBeVisible();
    await shot(page, 'thu-du');
  });

  await test.step('Link gửi khách: mở không cần đăng nhập', async () => {
    await page.getByRole('button', { name: 'Sao chép link gửi khách' }).click();
    const toast = page.getByText(/Đã tạo và sao chép link/);
    await expect(toast).toBeVisible();
    const url = /(https?:\/\/\S+\/p\/[A-Za-z0-9_-]+)/.exec((await toast.textContent()) ?? '')![1]!;
    const anon = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const pub = await anon.newPage();
    await pub.goto(url);
    await expect(pub.getByRole('heading', { name: /Thông báo tiền phòng tháng/ })).toBeVisible();
    await shot(pub, 'khach-xem-thong-bao');
    await anon.close();
  });

  await test.step('Lần thuê: người ở cùng, tạm trú, dịch vụ', async () => {
    await page.goto(invoiceUrl);
    await page.getByRole('link', { name: /^LT\d{4}-\d{4}$/ }).first().click();
    await expect(page.getByRole('heading', { name: /LT\d{4}-\d{4}/ })).toBeVisible();
    await page.getByRole('button', { name: 'Thêm người' }).click();
    await dialog(page).getByLabel('Họ tên').fill('Người ở cùng Demo');
    await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText('Đã thêm người ở cùng.')).toBeVisible();
    await page.getByRole('button', { name: 'Tạm trú của Người ở cùng Demo' }).click();
    await dialog(page).getByLabel('Tình trạng').selectOption({ index: 1 });
    await dialog(page).getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã cập nhật tạm trú.')).toBeVisible();
    await page.getByRole('button', { name: 'Thêm dịch vụ' }).click();
    await dialog(page).getByLabel('Dịch vụ').selectOption({ label: 'Gửi xe máy (xe/tháng)' });
    await dialog(page).getByLabel('Số lượng').fill('1');
    await dialog(page).getByRole('button', { name: /^(Lưu|Thêm)/ }).last().click();
    await expect(dialog(page)).toHaveCount(0);
    await shot(page, 'lan-thue-nguoi-o-dich-vu');
  });

  await test.step('Kỳ phát hành: đóng kỳ 09/2026 rồi mở lại có lý do', async () => {
    await page.goto('/invoices/periods');
    const row = page.getByRole('row', { name: /09\/2026/ });
    await row.getByRole('button', { name: 'Đóng kỳ' }).click();
    if (await dialog(page).count()) await dialog(page).getByRole('button', { name: /Đóng kỳ/ }).click();
    await expect(row.getByRole('button', { name: 'Mở lại' })).toBeVisible();
    await shot(page, 'ky-da-dong');
    await row.getByRole('button', { name: 'Mở lại' }).click();
    await dialog(page).getByLabel('Lý do').fill('Demo: mở lại để sửa');
    await dialog(page).getByRole('button', { name: 'Mở lại kỳ' }).click();
    await expect(page.getByText('Đã mở lại kỳ 09/2026.')).toBeVisible();
    await shot(page, 'ky-mo-lai');
  });

  await test.step('Trả phòng A102: báo trả, chỉ số cuối, quyết toán', async () => {
    await page.goto(`/invoices?period=2026-10&building_id=${demo.id}`);
    await page.getByRole('row', { name: /DEMO · A102/ }).getByRole('link').first().click();
    await page.getByRole('link', { name: /^LT\d{4}-\d{4}$/ }).first().click();
    await page.getByRole('button', { name: 'Báo trả phòng' }).click();
    await dialog(page).getByRole('button', { name: 'Ghi báo trả' }).click();
    await expect(page.getByText(/Đã ghi báo trả, dự kiến trả hết ngày/)).toBeVisible();
    await page.getByRole('link', { name: 'Trả phòng', exact: true }).click();
    await page.getByLabel('Chỉ số điện cuối kỳ').fill('2100');
    await page.getByLabel('Chỉ số nước cuối kỳ').fill('85');
    await page.getByLabel(/Kiểm kê tài sản/).fill('Đủ tài sản, nhận lại 2 chìa khóa');
    await page.getByRole('button', { name: 'Lưu & xem trước' }).click();
    await expect(page.getByRole('heading', { name: '4. Xem trước đối soát và cấn trừ' })).toBeVisible();
    await shot(page, 'tra-phong-xem-truoc-quyet-toan');
    await page.getByRole('button', { name: 'Duyệt quyết toán' }).click();
    await expect(page.getByText(/Đã duyệt quyết toán QT\d{4}-\d{4}/)).toBeVisible();
    await page.getByRole('button', { name: 'Hoàn tất trả phòng' }).click();
    if (await dialog(page).count()) await dialog(page).getByRole('button', { name: /Hoàn tất/ }).click();
    await expect(page.getByText('Đã hoàn tất').first()).toBeVisible();
    await shot(page, 'tra-phong-hoan-tat');
  });

  await test.step('Chi phí, báo cáo, nhật ký, bảo trì, nhắc đóng tiền', async () => {
    await page.goto('/expenses');
    await page.getByRole('button', { name: 'Ghi chi phí' }).click();
    await dialog(page).getByLabel('Tòa').selectOption({ label: 'DEMO — Tòa Demo' });
    await dialog(page).getByLabel('Số tiền').fill('500000');
    await dialog(page).getByLabel('Ghi chú').fill('Demo: sửa bóng đèn hành lang');
    await dialog(page).getByRole('button', { name: 'Ghi chi phí' }).click();
    await expect(page.getByText(/Đã ghi PC-\d{4}-\d{4}: 500\.000/)).toBeVisible();
    await shot(page, 'chi-phi');

    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Báo cáo', level: 1 })).toBeVisible();
    await shot(page, 'bao-cao-doanh-thu');
    await page.getByRole('tab', { name: 'Dòng tiền' }).click();
    await shot(page, 'bao-cao-dong-tien');

    await page.goto('/maintenance');
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
    await dialog(page).getByLabel('Tòa').selectOption({ label: 'DEMO — Tòa Demo' });
    await dialog(page).getByLabel('Phòng').selectOption({ index: 1 });
    await dialog(page).getByLabel('Nội dung').fill('Demo: vòi nước rò rỉ');
    await dialog(page).getByRole('button', { name: /^(Tạo|Lưu)/ }).last().click();
    await expect(page.getByText('Demo: vòi nước rò rỉ').first()).toBeVisible();
    await shot(page, 'bao-tri');

    await page.goto('/reminders');
    await shot(page, 'nhac-dong-tien');
    await page.goto('/audit');
    await shot(page, 'nhat-ky');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Việc cần xử lý' })).toBeVisible();
    await shot(page, 'tong-quan-sau-demo');
  });
});
