// Shared by browser forms and the local account server. Never changes existing passwords.
(function (root) {
    const message = 'Mật khẩu cần từ 8 đến 4096 ký tự, có chữ thường (a–z) và số (0–9).';
    function isStrongPassword(value) {
        return typeof value === 'string' && value.length >= 8 && value.length <= 4096
            && /[a-z]/.test(value) && /[0-9]/.test(value);
    }
    function bindPasswordHint(input, hint) {
        const update = () => {
            const valid = isStrongPassword(input.value);
            input.setCustomValidity(input.value && !valid ? message : '');
            hint.textContent = input.value && valid ? 'Đã đáp ứng yêu cầu tối thiểu. Nên dùng mật khẩu dài, riêng cho tài khoản này.' : message;
        };
        input.addEventListener('input', update);
        update();
    }
    const policy = { message, isStrongPassword, bindPasswordHint };
    if (typeof module !== 'undefined' && module.exports) module.exports = policy;
    else root.FlowerPasswordPolicy = policy;
})(globalThis);
