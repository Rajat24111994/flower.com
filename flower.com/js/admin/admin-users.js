import { registerAdminFunctions } from "./admin-state.js";

function renderUsersTab() {
   main.innerHTML = `
       <section class="panel">
           <div class="users-heading">
               <div>
                   <h2>Tài khoản Firebase</h2>
                   <p class="users-description">Thông tin tài khoản và phương thức đăng nhập. Danh sách Firebase không trả về mật khẩu.</p>
               </div>
               <button class="primary-btn" id="refresh-users" type="button">Tải lại</button>
           </div>
           <div class="table-wrap">
               <table class="users-table">
                   <thead>
                       <tr>
                           <th>Tên</th>
                           <th>Email</th>
                           <th>Phương thức</th>
                           <th>UID</th>
                           <th>Tạo tài khoản</th>
                           <th>Đăng nhập gần nhất</th>
                           <th>Trạng thái</th>
                       </tr>
                   </thead>
                   <tbody id="firebase-users"></tbody>
               </table>
           </div>
           <p class="users-status" id="users-status" role="status" aria-live="polite"></p>
           <button class="secondary-btn" id="load-more-users" type="button" hidden>Tải thêm</button>
       </section>
   `;
   loadFirebaseUsers();

   document.getElementById("refresh-users").addEventListener("click", () => loadFirebaseUsers());
   document.getElementById("load-more-users").addEventListener("click", (event) => {
       loadFirebaseUsers(event.currentTarget.dataset.pageToken);
   });
}

function renderFlowerPricesTab() {
   const rows = flowerPrices.map((flower) => {
       const isEditing = String(editingFlowerPriceId) === String(flower.flowerId);
       const image = getSafeImageUrl(flower.image);
       return `
           <tr>
               <td><code>${escapeHtml(flower.flowerId)}</code></td>
               <td>${image ? `<img src="${escapeHtml(image)}" alt="" width="56" height="56" loading="lazy">` : "—"}</td>
               <td>${escapeHtml(flower.name || "Hoa")}</td>
               <td>${escapeHtml(flower.unit || "cành")}</td>
               <td>${isEditing
                   ? `<input type="text" inputmode="numeric" pattern="[0-9]*" data-flower-price="${escapeHtml(flower.flowerId)}" value="${escapeHtml(flower.price)}" aria-label="Giá mới của ${escapeHtml(flower.name)}">`
                   : moneyFormat(flower.price)}</td>
               <td>${escapeHtml(flower.priceUpdatedAt ? formatUserDate(flower.priceUpdatedAt) : "Chưa ghi nhận")}</td>
               <td>${escapeHtml(flower.updatedBy || "Chưa ghi nhận")}</td>
               <td>
                   ${isEditing
                       ? `<button class="primary-btn" type="button" data-price-save="${escapeHtml(flower.flowerId)}">Lưu</button>
                          <button class="secondary-btn" type="button" data-price-cancel>Hủy</button>`
                       : `<button class="secondary-btn" type="button" data-price-edit="${escapeHtml(flower.flowerId)}">Sửa</button>
                          <button class="secondary-btn" type="button" data-price-history="${escapeHtml(flower.flowerId)}">Lịch sử giá</button>`}
               </td>
           </tr>`;
   }).join("");
   const historyFlower = flowerPriceHistory
       ? flowerPrices.find((flower) => String(flower.flowerId) === String(flowerPriceHistory.flowerId))
       : null;

   main.innerHTML = `
       <section class="panel-wrap flower-prices-page">
           <section class="panel">
               <div class="users-heading">
                   <div>
                       <h2>Quản lý giá hoa</h2>
                       <p class="users-description">Điều chỉnh giá bán theo cành. Giá đã lưu tiếp tục có hiệu lực cho đến lần cập nhật tiếp theo.</p>
                   </div>
                   <button class="secondary-btn" type="button" data-price-refresh ${flowerPricesLoading ? "disabled" : ""}>Tải lại</button>
               </div>
               <p class="users-status" role="status" aria-live="polite">${escapeHtml(flowerPricesMessage || (flowerPricesLoading ? "Đang tải giá hoa…" : ""))}</p>
               ${!flowerPricesLoaded && !flowerPricesLoading
                   ? '<p class="empty-state">Chưa tải được danh sách giá hoa. Hãy thử tải lại.</p>'
                   : `<div class="table-wrap">
                       <table class="users-table">
                           <thead><tr><th>Mã hoa</th><th>Ảnh</th><th>Tên hoa</th><th>Đơn vị</th><th>Giá bán hiện tại</th><th>Cập nhật gần nhất</th><th>Người cập nhật</th><th>Thao tác</th></tr></thead>
                           <tbody>${rows || `<tr><td colspan="8" class="empty-state">${flowerPricesLoading ? "Đang tải…" : "Chưa có hoa nguyên liệu trong danh mục."}</td></tr>`}</tbody>
                       </table>
                   </div>`}
           </section>
           ${flowerPriceHistory && historyFlower ? `
               <section class="panel">
                   <div class="users-heading">
                       <div><h2>Lịch sử giá · ${escapeHtml(historyFlower.name)}</h2><p class="users-description">Các lần thay đổi được sắp xếp từ mới nhất.</p></div>
                       <button class="secondary-btn" type="button" data-price-history-close>Đóng</button>
                   </div>
                   <div class="table-wrap">
                       <table class="users-table">
                           <thead><tr><th>Giá cũ</th><th>Giá mới</th><th>Thời điểm</th><th>Người cập nhật</th></tr></thead>
                           <tbody>${flowerPriceHistory.entries.length
                               ? flowerPriceHistory.entries.map((entry) => `<tr><td>${moneyFormat(entry.oldPrice)}</td><td>${moneyFormat(entry.newPrice)}</td><td>${escapeHtml(formatUserDate(entry.updatedAt))}</td><td>${escapeHtml(entry.updatedBy || "Không rõ")}</td></tr>`).join("")
                               : '<tr><td colspan="4" class="empty-state">Chưa có lần thay đổi giá nào được ghi nhận.</td></tr>'}</tbody>
                       </table>
                   </div>
               </section>
           ` : ""}
       </section>
   `;
}

async function requestFlowerPrices(url, options = {}) {
   if (!currentUser) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
   const idToken = await currentUser.getIdToken();
   const response = await fetch(url, {
       ...options,
       headers: {
           Authorization: `Bearer ${idToken}`,
           Accept: "application/json",
           ...(options.body ? { "Content-Type": "application/json" } : {}),
           ...options.headers
       },
       cache: "no-store"
   });
   const result = await response.json();
   if (!response.ok) {
       const error = new Error(result.error || "Không thể thực hiện thao tác quản lý giá.");
       error.code = result.code;
       throw error;
   }
   return result;
}

async function loadFlowerPrices() {
   flowerPricesLoading = true;
   flowerPricesMessage = "";
   renderFlowerPricesTab();
   try {
       const result = await requestFlowerPrices("/api/flower-prices");
       flowerPrices = result.flowers;
       flowerPricesLoaded = true;
   } catch (error) {
       console.error("Không thể tải danh sách giá hoa:", error);
       flowerPricesMessage = error.message || "Không thể tải giá hoa. Vui lòng thử lại.";
   } finally {
       flowerPricesLoading = false;
       if (main.querySelector(".flower-prices-page")) renderFlowerPricesTab();
   }
}

async function saveFlowerPrice(flowerId) {
   const input = main.querySelector(`[data-flower-price="${CSS.escape(flowerId)}"]`);
   const text = input?.value.trim() || "";
   if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1000 || Number(text) > 1_000_000_000) {
       flowerPricesMessage = "Giá bán phải là số nguyên từ 1.000 đến 1.000.000.000 VNĐ, không được để trống.";
       const status = main.querySelector(".users-status");
       if (status) status.textContent = flowerPricesMessage;
       input?.setAttribute("aria-invalid", "true");
       input?.focus();
       return;
   }

   const button = main.querySelector(`[data-price-save="${CSS.escape(flowerId)}"]`);
   if (button) button.disabled = true;
   flowerPricesMessage = "Đang lưu giá hoa…";
   const status = main.querySelector(".users-status");
   if (status) status.textContent = flowerPricesMessage;
   try {
       const result = await requestFlowerPrices("/api/flower-prices", {
           method: "PATCH",
           body: JSON.stringify({ flowerId, price: Number(text) })
       });
       flowerPrices = flowerPrices.map((flower) => String(flower.flowerId) === String(flowerId)
           ? result.flower
           : flower);
       editingFlowerPriceId = null;
       flowerPricesMessage = result.changed ? "Đã cập nhật giá bán hoa thành công." : "Giá bán không thay đổi; không tạo lịch sử mới.";
       renderFlowerPricesTab();
   } catch (error) {
       console.error("Không thể cập nhật giá hoa:", error);
       flowerPricesMessage = error.message || "Chưa thể lưu giá hoa. Giá cũ vẫn được giữ nguyên.";
       renderFlowerPricesTab();
   }
}

async function loadFlowerPriceHistory(flowerId) {
   flowerPricesMessage = "Đang tải lịch sử giá…";
   renderFlowerPricesTab();
   try {
       const result = await requestFlowerPrices(`/api/flower-prices?flowerId=${encodeURIComponent(flowerId)}`);
       flowerPriceHistory = { flowerId, entries: result.history };
       flowerPricesMessage = "";
   } catch (error) {
       console.error("Không thể tải lịch sử giá hoa:", error);
       flowerPriceHistory = null;
       flowerPricesMessage = error.message || "Chưa thể tải lịch sử giá.";
   }
   renderFlowerPricesTab();
}

function formatUserDate(value) {
   if (!value) return "Chưa có";
   const date = new Date(value);
   return Number.isNaN(date.getTime()) ? "Không xác định" : date.toLocaleString("vi-VN");
}

async function loadFirebaseUsers(pageToken) {
   const status = document.getElementById("users-status");
   const tbody = document.getElementById("firebase-users");
   const loadMore = document.getElementById("load-more-users");
   const refresh = document.getElementById("refresh-users");
   if (!status || !tbody || !loadMore || !refresh) return;

   status.textContent = "Đang tải danh sách tài khoản...";
   loadMore.hidden = true;
   refresh.disabled = true;
   try {
       const idToken = await currentUser.getIdToken();
       const httpResponse = await fetch("/api/admin/users", {
           method: "POST",
           headers: {
               "Authorization": `Bearer ${idToken}`,
               "Content-Type": "application/json"
           },
           body: JSON.stringify({
           pageToken: pageToken || null
           })
       });
       const data = await httpResponse.json();
       if (!httpResponse.ok) {
           const error = new Error(data.error || "Không thể tải danh sách tài khoản.");
           error.code = data.code;
           throw error;
       }
       const response = { data };
       if (!pageToken) tbody.replaceChildren();

       response.data.users.forEach((user) => {
           const row = document.createElement("tr");
           const providers = user.providers.length
               ? user.providers.map((provider) => provider === "google.com" ? "Google" :
                   provider === "password" ? "Email / mật khẩu" : provider).join(", ")
               : "Không xác định";
           [
               user.displayName || "Chưa có tên",
               user.email || "Chưa có email",
               providers,
               user.uid,
               formatUserDate(user.creationTime),
               formatUserDate(user.lastSignInTime),
               user.disabled ? "Đã khóa" : "Đang hoạt động"
           ].forEach((value) => {
               const cell = document.createElement("td");
               cell.textContent = value;
               row.appendChild(cell);
           });
           tbody.appendChild(row);
       });

       const nextPageToken = response.data.nextPageToken;
       if (nextPageToken) {
           loadMore.dataset.pageToken = nextPageToken;
           loadMore.hidden = false;
       }
       const totalShown = tbody.rows.length;
       status.textContent = totalShown
           ? `Đang hiển thị ${totalShown} tài khoản${nextPageToken ? " (có thể tải thêm)." : "."}`
           : "Chưa có tài khoản Firebase nào.";
   } catch (error) {
       console.error("Không thể tải danh sách tài khoản Firebase:", error);
       status.textContent = error.code === "permission-denied"
           ? "Tài khoản hiện tại không có quyền xem danh sách."
           : error.code === "admin-api-not-configured"
               ? "API chưa được cấu hình khóa dịch vụ trong Vercel. Xem docs/ADMIN-SETUP.md."
               : "Không tải được danh sách tài khoản. Kiểm tra kết nối rồi thử lại.";
   } finally {
       refresh.disabled = false;
   }
}


registerAdminFunctions({ renderUsersTab, renderFlowerPricesTab, requestFlowerPrices, loadFlowerPrices, saveFlowerPrice, loadFlowerPriceHistory, formatUserDate, loadFirebaseUsers });
