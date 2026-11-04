import { firebaseConfig } from "./firebase-config.js";

const status = document.getElementById("owner-status");
const usersBody = document.getElementById("owner-users");
const refreshButton = document.getElementById("refresh-users");
const loadMoreButton = document.getElementById("load-more-users");
let authApi;
let currentUser;

async function initializeAuth() {
    const [appSdk, authSdk] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
    ]);
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    await auth.authStateReady();
    authApi = { auth, signOut: authSdk.signOut };
    currentUser = auth.currentUser;

    if (!currentUser) {
        window.location.replace("./login.html");
        return false;
    }

    const token = await currentUser.getIdTokenResult(true);
    if (token.claims.role !== "owner") {
        await authSdk.signOut(auth);
        localStorage.removeItem("loggedUser");
        localStorage.removeItem("loggedAdmin");
        window.location.replace("./login.html");
        return false;
    }
    return true;
}

async function callOwnerApi(payload) {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/owner/users", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch {
        const error = new Error(response.status === 404
            ? "Owner API is not available on this local static server."
            : "Owner API returned an invalid response.");
        error.code = "api-not-available";
        throw error;
    }
    if (!response.ok) {
        const error = new Error(data.error || "Không thể thực hiện thao tác.");
        error.code = data.code;
        throw error;
    }
    return data;
}

function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
}

function renderUser(user) {
    const row = document.createElement("tr");
    addCell(row, user.displayName || "Chưa có tên");
    addCell(row, user.email || "Chưa có email");
    addCell(row, user.uid);
    addCell(row, user.role === "owner" ? "Owner" : user.role === "admin" ? "Admin" : "Khách");
    addCell(row, user.disabled ? "Đã khóa" : "Đang hoạt động");

    const actionCell = document.createElement("td");
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = user.role === "admin" ? "delete-record owner-action" : "primary-btn owner-action";
    actionButton.textContent = user.role === "admin" ? "Gỡ admin" : "Cấp admin";
    actionButton.disabled = user.role === "owner" || user.uid === currentUser.uid ||
        (user.disabled && user.role !== "admin");
    if (user.role === "owner") actionButton.textContent = "Owner";
    actionButton.addEventListener("click", async () => {
        const grant = user.role !== "admin";
        const verb = grant ? "cấp quyền admin cho" : "gỡ quyền admin của";
        if (!window.confirm(`Bạn chắc chắn muốn ${verb} ${user.email || user.uid}?`)) return;

        actionButton.disabled = true;
        try {
            await callOwnerApi({
                action: grant ? "grant-admin" : "remove-admin",
                uid: user.uid
            });
            status.textContent = `Đã ${grant ? "cấp" : "gỡ"} quyền admin. Tài khoản đó cần đăng nhập lại.`;
            await loadUsers();
        } catch (error) {
            console.error("Không thể thay đổi quyền tài khoản:", error);
            status.textContent = error.code === "permission-denied"
                ? "Không đủ quyền thực hiện thao tác."
                : "Không thể cập nhật quyền. Kiểm tra kết nối rồi thử lại.";
            actionButton.disabled = false;
        }
    });
    actionCell.appendChild(actionButton);
    row.appendChild(actionCell);
    usersBody.appendChild(row);
}

async function loadUsers(pageToken) {
    status.textContent = "Đang tải danh sách tài khoản...";
    refreshButton.disabled = true;
    loadMoreButton.disabled = true;
    try {
        const result = await callOwnerApi({ action: "list", pageToken: pageToken || null });
        if (!pageToken) usersBody.replaceChildren();
        result.users.forEach(renderUser);
        if (result.nextPageToken) {
            loadMoreButton.dataset.pageToken = result.nextPageToken;
            loadMoreButton.hidden = false;
        } else {
            loadMoreButton.hidden = true;
        }
        status.textContent = usersBody.rows.length
            ? `Đang hiển thị ${usersBody.rows.length} tài khoản${result.nextPageToken ? " (có thể tải thêm)." : "."}`
            : "Chưa có tài khoản Firebase nào.";
    } catch (error) {
        console.error("Không thể tải danh sách tài khoản Owner:", error);
        status.textContent = error.code === "permission-denied"
            ? "Tài khoản hiện tại không có quyền Owner."
            : error.code === "api-not-available"
                ? "API quản lý Owner chưa được chạy ở bản local. Deploy lên Vercel hoặc chạy Vercel Dev để dùng chức năng này."
            : "Không tải được danh sách tài khoản. Kiểm tra cấu hình API và kết nối.";
    } finally {
        refreshButton.disabled = false;
        loadMoreButton.disabled = false;
    }
}

refreshButton.addEventListener("click", () => loadUsers());
loadMoreButton.addEventListener("click", () => loadUsers(loadMoreButton.dataset.pageToken));
document.getElementById("owner-logout").addEventListener("click", async () => {
    try {
        await authApi.signOut(authApi.auth);
        localStorage.removeItem("loggedUser");
        localStorage.removeItem("loggedAdmin");
        window.location.assign("./login.html");
    } catch (error) {
        console.error("Không thể đăng xuất Owner:", error);
        status.textContent = "Chưa thể đăng xuất. Vui lòng thử lại.";
    }
});

try {
    if (await initializeAuth()) {
        await loadUsers();
    }
} catch (error) {
    console.error("Không thể xác thực trang Owner:", error);
    status.textContent = "Không thể xác thực Owner. Hãy đăng nhập lại sau khi kiểm tra cấu hình Firebase.";
}
