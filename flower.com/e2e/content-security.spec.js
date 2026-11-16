import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
for (const file of readdirSync(root).filter(file => file.endsWith('.html'))) {
  test(`${file} loads without CSP violations`, async ({ page }) => {
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => {
        window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
    });
    // Offline smoke: Firebase failures are handled by each page, without contacting production.
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    const response = await page.goto(`/${file}`);
    expect(response.headers()['content-security-policy']).not.toContain("'unsafe-inline'");
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  });
}

test('CSP blocks injected inline code/styles and unapproved image origins', async ({ page }) => {
  await page.goto('/about.html');
  const result = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
    const script = document.createElement('script');
    script.textContent = 'window.injectedScriptRan = true';
    document.body.append(script);
    const style = document.createElement('style');
    style.textContent = 'body { --injected-style: yes; }';
    document.head.append(style);
    const image = new Image();
    await new Promise(resolve => {
      image.onload = image.onerror = resolve;
      image.src = 'https://unapproved.example.test/tracker.png';
      document.body.append(image);
    });
    return { violations, scriptRan: Boolean(window.injectedScriptRan),
      styleApplied: getComputedStyle(document.body).getPropertyValue('--injected-style').trim() };
  });
  expect(result.scriptRan).toBe(false);
  expect(result.styleApplied).toBe('');
  expect(result.violations).toEqual(expect.arrayContaining(['script-src-elem', 'style-src-elem', 'img-src']));
});

test('CSP permits QR, Firebase Storage and Google avatar images', async ({ page }) => {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX0AAAAASUVORK5CYII=', 'base64');
  const urls = ['https://img.vietqr.io/image/test.png', 'https://firebasestorage.googleapis.com/v0/b/test/o/photo.png',
    'https://storage.googleapis.com/test/photo.png', 'https://lh3.googleusercontent.com/photo.png'];
  for (const url of urls) await page.route(url, route => route.fulfill({ contentType: 'image/png', body: pixel }));
  await page.goto('/about.html');
  for (const url of urls) {
    expect(await page.evaluate(src => new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
      document.body.append(image);
    }), url), url).toBe(true);
  }
});

test('storage failure notice remains visible without inline style allowances', async ({ page }) => {
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.effectiveDirective));
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/about.html');
  await page.evaluate(() => window.FlowerSafeStorage.writeJson('cart', []));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCSS('position', 'fixed');
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
});
