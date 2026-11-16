import { test, expect } from '@playwright/test';

test('signup rejects weak passwords and updates the accessible hint', async ({ page }) => {
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    await page.goto('/login.html');
    await page.locator('#signup').click();
    const password = page.locator('#password');
    await expect(password).toHaveAttribute('minlength', '8');
    for (const value of ['abc1234', 'abcdefgh', '12345678']) {
        await password.fill(value);
        expect(await password.evaluate(input => input.checkValidity())).toBe(false);
        await expect(page.locator('#password-policy-hint')).toContainText('8');
    }
    await password.fill('Strong-password1');
    expect(await password.evaluate(input => input.checkValidity())).toBe(true);
    await expect(page.locator('#password-policy-hint')).toContainText('Đã đáp ứng');
    await page.locator('#signin').click();
    await page.locator('#password1').fill('old123');
    expect(await page.locator('#password1').evaluate(input => input.checkValidity())).toBe(true);
});

test('reset form enforces the same policy without changing the existing PIN rules', async ({ page }) => {
    await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
    await page.goto('/forgot-password.html');
    // Firebase reset is hosted by Firebase; expose the local fields to inspect our form constraints.
    await page.locator('#local-recovery-fields').evaluate(element => { element.hidden = false; });
    const password = page.locator('#recovery-new-password');
    await password.fill('onlyletters');
    expect(await password.evaluate(input => input.checkValidity())).toBe(false);
    await password.fill('New-password1');
    expect(await password.evaluate(input => input.checkValidity())).toBe(true);
    await expect(page.locator('#recovery-password-hint')).toContainText('Đã đáp ứng');
});
