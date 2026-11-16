import { test, expect } from "@playwright/test";

async function ownerPage(page, { unavailable = false, conflict = false } = {}) {
    const posts = [];
    const state = { settings: { enabled: false, revision: 0, rules: [] }, today: "2026-11-16",
        products: [{ id: "1", title: "Hoa hồng", receivedDate: "", basePrice: 250000, effectivePrice: 250000, quantity: 10 }] };
    await page.route("**/firebase-app.js", route => route.fulfill({ contentType: "text/javascript", body: "export const getApps=()=>[]; export const initializeApp=()=>({}); export const getApp=()=>({});" }));
    await page.route("**/firebase-auth.js", route => route.fulfill({ contentType: "text/javascript", body: `
        const user={uid:'owner-test',getIdToken:async()=> 'owner-token',getIdTokenResult:async()=>({claims:{admin:true,role:'owner'}})};
        export const getAuth=()=>({currentUser:user,authStateReady:async()=>{}}); export const signOut=async()=>{};` }));
    await page.route("**/api/owner/users", route => route.fulfill({ json: { users: [], nextPageToken: null } }));
    await page.route("**/api/wilting-prices", async route => {
        if (unavailable) { unavailable = false; await route.fulfill({ status: 503, json: { error: "Chưa tải được cấu hình" } }); return; }
        if (route.request().method() === "GET") { await route.fulfill({ json: state }); return; }
        const body = route.request().postDataJSON(); posts.push(body);
        if (conflict) { await route.fulfill({ status: 409, json: { error: "Cấu hình đã được thay đổi ở nơi khác. Hãy tải lại trước khi lưu." } }); return; }
        if (body.action === "save-rules") {
            state.settings = { enabled: body.enabled, rules: body.rules, revision: state.settings.revision + 1 };
            state.products[0].effectivePrice = body.enabled ? 225000 : 250000;
            await route.fulfill({ json: { settings: state.settings } });
        } else {
            state.products[0].receivedDate = body.receivedDate;
            await route.fulfill({ json: { productId: body.productId, receivedDate: body.receivedDate } });
        }
    });
    await page.goto("/owner.html");
    return { posts, state };
}

async function addRule(page, name = "Giá theo ngày") {
    await page.locator("#wilting-name").fill(name);
    await page.locator("#wilting-percent").fill("10");
    await page.locator("#wilting-floor").fill("10000");
    await page.getByRole("button", { name: "Thêm quy tắc vào bản nháp" }).click();
}

test("Owner stages explicit rules, saves them and updates received dates", async ({ page }) => {
    const { posts } = await ownerPage(page);
    await expect(page.locator("#wilting-status")).toContainText("đang tắt");
    await addRule(page, '<img src=x onerror="alert(1)">');
    await expect(page.locator("#wilting-rules")).toContainText("<img src=x");
    await expect(page.locator("#wilting-rules img")).toHaveCount(0);
    expect(posts).toHaveLength(0);
    await page.locator("#wilting-enabled").check();
    await page.locator("#wilting-save").click();
    await expect(page.locator("#wilting-status")).toHaveText("Đã lưu cấu hình giá héo.");
    expect(posts[0]).toMatchObject({ action: "save-rules", enabled: true, expectedRevision: 0,
        rules: [{ scope: "all", productIds: [], startAfterDays: 1, dailyDiscountPercent: 10, minPrice: 10000 }] });
    await expect(page.locator("#wilting-products")).toContainText("225.000");
    await page.locator("#wilting-received-0").fill("2026-11-15");
    await page.getByRole("button", { name: "Lưu ngày nhập", exact: true }).click();
    await expect(page.locator("#wilting-status")).toContainText("Đã lưu ngày nhập");
    expect(posts[1]).toEqual({ action: "set-received-date", productId: "1", receivedDate: "2026-11-15", expectedReceivedDate: "" });
});

test("Owner sees conflicts without losing the rule draft", async ({ page }) => {
    await ownerPage(page, { conflict: true });
    await expect(page.locator("#wilting-status")).toContainText("đang tắt");
    await addRule(page);
    await page.locator("#wilting-save").click();
    await expect(page.locator("#wilting-status")).toContainText("thay đổi ở nơi khác");
    await expect(page.locator("#wilting-rules")).toContainText("Giá theo ngày");
    await expect(page.locator("#wilting-save")).toBeEnabled();
});

test("Saving a received date preserves an unsaved rule draft and enabled choice", async ({ page }) => {
    const { posts } = await ownerPage(page);
    await expect(page.locator("#wilting-status")).toContainText("đang tắt");
    await addRule(page);
    await page.locator("#wilting-enabled").check();
    await page.locator("#wilting-received-0").fill("2026-11-15");
    await page.getByRole("button", { name: "Lưu ngày nhập", exact: true }).click();
    await expect(page.locator("#wilting-status")).toContainText("Bản nháp quy tắc vẫn chưa được lưu");
    await expect(page.locator("#wilting-rules")).toContainText("Giá theo ngày");
    await expect(page.locator("#wilting-enabled")).toBeChecked();
    expect(posts).toHaveLength(1);
    await page.locator("#wilting-save").click();
    await expect(page.locator("#wilting-status")).toHaveText("Đã lưu cấu hình giá héo.");
    expect(posts[1]).toMatchObject({ action: "save-rules", enabled: true, expectedRevision: 0 });
    expect(posts[1].rules).toHaveLength(1);
});

test("Owner cannot change unknown settings after a failed initial load and can retry", async ({ page }) => {
    const { posts } = await ownerPage(page, { unavailable: true });
    await expect(page.locator("#wilting-status")).toContainText("Chưa tải được");
    await expect(page.locator("#wilting-save")).toBeDisabled();
    expect(posts).toHaveLength(0);
    await page.locator("#wilting-retry").click();
    await expect(page.locator("#wilting-status")).toContainText("đang tắt");
    await expect(page.locator("#wilting-save")).toBeEnabled();
});
