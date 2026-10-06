import { expect, test } from '@playwright/test';
import { dialog, loginAs } from '../fixtures/session';
import { finishWizard, localDate, openRoom } from '../fixtures/tenancy';

test.describe('Phase 4 — điện nước theo tòa, nhập chỉ số', () => {
  test('nhập chỉ số mới: chỉ số trước tự điền, tạm tính ngay khi gõ, chặn số nhỏ hơn, dùng được ở 360px', async ({ page }, info) => {
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
    await page.getByLabel('Kỳ (tháng phát hành)').fill(localDate(0).slice(0, 7));

    const card = page.getByTestId(`reading-room-${code}`);
    await expect(card.getByTestId(`rd-${code}-ELECTRICITY-previous`)).toHaveText('1520');
    await card.getByLabel(`Chỉ số mới điện phòng ${code}`).fill('1600');
    await expect(card.getByText('80 kWh')).toBeVisible();
    await expect(card.getByText(price)).toBeVisible();
    await card.getByRole('button', { name: `Lưu chỉ số điện phòng ${code}` }).click();
    await expect(page.getByText(`Đã lưu chỉ số điện phòng ${code}.`)).toBeVisible();
    await expect(card.getByLabel('Đã nhập')).toBeVisible();

    // Nước nhỏ hơn chỉ số trước: báo ngay, không cho lưu
    await card.getByLabel(`Chỉ số mới nước phòng ${code}`).fill('80');
    await expect(card.getByText(/Nhỏ hơn chỉ số trước/)).toBeVisible();
    await expect(card.getByRole('button', { name: `Lưu chỉ số nước phòng ${code}` })).toBeDisabled();

    if (!desktop) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
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
