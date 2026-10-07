import { expect, test } from '@playwright/test';
import { dialog, loginAs, uniqueCode } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
/** Tháng phát hành nhận điện nước tháng hiện tại = tháng sau (theo giờ máy chạy test). */
function nextMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test.describe('Điện nước: thiết lập đồng hồ, chốt chỉ số theo tháng tiêu thụ', () => {
  test('chốt chỉ số theo tháng tiêu thụ: chỉ số cũ tự điền, tạm tính khi gõ, lưu từng phòng, chặn số nhỏ hơn, dùng được ở 360px', async ({ page }, info) => {
    const desktop = info.project.name === 'desktop';
    const building = desktop ? 'A' : 'B';
    const code = `${building}104`;
    const price = desktop ? '280.000 ₫' : '304.000 ₫'; // 80 kWh × giá demo tòa A 3.500 / tòa B 3.800
    await loginAs(page, 'owner');
    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    // Nhận phòng từ hôm qua: chỉ số nhận phòng (hôm qua) và chỉ số chốt (hôm nay) khác ngày.
    await finishWizard(page, { tenant: `Khách điện ${code}`, deposit: '', startDate: localDate(-1) });

    if (!desktop) await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/readings');
    const select = page.getByLabel('Tòa', { exact: true });
    const value = await select.locator('option', { hasText: `${building} —` }).getAttribute('value');
    await select.selectOption(value!);
    // Khách ở từ hôm qua: chốt tháng tiêu thụ hiện tại → vào thông báo tháng sau
    await page.getByLabel('Tháng tiêu thụ').fill(localDate(0).slice(0, 7));
    await expect(page.getByTestId('billing-target')).toContainText(`vào thông báo tháng ${monthLabel(nextMonth())}`);

    const card = page.getByTestId(`reading-room-${code}`);
    await expect(card.getByText('Chưa nhập')).toBeVisible();
    await expect(card.getByTestId(`rd-${code}-ELECTRICITY-previous`)).toHaveText('1520');
    await card.getByLabel(`Chỉ số mới điện phòng ${code}`).fill('1600');
    await expect(card.getByText('80 kWh')).toBeVisible();
    await expect(card.getByText(price)).toBeVisible();
    await card.getByRole('button', { name: `Lưu chỉ số phòng ${code}` }).click();
    await expect(page.getByText(`Đã lưu chỉ số phòng ${code}.`)).toBeVisible();
    await expect(card.getByText('Nhập dở')).toBeVisible();

    // Nước nhỏ hơn chỉ số cũ: báo ngay, không cho lưu
    await card.getByLabel(`Chỉ số mới nước phòng ${code}`).fill('80');
    await expect(card.getByText(/Nhỏ hơn chỉ số cũ/)).toBeVisible();
    await expect(card.getByRole('button', { name: `Lưu chỉ số phòng ${code}` })).toBeDisabled();
    await expect(page.getByTestId('sheet-progress')).toContainText(/Đã chốt \d+\/\d+ phòng/);

    if (!desktop) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test('thiết lập phòng có chỉ số ban đầu → nhận phòng điền sẵn chỉ số → chốt cả danh sách → link lập thông báo tháng sau', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Luồng nhập liệu dài: kiểm trên desktop.');
    const code = uniqueCode('DN');
    await loginAs(page, 'owner');
    await page.goto('/rooms');
    await page.getByRole('button', { name: 'Thêm phòng' }).click();
    const d = dialog(page);
    await d.getByLabel('Tòa').selectOption({ label: 'C — Tòa C — Ngõ Bình Yên' });
    await d.getByLabel('Mã phòng').fill(code);
    await d.getByLabel('Giá thuê mặc định / tháng').fill('2500000');
    await d.getByLabel('Chỉ số điện ban đầu (kWh)').fill('2000');
    await d.getByLabel('Chỉ số nước ban đầu (m³)').fill('300');
    await d.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(`Đã thêm phòng ${code}.`)).toBeVisible();

    await openRoom(page, code);
    await page.getByRole('link', { name: 'Nhận phòng' }).click();
    await finishWizard(page, { tenant: `Khách ${code}`, deposit: '', startDate: localDate(-1), prefilled: { elec: '2000', water: '300' } });

    await page.goto('/readings');
    const select = page.getByLabel('Tòa', { exact: true });
    await select.selectOption((await select.locator('option', { hasText: 'C —' }).getAttribute('value'))!);
    await page.getByLabel('Tháng tiêu thụ').fill(localDate(0).slice(0, 7));
    const card = page.getByTestId(`reading-room-${code}`);
    await expect(card.getByTestId(`rd-${code}-ELECTRICITY-previous`)).toHaveText('2000');
    await expect(card.getByTestId(`rd-${code}-WATER-previous`)).toHaveText('300');
    await card.getByLabel(`Chỉ số mới điện phòng ${code}`).fill('2045');
    await card.getByLabel(`Chỉ số mới nước phòng ${code}`).fill('304');
    await page.getByRole('button', { name: /^Lưu tất cả/ }).click();
    await expect(page.getByText('Đã lưu chỉ số cả danh sách.')).toBeVisible();
    await expect(card.getByText('Đã đủ')).toBeVisible();
    await expect(card.getByText('45 kWh')).toBeVisible();
    await expect(card.getByText('4 m³')).toBeVisible();
  });

  test('“Thay đổi giá” điện của tòa: giá mới áp dụng từ kỳ đọc tiếp theo, có lịch sử người đổi', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Đổi giá dữ liệu dùng chung một lần; giao diện điện thoại đã kiểm ở test nhập chỉ số.');
    await loginAs(page, 'owner');
    await page.goto('/buildings');
    await page.getByRole('link', { name: 'C', exact: true }).click();
    const elec = page.getByTestId('meter-price-ELECTRICITY');
    await expect(elec.getByText('3.300 ₫/kWh')).toBeVisible();
    await elec.getByRole('button', { name: 'Thay đổi giá' }).click();
    await dialog(page).getByLabel('Đơn giá mới (đ/kWh)').fill('3600');
    await dialog(page).getByLabel('Lý do').fill('Điện lực điều chỉnh giá');
    await dialog(page).getByRole('button', { name: 'Lưu giá' }).click();
    await expect(page.getByText(/Đã đặt giá điện 3\.600 ₫\/kWh từ kỳ \d{2}\/\d{4}\./)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Điện lực điều chỉnh giá' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Chủ trọ Demo/ }).first()).toBeVisible();
  });
});
