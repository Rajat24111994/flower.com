import { test, expect } from '@playwright/test';

test('cached catalog still opens when bundled JSON, API and Firebase are unavailable', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('flowerInventory', JSON.stringify([{
        id: 'offline-125', title: 'Offline cached rose', price: 100000, quantity: 4,
        image: './images/products/product-flower-01.webp', description: 'Cached inventory', status: 'active'
    }])));
    await page.route('**/flower.json*', route => route.abort());
    await page.route('**/api/products*', route => route.abort());
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    await page.goto('/product.html?id=offline-125');
    await expect(page.locator('#detail-name')).toHaveText('Offline cached rose');
    expect(await page.evaluate(() => window.FlowerInventory.readProducts()[0].quantity)).toBe(4);
    expect(errors).toEqual([]);
});
