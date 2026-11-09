export const isLocalAuth = typeof window !== "undefined"
    && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    && window.FlowerAuthMode !== "firebase";

export async function localAuthRequest(action, body) {
    let response;
    let result;
    try {
        response = await fetch(`/api/local-auth/${action}`, {
            method: action === "session" ? "GET" : "POST",
            credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        result = await response.json();
    } catch {
        throw new Error("Không kết nối được máy chủ tài khoản. Mở http://127.0.0.1:3000/login.html qua npm run dev.");
    }
    if (!response.ok) {
        const error = new Error(result.error || "Chưa xử lý được tài khoản. Vui lòng thử lại.");
        Object.assign(error, { code: result.code, retryAfter: result.retryAfter, attemptsRemaining: result.attemptsRemaining, status: response.status });
        throw error;
    }
    return result;
}

export function persistLocalAccount(account) {
    window.FlowerSafeStorage.writeJson("loggedUser", account, { required: true });
    window.FlowerSafeStorage.remove("loggedAdmin");
}
