const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const site = path.join(__dirname, "../flower.com");
const catalog = require("../flower.com/flower.json").flower;

test("catalog products use one existing, optimized local photo per product group", () => {
  const grouped = new Map();
  for (const product of catalog) {
    assert.match(product.image, /^\.\/images\/products\/product-flower-\d{2}\.webp$/);
    const imagePath = path.join(site, product.image.slice(2));
    assert.equal(fs.existsSync(imagePath), true, `${product.title} image is missing`);
    const bytes = fs.readFileSync(imagePath);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    const images = grouped.get(product.title) || new Set();
    images.add(product.image);
    grouped.set(product.title, images);
  }

  assert.equal(catalog.length, 30);
  assert.equal(new Set(catalog.map((product) => String(product.id))).size, catalog.length);
  assert.equal(grouped.size, catalog.length);
  assert.ok([...grouped.values()].every((images) => images.size === 1));
  assert.equal(new Set([...grouped.values()].map(([image]) => image)).size, catalog.length);
});

test("homepage and review-test images have local files and source credits", () => {
  const files = [
    "images/products/homepage-bouquet.webp",
    "images/products/homepage-story.webp",
    "images/start.jpeg",
  ];
  const credits = fs.readFileSync(path.join(__dirname, "../docs/product-image-credits.md"), "utf8");
  for (const file of files) {
    assert.equal(fs.existsSync(path.join(site, file)), true, `${file} is missing`);
    assert.ok(credits.includes(path.basename(file)), `${file} is missing from the credit list`);
  }
});
