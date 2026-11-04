const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const siteRoot = path.join(__dirname, "..", "flower.com");
const siteUrl = "https://flower-com-six.vercel.app";
const htmlFiles = fs.readdirSync(siteRoot).filter((file) => file.endsWith(".html"));
const publicPages = new Set([
  "index.html",
  "product.html",
  "about.html",
  "contact.html",
  "delivery.html",
  "returns.html",
  "privacy.html",
  "terms.html",
  "ordering.html",
  "faq.html"
]);
const socialMetadataPages = new Set(["index.html", "product.html"]);
const productIds = require("../flower.com/flower.json").flower.map((product) => String(product.id));
const titles = new Set();
const descriptions = new Set();

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(siteRoot, file), "utf8");
  const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim();
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];

  assert.ok(title, `${file} must have a title`);
  assert.ok(description, `${file} must have a meta description`);
  assert.ok(!titles.has(title), `${file} must have a unique title`);
  assert.ok(!descriptions.has(description), `${file} must have a unique description`);
  titles.add(title);
  descriptions.add(description);
  assert.match(html, /rel="icon"[^>]+favicon\.svg/i, `${file} must declare the favicon`);
  assert.match(html, /href="\.\/css\/core\/accessibility\.css\?v=\d+"/i, `${file} must load shared keyboard focus styles`);

  if (publicPages.has(file)) {
    assert.match(html, /rel="canonical"/i, `${file} must have a canonical URL`);
    assert.doesNotMatch(html, /name="robots"\s+content="noindex/i, `${file} should remain public`);
  } else {
    assert.match(html, /name="robots"\s+content="noindex, nofollow"/i, `${file} must not be indexed`);
  }

  if (socialMetadataPages.has(file)) {
    assert.match(html, /property="og:title"/i, `${file} must have Open Graph metadata`);
    assert.match(html, /name="twitter:card"/i, `${file} must have Twitter card metadata`);
  }

  for (const imageTag of html.matchAll(/<img\b[^>]*>/gi)) {
    assert.match(imageTag[0], /\balt="/i, `${file} has an image without alt text`);
    assert.match(imageTag[0], /\bwidth="\d+"/i, `${file} has an image without a width`);
    assert.match(imageTag[0], /\bheight="\d+"/i, `${file} has an image without a height`);
  }

  for (const image of html.matchAll(/<img\b[^>]*src="\.\/images\/([^"]+)"/gi)) {
    assert.ok(
      fs.existsSync(path.join(siteRoot, "images", image[1])),
      `${file} references missing image ${image[1]}`
    );
  }

  for (const asset of html.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))(\?[^"]*)?"/gi)) {
    const assetPath = path.join(siteRoot, asset[1]);
    assert.ok(fs.existsSync(assetPath), `${file} references missing asset ${asset[1]}`);
    assert.match(asset[2] || "", /^\?v=\d+$/, `${file} must version cached asset ${asset[1]}`);
  }
}

const homePage = fs.readFileSync(path.join(siteRoot, "index.html"), "utf8");
assert.match(homePage, /fetchpriority="high"/i);
assert.match(homePage, /rel="preload"\s+as="image"/i);
assert.match(homePage, /"@type": "FlowerShop"/);
assert.match(homePage, /class="skip-link"\s+href="#main-content"/);
assert.match(homePage, /<main id="main-content">/);
const homeImages = [...homePage.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
assert.match(homeImages[0], /fetchpriority="high"/i, "the hero image should be prioritized");
assert.ok(homeImages.slice(1).every((image) => /loading="lazy"/i.test(image)), "below-the-fold homepage images should lazy-load");

const productPage = fs.readFileSync(path.join(siteRoot, "product.html"), "utf8");
const productScript = fs.readFileSync(path.join(siteRoot, "js/catalog/product.js"), "utf8");
const staticCatalogData = JSON.parse(productPage.match(/<script id="catalog-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1]);
assert.equal(staticCatalogData.itemListElement.length, productIds.length);
assert.deepEqual(
  new Set(staticCatalogData.itemListElement.map((item) => new URL(item.url).searchParams.get("id"))),
  new Set(productIds)
);
assert.match(productPage, /class="skip-link"\s+href="#main-content"/);
assert.match(productScript, /"@type": "ItemList"/);
assert.match(productScript, /"@type": "Product"/);
assert.match(productScript, /priceCurrency: "VND"/);
assert.match(productScript, /availability:/);
assert.match(productScript, /rel="canonical"/);

const robots = fs.readFileSync(path.join(siteRoot, "robots.txt"), "utf8");
assert.match(robots, /Sitemap:\s+https:\/\/flower-com-six\.vercel\.app\/sitemap\.xml/);
assert.match(robots, /Disallow: \/api\//);

const sitemap = fs.readFileSync(path.join(siteRoot, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const sitemapProductIds = sitemapUrls
  .filter((url) => url.includes("/product.html?id="))
  .map((url) => new URL(url).searchParams.get("id"));
assert.equal(sitemapUrls.length, productIds.length + publicPages.size);
assert.deepEqual(new Set(sitemapProductIds), new Set(productIds));
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length);
assert.deepEqual(
  new Set(sitemapUrls.filter((url) => !url.includes("/product.html?id="))),
  new Set([...publicPages].map((file) => file === "index.html" ? `${siteUrl}/` : `${siteUrl}/${file}`))
);

const vercelConfig = JSON.parse(fs.readFileSync(path.join(siteRoot, "vercel.json"), "utf8"));
const headerRules = vercelConfig.headers;
const globalHeaders = headerRules.find((rule) => rule.source === "/(.*)").headers;
const headersByName = new Map(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));
const csp = headersByName.get("content-security-policy");
for (const directive of [
  "default-src 'self'",
  "frame-ancestors 'none'",
  "script-src-attr 'none'",
  "https://www.gstatic.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://*.googleapis.com",
  "https://*.firebaseapp.com"
]) {
  assert.ok(csp.includes(directive), `CSP must include ${directive}`);
}
assert.equal(headersByName.get("x-content-type-options"), "nosniff");
assert.equal(headersByName.get("x-frame-options"), "DENY");
assert.match(headersByName.get("strict-transport-security"), /max-age=31536000/);
assert.ok(headerRules.some((rule) => rule.headers.some(
  (header) => header.key === "Cache-Control" && header.value.includes("immutable")
)));

for (const image of fs.readdirSync(path.join(siteRoot, "images"))) {
  assert.ok(fs.statSync(path.join(siteRoot, "images", image)).isFile());
}

assert.doesNotMatch(productPage, /sweetalert|cdn\.jsdelivr/i);
assert.doesNotMatch(productPage, /images\.unsplash\.com/i);
for (const file of ["cart.html", "product.html", "wish.html"]) {
  const html = fs.readFileSync(path.join(siteRoot, file), "utf8");
  assert.doesNotMatch(html, /sweetalert|cdn\.jsdelivr/i);
}
console.log("SEO and performance checks passed");
