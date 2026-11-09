import { test, expect } from "@playwright/test";
const products = [
  { id: "search-1", title: "Bó hồng đỏ", description: "Hoa hồng đỏ", price: 450000, soldCount: 7, colors: ["đỏ"], occasions: ["sinh nhật"] },
  { id: "search-2", title: "Bó hướng dương", description: "Hoa hướng dương vàng", price: 600000, soldCount: 12, colors: ["vàng"], occasions: ["tốt nghiệp", "khai trương"] },
  { id: "search-3", title: "Giỏ hồng vàng", description: "Hoa hồng vàng", price: 850000, soldCount: 3, colors: ["vàng"], occasions: ["khai trương"] },
  { id: "search-4", title: "Lan trắng", description: "Hoa lan hồ điệp", price: 1200000 }
].map((item) => ({ ...item, quantity: 5, image: "./images/products/product-flower-01.webp" }));
async function openFilters(page) {
  const summary = page.locator("#sidebar summary");
  if (await summary.count() && !await page.locator("#sidebar").evaluate((element) => element.open)) await summary.click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/review-store.js*", (route) => route.fulfill({ contentType: "text/javascript",
    body: "window.FlowerReviewStore = { subscribe: (_id, callback) => { callback([]); return () => {}; } };" }));
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const fixture = ${JSON.stringify(products)};
    window.FlowerInventory = { initialize: async () => fixture, readProducts: () => fixture,
      readCategories: () => [], getCategories: async () => [], subscribeCategories: () => () => {} };
  ` }));
});

test("search from details opens catalog; species and price preset restore from URL", async ({ page }) => {
  await page.goto("/product.html?id=search-1");
  await expect(page.locator("#product-detail")).toBeVisible();
  await page.locator("#search").fill("sunflower");
  await expect(page.locator("#product-detail")).toBeHidden();
  await expect(page.locator("#container .product-card h2")).toHaveText(["Bó hướng dương"]);
  await expect(page).not.toHaveURL(/id=/);
  await page.goto("/product.html?flower=rose&price=price-under-1500000&sort=asc-p");
  await openFilters(page);
  await expect(page.locator("#flower-type")).toHaveValue("rose");
  await expect(page.locator("#price-filter")).toHaveValue("price-under-1500000");
  await expect(page.locator("#container .product-card h2")).toHaveText(["Bó hồng đỏ", "Giỏ hồng vàng"]);
  await page.locator("#price-filter").selectOption("price-over-2000000");
  await expect(page.locator(".catalog-empty")).toBeVisible();
});

test("search, combined filters, sorting, URL restoration and empty state", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/product.html");
  await openFilters(page);
  const names = page.locator("#container .product-card h2");
  await expect(names).toHaveCount(4);
  await page.locator("#search").fill("do hong");
  await expect(names).toHaveText(["Bó hồng đỏ"]);
  await page.locator("#search").fill("rose");
  await expect(names).toHaveCount(2);
  await page.locator("#search").fill("");
  await page.locator("#flower-type").selectOption("rose");
  await expect(names).toHaveCount(2);
  await page.locator("#flower-type").selectOption("");
  await page.locator("#sort").selectOption("popular");
  await expect(names.first()).toHaveText("Bó hướng dương");
  await page.locator("#sort").selectOption("dsc-p");
  await expect(names.first()).toHaveText("Lan trắng");
  await page.locator("#price-min").fill("600000");
  await page.locator("#price-max").fill("850000");
  await page.locator("#color-filter").selectOption("vàng");
  await page.locator("#occasion-filter").selectOption("khai trương");
  await expect(names).toHaveText(["Giỏ hồng vàng", "Bó hướng dương"]);
  await page.locator("#search").press("Enter");
  await page.reload();
  await openFilters(page);
  await expect(page.locator("#price-min")).toHaveValue("600000");
  await expect(page.locator("#occasion-filter")).toHaveValue("khai trương");
  await expect(names).toHaveCount(2);
  await page.locator("#occasion-filter").selectOption("tốt nghiệp");
  await expect(names).toHaveText(["Bó hướng dương"]);
  await page.screenshot({ path: testInfo.outputPath("catalog-filtered.png"), fullPage: true });
  await page.locator("#color-filter").selectOption("đỏ");
  await expect(page.locator(".catalog-empty")).toContainText("Không tìm thấy sản phẩm");
  await expect(page.locator("#catalog-results-count")).toContainText("0 / 4");
  // The link reloads the page, and on a phone the new page starts with the filters folded:
  // wait for it before unfolding them, or the old (open) page is checked instead.
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("link", { name: "Xóa bộ lọc và tìm kiếm" }).click()
  ]);
  await openFilters(page);
  await expect(names).toHaveCount(4);
  await page.locator("#price-min").fill("900000");
  await page.locator("#price-max").fill("100000");
  await expect(page.locator("#price-range-error")).toContainText("không được lớn hơn");
  expect(errors).toEqual([]);
});
