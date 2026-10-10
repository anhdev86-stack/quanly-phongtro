import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/session';

test.describe('Phase 8A — tổng quan và báo cáo', () => {
  test('tổng quan có phòng theo trạng thái, tiền và việc cần xử lý; báo cáo doanh thu tải được CSV', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tải file chỉ kiểm trên desktop.');
    await loginAs(page, 'owner');
    await expect(page.getByLabel('Phòng theo trạng thái')).toBeVisible();
    await expect(page.getByTestId('rooms-OCCUPIED')).not.toHaveText('');
    await expect(page.getByRole('heading', { name: 'Việc cần xử lý' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tiền' })).toBeVisible();

    await page.getByRole('link', { name: 'Báo cáo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Báo cáo', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Tổng tiền thông báo' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Giảm trừ' })).toHaveCount(0); // chi tiết ẩn mặc định
    await expect(page.getByText(/Số này chia thành hai phần/)).toBeVisible();
    await page.getByRole('button', { name: 'Xem chi tiết' }).click();
    await expect(page.getByRole('columnheader', { name: 'Doanh thu thuần' })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Xuất CSV' }).click()]);
    const text = readFileSync((await download.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Tháng,Tổng tiền thông báo,Giảm trừ,Doanh thu thuần');

    await page.getByRole('tab', { name: 'Cọc' }).click();
    await expect(page.getByText('Cọc đang giữ (nghĩa vụ phải trả)')).toBeVisible();
  });

  test('quản lý không thấy mục Báo cáo (mặc định); tổng quan chỉ trong tòa được giao', async ({ page }) => {
    await loginAs(page, 'managerA');
    await expect(page.getByRole('heading', { name: 'Việc cần xử lý' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Báo cáo' })).toHaveCount(0);
  });
});
