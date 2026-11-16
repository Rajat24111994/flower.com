// This separate action revokes all Firebase sessions. The existing signOut buttons stay browser-only.
export async function logoutAllFirebaseDevices(auth, signOut) {
    const user = auth?.currentUser;
    if (!user) throw new Error("Phiên Firebase đã kết thúc. Hãy đăng nhập lại để thu hồi các phiên khác.");
    let response;
    try {
        const token = await user.getIdToken();
        response = await fetch("/api/auth/logout-all", {
            method: "POST",
            credentials: "omit",
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: "{}"
        });
    } catch {
        throw new Error("Chưa xác nhận được việc thu hồi các phiên. Kiểm tra kết nối rồi thử lại.");
    }
    let result;
    try { result = await response.json(); } catch { /* A proxy/old host can return HTML. */ }
    if (!response.ok || result?.ok !== true || result?.scope !== "all") {
        throw new Error(response.status === 401
            ? "Phiên Firebase không còn hợp lệ. Hãy đăng nhập lại để thu hồi các phiên khác."
            : "Chưa thu hồi được các phiên Firebase. Vui lòng thử lại.");
    }
    try {
        await signOut(auth);
        window.FlowerSafeStorage.remove("loggedUser", { required: true });
        window.FlowerSafeStorage.remove("loggedAdmin", { required: true });
    } catch {
        throw new Error("Đã thu hồi các phiên Firebase, nhưng chưa xóa được phiên trên trình duyệt này. Hãy thử nút Đăng xuất.");
    }
    window.location.assign("./login.html");
}

export function bindLogoutAllDevices({ button, getSession, onError }) {
    if (!button) return;
    button.hidden = false;
    button.disabled = false;
    button.addEventListener("click", async () => {
        if (button.disabled) return;
        if (!window.confirm("Đăng xuất tài khoản Firebase trên mọi thiết bị? Các phiên cũ sẽ cần đăng nhập lại.")) return;
        button.disabled = true;
        try {
            const { auth, signOut } = await getSession();
            await logoutAllFirebaseDevices(auth, signOut);
        } catch (error) {
            // Never log SDK errors, ID tokens or provider responses.
            onError(error instanceof Error ? error.message : "Chưa thể đăng xuất mọi thiết bị. Vui lòng thử lại.");
            button.disabled = false;
        }
    });
}
