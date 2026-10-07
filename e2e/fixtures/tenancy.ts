import { expect, type Page } from '@playwright/test';

export async function openRoom(page: Page, code: string) {
  await page.goto('/rooms');
  await page.getByLabel('Tìm mã phòng / tên khách').fill(code);
  await page.getByTestId('room-grid').getByRole('link', { name: new RegExp(`^${code}`) }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Phòng ${code}`) })).toBeVisible();
}

/** Ngày theo giờ máy chạy test (cùng máy với trình duyệt), lệch `days` ngày. */
export function localDate(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Đi hết wizard nhận phòng từ bước 1; `contractEnd` có giá trị thì tạo hợp đồng đã ký tới ngày đó; `startDate` đổi ngày nhận phòng. */
export async function finishWizard(
  page: Page,
  opts: { tenant: string; deposit: string; contractEnd?: string; startDate?: string; /** Đồng hồ đã thiết lập: kiểm tra chỉ số điền sẵn, không gõ đè. */ prefilled?: { elec: string; water: string } },
) {
  if (opts.startDate) await page.locator('#mi-start').fill(opts.startDate);
  await page.getByRole('button', { name: 'Tiếp' }).click(); // → Người thuê
  await page.locator('#mi-p-full_name').fill(opts.tenant);
  await page.locator('#mi-p-phone').fill('0987654321');
  await page.getByRole('button', { name: 'Tiếp' }).click(); // → Hợp đồng
  if (opts.contractEnd) {
    await page.getByLabel('Tạo hợp đồng có thời hạn').check();
    await page.getByLabel('Đến hết ngày').fill(opts.contractEnd);
  }
  await page.getByRole('button', { name: 'Tiếp' }).click(); // → Dịch vụ & chỉ số
  await page.getByLabel('Internet').check();
  if (opts.prefilled) {
    await expect(page.getByLabel('Chỉ số điện')).toHaveValue(opts.prefilled.elec);
    await expect(page.getByLabel('Chỉ số nước')).toHaveValue(opts.prefilled.water);
  } else {
    await page.getByLabel('Chỉ số điện').fill('1520');
    await page.getByLabel('Chỉ số nước').fill('85');
  }
  await page.getByRole('button', { name: 'Tiếp' }).click(); // → Cọc
  if (opts.deposit) await page.getByLabel('Tiền cọc thực nhận hôm nay').fill(opts.deposit);
  await page.getByRole('button', { name: 'Tiếp' }).click(); // → Xem lại
  await expect(page.getByText(opts.tenant, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận nhận phòng' }).click();
  await expect(page.getByRole('heading', { name: /Lần thuê LT\d{4}-\d{4}/ })).toBeVisible();
}
