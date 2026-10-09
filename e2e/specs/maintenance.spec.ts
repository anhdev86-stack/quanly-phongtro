import { expect, test } from '@playwright/test';
import { dialog, loginAs, uniqueCode } from '../fixtures/session';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('anh-voi-nuoc')]);

test.describe('Phase 13 — bảo trì và tệp riêng tư', () => {
  test('tạo yêu cầu bảo trì, đính kèm ảnh, mở ảnh qua link có kiểm tra quyền, đánh dấu xong', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Luồng nhập liệu: kiểm trên desktop; mobile kiểm hiển thị ở test sau.');
    await loginAs(page, 'managerA');
    await page.getByRole('link', { name: 'Bảo trì', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bảo trì', level: 1 })).toBeVisible();
    const title = `Vòi nước rò rỉ ${uniqueCode('M')}`;
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
    await dialog(page).getByLabel('Tòa').selectOption({ index: 1 });
    await dialog(page).getByLabel('Phòng').selectOption({ index: 1 });
    await dialog(page).getByLabel('Nội dung').fill(title);
    await dialog(page).getByLabel('Mức ưu tiên').selectOption('HIGH');
    await dialog(page).getByRole('button', { name: 'Tạo yêu cầu' }).click();
    await expect(page.getByText(/Đã tạo BT-\d{4}-\d{4}\./)).toBeVisible();

    await page.getByRole('button', { name: title }).click();
    await dialog(page).getByLabel('Chọn tệp tải lên').setInputFiles({ name: 'vòi nước.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Đã tải lên vòi nước.png.')).toBeVisible();
    const link = dialog(page).getByRole('link', { name: 'vòi nước.png' });
    await expect(link).toBeVisible();
    // Link tải kiểm tra quyền: đăng nhập thì 200 đúng nội dung, không phải ảnh công khai
    const href = await link.getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(Buffer.compare(await res.body(), PNG)).toBe(0);

    await dialog(page).getByRole('button', { name: 'Nhận xử lý' }).click();
    await expect(page.getByText('Đã nhận xử lý.')).toBeVisible();
    await dialog(page).getByLabel('Kết quả xử lý').fill('Thay ron vòi');
    await dialog(page).getByRole('button', { name: 'Đã sửa xong' }).click();
    await expect(page.getByText('Đã đánh dấu xong.')).toBeVisible();
    await expect(dialog(page).getByText('Đã xong')).toBeVisible();
  });

  test('quản lý tòa B, C chỉ chọn được phòng của tòa B, C khi tạo yêu cầu', async ({ page }) => {
    await loginAs(page, 'managerBC');
    await page.goto('/maintenance');
    await page.getByRole('button', { name: 'Tạo yêu cầu' }).click();
    const options = (await dialog(page).locator('#mc-building option').allTextContents()).slice(1).map((t) => t.slice(0, 1));
    expect(options.sort()).toEqual(['B', 'C']);
  });
});
