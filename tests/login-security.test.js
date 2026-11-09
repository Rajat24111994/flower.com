const test = require("node:test");
const assert = require("node:assert/strict");

test("đăng nhập thông báo rõ khi Firebase tạm giới hạn do thử quá nhiều lần", async () => {
    const { getFirebaseErrorMessage } = await import("../flower.com/js/account/login-errors.js");

    assert.match(
        getFirebaseErrorMessage({ code: "auth/too-many-requests" }),
        /tạm thời giới hạn đăng nhập.*đợi một lúc rồi thử lại/
    );
});

test("đăng nhập không tiết lộ lỗi Firebase không được nhận diện", async () => {
    const { getFirebaseErrorMessage } = await import("../flower.com/js/account/login-errors.js");

    assert.equal(
        getFirebaseErrorMessage({ code: "auth/unknown", message: "private provider detail" }),
        "Đăng nhập chưa thành công. Vui lòng thử lại."
    );
});
