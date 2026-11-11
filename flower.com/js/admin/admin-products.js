import { registerAdminFunctions } from "./admin-state.js";
import { preparePhotos } from "../review/review-images.js?v=1";

function renderRestoreCatalogNotice() {
   let offlineNotice = "";
   if (FlowerInventory.isFirestoreReachable() === false) {
       offlineNotice = FlowerInventory.areProductsLoaded()
           ? `<div class="restore-catalog-notice" role="alert"><p><strong>Trình duyệt không kết nối trực tiếp được Firestore</strong> (mạng có thể đang chặn Firebase). Sản phẩm đang được đọc qua máy chủ; đơn hàng, ưu đãi và thao tác lưu trên trang này có thể chưa hoạt động. Hãy thử mạng khác (ví dụ 4G) nếu cần chỉnh sửa.</p></div>`
           : `<div class="restore-catalog-notice" role="alert"><p><strong>Không đọc được kho sản phẩm</strong> cả từ trình duyệt lẫn qua máy chủ. Hãy kiểm tra mạng rồi tải lại trang.</p></div>`;
   }
   const missingCount = FlowerInventory.getMissingCatalogProducts().length;
   if (!missingCount) return offlineNotice;
   return offlineNotice + `
       <div class="restore-catalog-notice" role="status">
           <p><strong>Có ${missingCount} sản phẩm mẫu chưa có trong kho Firestore.</strong>
           Thao tác này chỉ thêm sản phẩm còn thiếu; sản phẩm đang có và các chỉnh sửa của cửa hàng được giữ nguyên.</p>
           <button class="primary-btn" type="button" data-action="restore-catalog">Thêm ${missingCount} sản phẩm</button>
       </div>
   `;
}

function showAdminConfirmation({ title, message, confirmLabel, danger = false }) {
   const dialog = document.createElement("dialog");
   dialog.className = "admin-confirm-dialog";
   dialog.setAttribute("aria-labelledby", "admin-confirm-title");
   dialog.setAttribute("aria-describedby", "admin-confirm-message");

   const content = document.createElement("div");
   content.className = "admin-confirm-content";
   const icon = document.createElement("span");
   icon.className = `admin-confirm-icon${danger ? " admin-confirm-icon--danger" : ""}`;
   icon.setAttribute("aria-hidden", "true");
   icon.textContent = danger ? "!" : "↻";
   const heading = document.createElement("h2");
   heading.id = "admin-confirm-title";
   heading.textContent = title;
   const description = document.createElement("p");
   description.id = "admin-confirm-message";
   description.textContent = message;
   const actions = document.createElement("div");
   actions.className = "admin-confirm-actions";
   const cancelButton = document.createElement("button");
   cancelButton.className = "secondary-btn";
   cancelButton.type = "button";
   cancelButton.dataset.confirmCancel = "";
   cancelButton.textContent = "Không, quay lại";
   const confirmButton = document.createElement("button");
   confirmButton.className = danger ? "delete-record" : "primary-btn";
   confirmButton.type = "button";
   confirmButton.dataset.confirmAccept = "";
   confirmButton.textContent = confirmLabel;
   actions.append(cancelButton, confirmButton);
   content.append(icon, heading, description, actions);
   dialog.append(content);
   document.body.append(dialog);

   return new Promise((resolve) => {
       dialog.addEventListener("close", () => {
           dialog.remove();
           resolve(dialog.returnValue === "confirm");
       }, { once: true });
       cancelButton.addEventListener("click", () => dialog.close("cancel"), { once: true });
       confirmButton.addEventListener("click", () => dialog.close("confirm"), { once: true });
       dialog.showModal();
       cancelButton.focus();
   });
}

async function restoreCatalog() {
   const missingCount = FlowerInventory.getMissingCatalogProducts().length;
   if (!missingCount || !await showAdminConfirmation({
       title: "Thêm sản phẩm mẫu",
       message: `Sẽ thêm ${missingCount} sản phẩm đang thiếu vào Firestore. Sản phẩm hiện có và nội dung đã chỉnh sửa sẽ được giữ nguyên.`,
       confirmLabel: `Thêm ${missingCount} sản phẩm`
   })) return;
   try {
       const restored = await FlowerInventory.restoreCatalogProducts();
       alert(`Đã khôi phục ${restored} sản phẩm.`);
   } catch (error) {
       console.error("Không thể khôi phục sản phẩm:", error);
       alert(error.message || "Chưa thể khôi phục sản phẩm. Hãy thử lại sau.");
   }
   const heading = main.querySelector(".panel h2")?.textContent;
   if (heading === "Quản lý kho hoa") renderProductTab();
   else renderDashboard();
}

function renderProductTab() {
   const products = getProducts();
   const categories = getCategories();
   const searchTerm = productSearchTerm.trim().toLocaleLowerCase("vi");
   const filteredProducts = products.filter((item) =>
       `${item.title} ${item.description || ""} ${item.category || ""}`.toLocaleLowerCase("vi").includes(searchTerm)
       && (!productFilterCategory || item.category === productFilterCategory)
       && (productFilterMinPrice === "" || Number(item.price) >= productFilterMinPrice)
       && (productFilterMaxPrice === "" || Number(item.price) <= productFilterMaxPrice)
       && (!productFilterStatus
           || (productFilterStatus === "hidden" && item.status === "hidden")
           || (productFilterStatus === "out-of-stock" && item.status !== "hidden" && Number(item.quantity) <= 0)
           || (productFilterStatus === "low-stock" && item.status !== "hidden" && Number(item.quantity) > 0 && Number(item.quantity) <= 5)
           || (productFilterStatus === "active" && item.status !== "hidden" && Number(item.quantity) > 0))
   );
   if (productPriceSort) {
       const direction = productPriceSort === "price-desc" ? -1 : 1;
       filteredProducts.sort((left, right) => (Number(left.price) - Number(right.price)) * direction);
   }
   const lowStockProducts = products.filter((item) =>
       item.status !== "hidden" && Number(item.quantity) > 0 && Number(item.quantity) <= 5
   );
   const editingProduct = products.find((item) => String(item.id) === String(editingProductId));
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <div class="product-panel-heading">
                   <h2>Quản lý kho hoa</h2>
                   <button class="delete-record" type="button" data-action="delete-all-products" ${products.length ? "" : "disabled"}>Xóa tất cả sản phẩm (${products.length})</button>
               </div>
               ${renderRestoreCatalogNotice()}
               <form id="product-search-form" class="product-search" role="search">
                   <label class="product-filter-field" for="product-search"><span>Tìm sản phẩm</span>
                       <input id="product-search" name="search" type="search" placeholder="Tên, mô tả hoặc danh mục..." value="${escapeHtml(productSearchTerm)}">
                   </label>
                   <label class="product-filter-field" for="product-filter-category"><span>Danh mục</span>
                       <select id="product-filter-category" name="category">
                           <option value="">Tất cả danh mục</option>
                           ${categories.map((category) => `<option value="${escapeHtml(category)}" ${productFilterCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                       </select>
                   </label>
                   <label class="product-filter-field" for="product-filter-status"><span>Tình trạng</span>
                       <select id="product-filter-status" name="status">
                           <option value="" ${productFilterStatus === "" ? "selected" : ""}>Tất cả tình trạng</option>
                           <option value="active" ${productFilterStatus === "active" ? "selected" : ""}>Đang bán</option>
                           <option value="hidden" ${productFilterStatus === "hidden" ? "selected" : ""}>Tạm ẩn</option>
                           <option value="out-of-stock" ${productFilterStatus === "out-of-stock" ? "selected" : ""}>Hết hàng</option>
                           <option value="low-stock" ${productFilterStatus === "low-stock" ? "selected" : ""}>Sắp hết hàng (≤ 5)</option>
                       </select>
                   </label>
                   <label class="product-filter-field" for="product-filter-min-price"><span>Giá từ (VND)</span>
                       <input id="product-filter-min-price" name="minPrice" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(productFilterMinPrice)}">
                   </label>
                   <label class="product-filter-field" for="product-filter-max-price"><span>Giá đến (VND)</span>
                       <input id="product-filter-max-price" name="maxPrice" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(productFilterMaxPrice)}">
                   </label>
                   <label class="product-filter-field" for="product-filter-price-sort"><span>Sắp xếp theo giá</span>
                       <select id="product-filter-price-sort" name="priceSort">
                           <option value="" ${productPriceSort === "" ? "selected" : ""}>Mặc định</option>
                           <option value="price-asc" ${productPriceSort === "price-asc" ? "selected" : ""}>Giá tăng dần</option>
                           <option value="price-desc" ${productPriceSort === "price-desc" ? "selected" : ""}>Giá giảm dần</option>
                       </select>
                   </label>
                   <button type="submit" class="secondary-btn">Lọc sản phẩm</button>
                   ${productSearchTerm || productFilterCategory || productFilterStatus || productFilterMinPrice !== "" || productFilterMaxPrice !== "" || productPriceSort
                       ? '<button type="button" class="clear-search" data-action="clear-search">Xóa bộ lọc</button>' : ""}
               </form>
               <p id="product-search-message" class="product-search-message" role="alert" aria-live="assertive"></p>
               ${renderSharedProductImageNotice(products)}
               ${lowStockProducts.length ? `<p class="product-stock-alert" role="status"><strong>Cảnh báo tồn kho:</strong> ${lowStockProducts.length} sản phẩm đang bán chỉ còn từ 1–5 đơn vị.</p>` : ""}
               <div class="product-table-wrap">
               <table class="product-table">
                   <thead>
                       <tr>
                           <th>Ảnh</th>
                           <th>Tên sản phẩm</th>
                           <th>Loại bán</th>
                           <th>Phân loại</th>
                           <th>Giá</th>
                           <th>Số lượng</th>
                           <th>Trạng thái</th>
                           <th>Thao tác</th>
                       </tr>
                   </thead>
                   <tbody>
                       ${filteredProducts.map((item) => {
                           const quantity = Number(item.quantity) || 0;
                           const status = item.status === "hidden" ? "hidden" : quantity === 0 ? "out-of-stock" : "active";
                           const statusLabel = status === "hidden" ? "Tạm ẩn" : status === "out-of-stock" ? "Hết hàng" : "Đang bán";
                           const imageUrl = getSafeImageUrl(item.image);
                           const imageSource = String(item.image || "").trim();
                           const productTitle = item.title;
                           const imageMessage = imageUrl
                               ? ""
                               : imageSource
                                   ? `Đường dẫn ảnh không hợp lệ cho ${escapeHtml(productTitle)}: ${escapeHtml(imageSource)}`
                                   : `Chưa có ảnh: ${escapeHtml(productTitle)} (mã ${escapeHtml(item.id)})`;
                           return `
                               <tr>
                                   <td>
                                       <div class="product-image-thumb">
                                           <img class="product-admin-image" src="${escapeHtml(imageUrl || "")}" data-product-id="${escapeHtml(item.id)}" data-image-url="${escapeHtml(imageSource)}" alt="${escapeHtml(productTitle)}" width="64" height="64" loading="lazy" decoding="async" ${imageUrl ? "" : "hidden"}>
                                           <span class="product-image-thumb-error" ${imageUrl ? "hidden" : ""}>${imageMessage}</span>
                                       </div>
                                   </td>
                                   <td>
                                       <div><strong>${escapeHtml(item.title)}</strong></div>
                                       <small>${escapeHtml(item.description || "Mô tả chưa được cập nhật.")}</small>
                                   </td>
                                   <td>${item.saleType === "flower" ? "Hoa nguyên liệu" : "Bó làm sẵn"}</td>
                                   <td>${escapeHtml(item.category || "Chưa phân loại")}</td>
                                   <td>
                                       ${formatVnd(item.price)} / ${item.saleType === "flower" ? "cành" : "bó"}
                                       ${item.saleType === "flower" ? `<small>${item.priceUpdatedAt ? `Cập nhật ${escapeHtml(item.priceUpdatedAt)}` : "Giá được duy trì cho đến lần cập nhật tiếp theo"}</small>` : ""}
                                   </td>
                                   <td><input class="qty-input" data-id="${escapeHtml(item.id)}" type="number" min="0" step="1" value="${quantity}" aria-label="Tồn kho ${escapeHtml(item.title)} (${item.saleType === "flower" ? "cành" : "bó"})"></td>
                                   <td>
                                       <span class="product-state product-state--${status}">${statusLabel}</span>
                                       ${status === "active" && quantity <= 5 ? '<small class="product-low-stock">Sắp hết hàng</small>' : ""}
                                   </td>
                                   <td>
                                       <div class="product-row-actions">
                                           <button class="save-qty" data-id="${escapeHtml(item.id)}" type="button">Lưu tồn kho</button>
                                           <button class="secondary-btn edit-product" data-id="${escapeHtml(item.id)}" type="button">Sửa</button>
                                           <button class="secondary-btn" data-action="toggle-product-visibility" data-id="${escapeHtml(item.id)}" type="button">${item.status === "hidden" ? "Hiện bán lại" : "Tạm ẩn"}</button>
                                           <button class="delete-product" data-id="${escapeHtml(item.id)}" type="button">Xóa</button>
                                       </div>
                                   </td>
                               </tr>
                           `;
                       }).join("") || `<tr><td colspan="8" class="empty-state">${products.length ? "Không tìm thấy sản phẩm phù hợp." : "Chưa có sản phẩm nào. Hãy thêm hoa nguyên liệu hoặc bó làm sẵn."}</td></tr>`}
                   </tbody>
               </table>
               </div>
           </div>
           <div class="panel">
               <h2>${editingProduct ? "Chỉnh sửa sản phẩm" : "Thêm hoa mới"}</h2>
               <form id="add-product-form" class="product-form" novalidate>
                   <p id="product-form-message" class="product-form-message" role="alert" aria-live="assertive"></p>
                   <label class="product-form-field" for="product-title"><span>Tên sản phẩm</span>
                       <input type="text" id="product-title" value="${escapeHtml(editingProduct?.title || "")}" required maxlength="120" autocomplete="off">
                   </label>
                   <label class="product-form-field" for="product-image"><span>Ảnh đại diện</span>
                       <input type="text" inputmode="url" id="product-image" placeholder="Bấm Tải ảnh lên, hoặc dán link https://..." value="${escapeHtml(editingProduct?.image || "")}" required>
                   </label>
                   <div class="product-image-upload">
                       <input type="file" id="product-image-file" accept="image/jpeg,image/png,image/webp" hidden>
                       <button type="button" class="secondary-btn" id="product-image-upload">Chọn ảnh đại diện từ máy</button>
                       <small id="product-image-upload-status" role="status" aria-live="polite">JPG, PNG hoặc WebP, tối đa 5 MB. Ảnh được tự thu nhỏ trước khi lưu.</small>
                   </div>
                   <label class="field-label" for="product-images">Ảnh bổ sung (mỗi dòng một đường dẫn, tối đa 8 ảnh)</label>
                   <textarea id="product-images" rows="3" placeholder="https://...">${escapeHtml((editingProduct?.images || []).join("\n"))}</textarea>
                   <div class="product-image-upload">
                       <input type="file" id="product-images-file" accept="image/jpeg,image/png,image/webp" multiple hidden>
                       <button type="button" class="secondary-btn" id="product-images-upload">Chọn ảnh bổ sung từ máy</button>
                       <small id="product-images-upload-status" role="status" aria-live="polite">JPG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh; có thể chọn nhiều ảnh, tối đa 8 ảnh bổ sung.</small>
                   </div>
                   <div id="product-image-previews" class="product-image-previews" aria-live="polite"></div>
                   <label class="product-form-field" for="product-category"><span>Danh mục</span>
                       <select id="product-category" required>
                       <option value="" disabled ${editingProduct?.category || !editingProduct ? "selected" : ""}>Chọn danh mục</option>
                       <option value="${window.FlowerProductAdminValidation.UNCATEGORIZED}" ${editingProduct && !editingProduct.category ? "selected" : ""}>Chưa phân loại</option>
                       ${categories.map((category) => `<option value="${escapeHtml(category)}" ${editingProduct?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                       </select>
                   </label>
                   <label class="product-form-field" for="product-sale-type"><span>Hình thức bán</span>
                       <select id="product-sale-type">
                           <option value="ready_made" ${editingProduct?.saleType !== "flower" ? "selected" : ""}>Bó làm sẵn · giá cố định</option>
                           <option value="flower" ${editingProduct?.saleType === "flower" ? "selected" : ""}>Hoa nguyên liệu · giá bán theo cành</option>
                       </select>
                   </label>
                   <label class="product-form-field" for="product-price"><span>Giá bán (VND)</span>
                       <input type="number" id="product-price" value="${editingProduct ? escapeHtml(editingProduct.price) : ""}" min="1000" step="1" required inputmode="numeric" ${editingProduct?.saleType === "flower" ? "readonly" : ""}>
                       ${editingProduct?.saleType === "flower" ? '<small id="product-price-hint">Để ghi nhận lịch sử đầy đủ, hãy đổi giá trong mục “Quản lý giá hoa” (Owner).</small>' : ""}
                   </label>
                   <label class="product-form-field" for="product-quantity"><span>Số lượng tồn kho</span>
                       <input type="number" id="product-quantity" value="${editingProduct ? Number(editingProduct.quantity) || 0 : ""}" data-shown-value="${editingProduct ? Number(editingProduct.quantity) || 0 : ""}" min="0" step="1" required inputmode="numeric">
                   </label>
                   <label class="product-form-field" for="product-status"><span>Trạng thái bán</span>
                       <select id="product-status">
                           <option value="active" ${editingProduct?.status !== "hidden" ? "selected" : ""}>Đang bán</option>
                           <option value="hidden" ${editingProduct?.status === "hidden" ? "selected" : ""}>Tạm ẩn</option>
                       </select>
                   </label>
                   <label class="product-form-field" for="product-description"><span>Mô tả sản phẩm</span>
                       <textarea id="product-description" required maxlength="1000">${escapeHtml(editingProduct?.description || "")}</textarea>
                   </label>
                   <label class="product-form-field" for="product-meaning"><span>Ý nghĩa loài hoa <small>(không bắt buộc)</small></span>
                       <textarea id="product-meaning" maxlength="1000" placeholder="Để trống để dùng gợi ý theo loài hoa">${escapeHtml(editingProduct?.meaning || "")}</textarea>
                   </label>
                   <label class="product-form-field" for="product-colors"><span>Màu hoa <small>(ngăn bằng dấu phẩy)</small></span>
                       <input id="product-colors" maxlength="200" placeholder="đỏ, trắng" value="${escapeHtml((editingProduct?.colors || []).join(", "))}">
                   </label>
                   <label class="product-form-field" for="product-occasions"><span>Dịp tặng <small>(ngăn bằng dấu phẩy)</small></span>
                       <input id="product-occasions" maxlength="300" placeholder="sinh nhật, khai trương, tốt nghiệp" value="${escapeHtml((editingProduct?.occasions || []).join(", "))}">
                   </label>
                   <div class="product-form-actions">
                       <button type="submit" class="submit-btn">${editingProduct ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
                       ${editingProduct ? '<button type="button" class="secondary-btn" data-action="cancel-edit">Hủy</button>' : ""}
                   </div>
               </form>
           </div>
       </section>
   `;
   const form = document.getElementById("add-product-form");
   const searchForm = document.getElementById("product-search-form");
   searchForm.addEventListener("input", () => {
       document.getElementById("product-search-message").textContent = "";
   });
   form.addEventListener("input", (event) => {
       event.target.setCustomValidity("");
       event.target.setAttribute("aria-invalid", "false");
       document.getElementById("product-form-message").textContent = "";
       if (["product-image", "product-images"].includes(event.target.id)) renderProductImagePreviews();
   });
   renderProductImagePreviews();
   const imageFile = document.getElementById("product-image-file");
   document.getElementById("product-image-upload").addEventListener("click", () => imageFile.click());
   imageFile.addEventListener("change", () => {
       const [file] = imageFile.files;
       imageFile.value = "";
       if (file) void uploadProductImage(file);
   });
   const extraImagesFile = document.getElementById("product-images-file");
   document.getElementById("product-images-upload").addEventListener("click", () => extraImagesFile.click());
   extraImagesFile.addEventListener("change", () => {
       const files = Array.from(extraImagesFile.files || []);
       extraImagesFile.value = "";
       if (files.length) void uploadProductExtraImages(files);
   });
   main.querySelectorAll(".product-admin-image").forEach((image) => {
       if (image.hidden) return;
       image.addEventListener("error", () => {
           image.hidden = true;
           const productName = image.alt || "Sản phẩm";
           const imageUrl = image.dataset.imageUrl || "chưa có đường dẫn";
           image.nextElementSibling.textContent = `Không tải được ảnh cho ${productName} (mã ${image.dataset.productId || "không rõ"}): ${imageUrl}`;
           image.nextElementSibling.hidden = false;
       }, { once: true });
   });
}

function renderSharedProductImageNotice(products) {
   const imageGroups = new Map();
   products.forEach((product) => {
       const image = String(product.image || "").trim();
       if (!image) return;
       if (!imageGroups.has(image)) imageGroups.set(image, []);
       imageGroups.get(image).push(product);
   });
   const sharedGroups = [...imageGroups.entries()].filter(([, items]) => items.length > 1);
   if (!sharedGroups.length) return "";
   const sharedProductCount = sharedGroups.reduce((count, [, items]) => count + items.length, 0);
   return `
       <details class="product-image-audit">
           <summary>Kiểm tra ảnh dùng chung: ${sharedProductCount} sản phẩm · ${sharedGroups.length} đường dẫn ảnh</summary>
           <p>Catalog đang gán cùng một ảnh đại diện cho nhiều sản phẩm. Ảnh được giữ nguyên; hãy bổ sung ảnh gốc riêng nếu đây không phải chủ ý.</p>
           <ul>
               ${sharedGroups.map(([image, items]) => `
                   <li><code>${escapeHtml(image)}</code>
                       <ul>${items.map((item) => `<li>${escapeHtml(item.title)} (mã ${escapeHtml(item.id)})</li>`).join("")}</ul>
                   </li>
               `).join("")}
           </ul>
       </details>
   `;
}

// Shrinks the chosen photo in the browser, saves it through /api/product-images and adds its
// returned address to the selected product image field.
async function uploadProductImage(file, target = "primary") {
   const isPrimary = target === "primary";
   const input = document.getElementById(isPrimary ? "product-image" : "product-images");
   const button = document.getElementById(isPrimary ? "product-image-upload" : "product-images-upload");
   const status = document.getElementById(isPrimary ? "product-image-upload-status" : "product-images-upload-status");
   button.disabled = true;
   status.textContent = "Đang tải ảnh lên…";
   try {
       const [photo] = await preparePhotos([file]);
       if (!currentUser) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử tải ảnh.");
       const idToken = await currentUser.getIdToken();
       let response;
       try {
           response = await fetch("/api/product-images", {
               method: "POST",
               headers: { "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" },
               body: JSON.stringify({ photo })
           });
       } catch {
           throw new Error("Không kết nối được API tải ảnh. Nếu đang chạy bằng máy chủ tĩnh, hãy khởi động dự án bằng `vercel dev` hoặc dùng website đã triển khai.");
       }
       const responseText = await response.text();
       let data = {};
       try {
           data = JSON.parse(responseText);
       } catch {
           if (response.status === 404) {
               throw new Error("Không tìm thấy API tải ảnh. Máy chủ hiện tại có thể chỉ phục vụ tệp tĩnh; hãy chạy dự án bằng `vercel dev` hoặc dùng website đã triển khai.");
           }
       }
       if (!response.ok) {
           const message = data.error || (response.status === 503
               ? "API tải ảnh chưa sẵn sàng. Hãy kiểm tra cấu hình Firebase Admin trên Vercel."
               : `Tải ảnh thất bại (HTTP ${response.status}). Hãy kiểm tra quyền quản trị và thử lại.`);
           throw new Error(message);
       }
       if (!data.url) throw new Error("API tải ảnh không trả về đường dẫn ảnh hợp lệ.");
       if (!input.isConnected) return;
       if (isPrimary) {
           input.value = data.url;
       } else {
           const images = input.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
           if (images.length >= 8) {
               status.textContent = "Đã đủ 8 ảnh bổ sung; không thể thêm ảnh này.";
               return false;
           }
           images.push(data.url);
           input.value = images.join("\n");
       }
       input.dispatchEvent(new Event("input", { bubbles: true }));
       status.textContent = `Đã tải ảnh lên. Bấm lưu sản phẩm để dùng ảnh${isPrimary ? " này" : " bổ sung này"}.`;
       return true;
   } catch (error) {
       if (status.isConnected) status.textContent = error.message || "Chưa tải được ảnh. Hãy thử lại.";
       return false;
   } finally {
       if (button.isConnected) button.disabled = false;
   }
}

async function uploadProductExtraImages(files) {
   const input = document.getElementById("product-images");
   const status = document.getElementById("product-images-upload-status");
   const currentCount = input.value.split(/\r?\n/).filter((value) => value.trim()).length;
   const availableCount = 8 - currentCount;
   if (files.length > availableCount) {
       status.textContent = `Chỉ còn có thể thêm ${availableCount} ảnh bổ sung (tối đa 8 ảnh).`;
       return;
   }
   let uploadedCount = 0;
   for (const file of files) {
       if (!await uploadProductImage(file, "extra")) {
           if (uploadedCount) status.textContent = `Đã tải ${uploadedCount}/${files.length} ảnh; ảnh tiếp theo gặp lỗi: ${status.textContent}`;
           return;
       }
       uploadedCount += 1;
       status.textContent = `Đã tải ${uploadedCount}/${files.length} ảnh bổ sung. Bấm lưu sản phẩm để dùng ảnh.`;
   }
}

function renderProductImagePreviews() {
   const previewContainer = document.getElementById("product-image-previews");
   const primaryImage = document.getElementById("product-image");
   const extraImages = document.getElementById("product-images");
   if (!previewContainer || !primaryImage || !extraImages) return;
   previewContainer.replaceChildren();
   const entries = [
       { label: "Ảnh đại diện", value: primaryImage.value.trim() },
       ...extraImages.value.split(/\r?\n/).map((value, index) => ({ label: `Ảnh phụ ${index + 1}`, value: value.trim() }))
           .filter((entry) => entry.value)
   ].filter((entry) => entry.value);

   entries.forEach((entry) => {
       const card = document.createElement("div");
       card.className = "product-image-preview";
       const label = document.createElement("span");
       label.textContent = entry.label;
       const imageUrl = getSafeImageUrl(entry.value);
       if (imageUrl) {
           const image = document.createElement("img");
           image.src = imageUrl;
           image.alt = `Xem trước ${entry.label.toLocaleLowerCase("vi")}`;
           image.loading = "lazy";
           image.addEventListener("error", () => {
               image.hidden = true;
               card.classList.add("image-unavailable");
               label.textContent = `${entry.label} · Không tải được ảnh`;
           }, { once: true });
           card.append(image);
       } else {
           card.classList.add("image-unavailable");
           label.textContent = `${entry.label} · Đường dẫn không hợp lệ`;
       }
       card.append(label);
       previewContainer.append(card);
   });
   if (!entries.length) {
       const empty = document.createElement("small");
       empty.textContent = "Ảnh xem trước sẽ xuất hiện khi nhập URL.";
       previewContainer.append(empty);
   }
}

function getProductById(productId) {
   const products = getProducts();
   return products.find((product) => String(product.id) === String(productId));
}

async function saveAdminProducts(products) {
   try {
       await FlowerInventory.saveProducts(products);
       return true;
   } catch (error) {
       console.error("Could not synchronize product catalog:", error);
      const reason = error.code === "permission-denied"
          ? "Tài khoản không có quyền quản lý sản phẩm."
          : ["unavailable", "network-request-failed", "deadline-exceeded"].includes(error.code)
              ? "Mất kết nối Firestore. Dữ liệu chưa được lưu; hãy kiểm tra mạng rồi thử lại."
              : error.message || "Vui lòng kiểm tra kết nối và thử lại.";
      alert(`Không thể lưu thay đổi sản phẩm. ${reason}`);
      return false;
   }
}

function parseStockQuantity(value) {
   const text = String(value ?? "").trim();
   if (!/^\d+$/.test(text)) return null;
   const quantity = Number(text);
   return Number.isSafeInteger(quantity) ? quantity : null;
}

async function saveProductQuantity(id, value) {
   const quantity = parseStockQuantity(value);
   if (quantity === null) {
       alert("Số lượng phải là số nguyên từ 0 trở lên (ví dụ 0, 5, 12).");
       return;
   }
   const products = getProducts();
   const nextProducts = products.map((item) => {
       if (String(item.id) === String(id)) {
           return { ...item, quantity };
       }
       return item;
   });
    if (!await saveAdminProducts(nextProducts)) return;
   renderProductTab();
   alert("Đã lưu tồn kho.");
}

async function addNewProduct(event) {
   event.preventDefault();
   if (isSavingProductForm) return;
   const form = document.getElementById("add-product-form");
   const read = (id) => document.getElementById(id).value;
   const { product: inputProduct, errors } = window.FlowerProductAdminValidation.validateProductInput({
       title: read("product-title"),
       saleType: read("product-sale-type"),
       image: read("product-image"),
       images: read("product-images"),
       meaning: read("product-meaning"),
       colors: read("product-colors"),
       occasions: read("product-occasions"),
       category: read("product-category"),
       price: read("product-price"),
       quantity: read("product-quantity"),
       description: read("product-description"),
       status: read("product-status")
   }, getCategories());
   const fields = {
       title: "product-title",
       saleType: "product-sale-type",
       image: "product-image",
       images: "product-images",
       category: "product-category",
       price: "product-price",
       quantity: "product-quantity",
       description: "product-description",
       meaning: "product-meaning",
       colors: "product-colors",
       occasions: "product-occasions",
       status: "product-status"
   };
   Object.entries(fields).forEach(([key, id]) => {
       document.getElementById(id).setCustomValidity(errors[key] || "");
       document.getElementById(id).setAttribute("aria-invalid", String(Boolean(errors[key])));
   });
   if (!inputProduct) {
       const firstError = Object.keys(errors)[0];
       const field = document.getElementById(fields[firstError]);
       document.getElementById("product-form-message").textContent = errors[firstError];
       field.focus();
       return;
   }
   const productData = {
       ...inputProduct,
       image: getStoredImageUrl(inputProduct.image),
       images: inputProduct.images.map(getStoredImageUrl)
   };
   const products = getProducts();
   const duplicateImages = FlowerInventory.findDuplicateProductImages(
       products,
       [productData.image, ...productData.images],
       {
           baseUrl: window.location.href,
           excludeProductId: editingProductId
       }
   );
   if (duplicateImages.length) {
       const imageInput = document.getElementById("product-image");
       const message = "Hình ảnh này đã được sử dụng hoặc bị lặp trong sản phẩm. Hãy chọn đường dẫn ảnh khác.";
       imageInput.setCustomValidity(message);
       imageInput.setAttribute("aria-invalid", "true");
       document.getElementById("product-form-message").textContent = message;
       imageInput.focus();
       return;
   }
   const isEditing = editingProductId !== null;
   if (isEditing && !products.some((item) => String(item.id) === String(editingProductId))) {
       alert("Sản phẩm đã bị xóa ở nơi khác. Hãy tải lại danh sách.");
       return;
   }
   // Keep the live stock if the admin did not touch the quantity: orders may have changed it
   // since the form was opened.
   const quantityInput = document.getElementById("product-quantity");
   if (isEditing && quantityInput.value === quantityInput.dataset.shownValue) delete productData.quantity;
   const nextProducts = isEditing
       ? products.map((item) => String(item.id) === String(editingProductId) ? { ...item, ...productData } : item)
       : [...products, { id: crypto.randomUUID(), ...productData }];

   const submitButton = form.querySelector('button[type="submit"]');
   const originalButtonText = submitButton.textContent;
   isSavingProductForm = true;
   submitButton.disabled = true;
   submitButton.textContent = "Đang lưu...";
   try {
       if (!await saveAdminProducts(nextProducts)) return;
       editingProductId = null;
       alert(isEditing ? "Cập nhật sản phẩm thành công!" : "Thêm sản phẩm thành công!");
       renderProductTab();
   } finally {
       isSavingProductForm = false;
       if (form.isConnected) {
           submitButton.disabled = false;
           submitButton.textContent = originalButtonText;
       }
   }
}

async function deleteProduct(id) {
   const product = getProductById(id);
   if (!product || !window.confirm(`Bạn có chắc muốn xóa “${product.title}”?`)) return;

   const products = getProducts().filter((item) => String(item.id) !== String(id));
    if (!await saveAdminProducts(products)) return;
   if (String(editingProductId) === String(id)) editingProductId = null;
   renderProductTab();
}

async function deleteAllProducts() {
   const products = getProducts();
   if (!products.length) return;
   if (!await showAdminConfirmation({
       title: "Xóa toàn bộ sản phẩm?",
       message: `Bạn sắp xóa ${products.length} sản phẩm khỏi cửa hàng. Thao tác này không thể hoàn tác. Bạn có thể khôi phục lại những sản phẩm có trong danh mục gốc.`,
       confirmLabel: `Xóa ${products.length} sản phẩm`,
       danger: true
   })) return;
   if (!await saveAdminProducts([])) return;
   editingProductId = null;
   productSearchTerm = "";
   productFilterCategory = "";
   productFilterStatus = "";
   productFilterMinPrice = "";
   productFilterMaxPrice = "";
   productPriceSort = "";
   renderProductTab();
}

async function toggleProductVisibility(id) {
   const product = getProductById(id);
   if (!product) return;
   const status = product.status === "hidden" ? "active" : "hidden";
   const prompt = status === "hidden"
       ? `Tạm ẩn “${product.title}” khỏi cửa hàng khách hàng?`
       : `Hiện bán lại “${product.title}” trên cửa hàng?`;
   if (!window.confirm(prompt)) return;
   const products = getProducts().map((item) =>
       String(item.id) === String(id) ? { ...item, status } : item
   );
   if (!await saveAdminProducts(products)) return;
   renderProductTab();
}


registerAdminFunctions({ renderRestoreCatalogNotice, showAdminConfirmation, restoreCatalog, renderProductTab, renderSharedProductImageNotice, uploadProductImage, uploadProductExtraImages, renderProductImagePreviews, getProductById, saveAdminProducts, parseStockQuantity, saveProductQuantity, addNewProduct, deleteProduct, deleteAllProducts, toggleProductVisibility });
