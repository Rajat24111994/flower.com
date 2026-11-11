const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function functionSource(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`\nfunction ${nextName}(`, start);
    assert.notEqual(start, -1, `${name} exists`);
    assert.notEqual(end, -1, `${nextName} exists`);
    return source.slice(start, end);
}

test("nội dung đánh giá và tin nhắn được escape trước khi render ở trang quản trị", () => {
    const orderSource = fs.readFileSync(path.join(__dirname, "../flower.com/js/admin/admin-orders.js"), "utf8");
    const reviewSource = fs.readFileSync(path.join(__dirname, "../flower.com/js/admin/admin-reviews.js"), "utf8");
    const escapeHtml = functionSource(orderSource, "escapeHtml", "getSafeImageUrl");
    const reviewCard = functionSource(reviewSource, "renderReviewCard", "renderActiveReviewSummary");
    const messageCard = functionSource(reviewSource, "renderMessageCard", "renderCompletedMessageSummary");
    const payload = '<img data-xss src=x onerror="alert(1)">';
    const context = vm.createContext({
        review: {
            id: `review-${payload}`, customerName: payload, phone: "", createdAt: "2026-01-01",
            productName: payload, rating: 5, comment: payload, moderationStatus: "pending",
            moderationReason: payload, reply: payload
        },
        message: {
            id: `message-${payload}`, customerName: payload, phone: "", createdAt: "2026-01-01",
            subject: payload, message: payload, reply: payload
        }
    });
    vm.runInContext([
        escapeHtml,
        "function renderCompletionAction() { return ''; }",
        reviewCard,
        messageCard,
        "this.renderedReview = renderReviewCard(review); this.renderedMessage = renderMessageCard(message);"
    ].join("\n"), context);

    for (const html of [context.renderedReview, context.renderedMessage]) {
        assert.ok(html.includes("&lt;img data-xss src=x onerror=&quot;alert(1)&quot;&gt;"));
        assert.equal(html.includes(payload), false);
        assert.equal(html.includes("<img data-xss"), false);
    }
});
