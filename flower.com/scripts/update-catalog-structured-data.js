const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "product.html");
const products = require(path.join(root, "flower.json")).flower;
const catalogUrl = "https://flower-com-six.vercel.app/product.html";
const structuredData = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Danh sách hoa tươi Flowerflow",
  url: catalogUrl,
  itemListOrder: "https://schema.org/ItemListOrderAscending",
  numberOfItems: products.length,
  itemListElement: products.map((product, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: product.title || "Sản phẩm hoa",
    url: `${catalogUrl}?id=${encodeURIComponent(product.id)}`
  }))
};
const script = `<script id="catalog-structured-data" type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>`;
const html = fs.readFileSync(htmlPath, "utf8");
const scriptPattern = /<script\b(?=[^>]*\bid="catalog-structured-data")(?=[^>]*\btype="application\/ld\+json")[^>]*>[\s\S]*?<\/script\s*>/i;
const updated = scriptPattern.test(html)
  ? html.replace(scriptPattern, script)
  : html.replace("</head>", `  ${script}\n</head>`);

if (updated !== html) fs.writeFileSync(htmlPath, updated);
