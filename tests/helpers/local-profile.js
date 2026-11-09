module.exports = function localProfile(overrides = {}) {
    return { email: "ban@demo", password: "Mat-khau-thu-123", name: "Người thử", phone: "0900000000",
        pin: "938405", confirmPin: "938405", questions: [
            { question: "Tên con vật trong truyện tôi thích?", answer: "Cáo xanh" },
            { question: "Món ăn tôi tự nấu lần đầu?", answer: "Canh bí" },
            { question: "Tên nhân vật tôi từng tự vẽ?", answer: "Mây tím" }
        ], ...overrides };
};
