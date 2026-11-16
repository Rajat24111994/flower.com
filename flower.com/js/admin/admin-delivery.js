import { registerAdminFunctions } from "./admin-state.js";

function renderDeliveryZonesTab() {
   main.innerHTML = `
       <section class="panel-wrap delivery-zones-page">
           <div class="panel">
               <h2>Cấu hình khu vực giao hàng</h2>
               <p class="category-help">Chỉ thêm tỉnh/thành và quận/huyện mà cửa hàng xác nhận phục vụ. Phí được nhập theo VND; mặc định là 0 ₫ cho đến khi bạn chủ động cấu hình mức phí. Khu vực được lưu trên máy chủ và là nguồn tính phí khi báo giá, đặt đơn.</p>
               <p class="delivery-zone-admin-message" id="delivery-zone-admin-message" role="status" aria-live="polite">${deliveryZonesLoadError ? escapeHtml(deliveryZonesLoadError) : deliveryZonesLoaded ? "" : "Đang tải cấu hình…"}</p>
               <form id="add-delivery-zone-form" class="delivery-zone-form">
                   <label><span class="field-label">Tỉnh / thành phố</span><input name="province" type="text" maxlength="120" autocomplete="address-level1" placeholder="Tên tỉnh / thành đã xác nhận" required></label>
                   <label><span class="field-label">Quận / huyện</span><input name="district" type="text" maxlength="120" autocomplete="address-level2" placeholder="Tên quận / huyện đã xác nhận" required></label>
                   <label><span class="field-label">Phí giao hàng (₫)</span><input name="fee" type="number" min="0" max="1000000000" step="1" value="0" required></label>
                   <label class="delivery-zone-enabled"><input name="enabled" type="checkbox" checked><span>Cho phép đặt giao hàng</span></label>
                   <button class="submit-btn" type="submit">Thêm khu vực</button>
               </form>
           </div>
           <div class="panel">
               <h2>Khu vực đã khai báo</h2>
               ${deliveryZonesLoaded && !deliveryZonesLoadError ? `
                   <div class="delivery-zone-list">
                       ${deliveryZonesCache.map((zone) => `
                           <form class="delivery-zone-row" data-delivery-zone-row="${escapeHtml(zone.id)}">
                               <label><span class="field-label">Tỉnh / thành phố</span><input name="province" type="text" maxlength="120" value="${escapeHtml(zone.province)}" required></label>
                               <label><span class="field-label">Quận / huyện</span><input name="district" type="text" maxlength="120" value="${escapeHtml(zone.district)}" required></label>
                               <label><span class="field-label">Phí giao hàng (₫)</span><input name="fee" type="number" min="0" max="1000000000" step="1" value="${Number(zone.fee)}" required></label>
                               <label class="delivery-zone-enabled"><input name="enabled" type="checkbox" ${zone.enabled ? "checked" : ""}><span>${zone.enabled ? "Đang mở" : "Đang tạm dừng"}</span></label>
                               <div class="product-row-actions">
                                   <button class="secondary-btn" data-delivery-zone-save="${escapeHtml(zone.id)}" type="button">Lưu thay đổi</button>
                                   <button class="delete-product" data-delivery-zone-delete="${escapeHtml(zone.id)}" type="button">Xóa</button>
                               </div>
                           </form>
                       `).join("") || '<div class="empty-state">Chưa có khu vực nào. Thêm khu vực cửa hàng xác nhận phục vụ để khách có thể đặt hàng.</div>'}
                   </div>
               ` : `<div class="empty-state">${deliveryZonesLoadError ? escapeHtml(deliveryZonesLoadError) : "Đang tải cấu hình…"}</div>${deliveryZonesLoadError ? '<button class="secondary-btn" data-delivery-zone-reload type="button">Thử tải lại</button>' : ""}`}
           </div>
           <div class="panel">
               <h2>Phí gói bó hoa tùy chỉnh</h2>
               <p class="category-help">Nhập các mốc số cành tăng dần và phí theo VND. Mốc cuối bắt buộc là 50 cành; phí được tính một lần cho mỗi bó, dựa trên tổng số cành của bó.</p>
               <p class="delivery-zone-admin-message" id="bouquet-wrapping-admin-message" role="status" aria-live="polite">${escapeHtml(bouquetWrappingLoadError || (bouquetWrappingLoaded && !bouquetWrappingTiers.length ? "Chưa cấu hình phí; khách chưa thể đặt bó tùy chỉnh." : bouquetWrappingLoaded ? "" : "Đang tải cấu hình…"))}</p>
               ${bouquetWrappingLoaded && !bouquetWrappingLoadError ? `
                   <form id="bouquet-wrapping-form" class="delivery-zone-form">
                       <div id="bouquet-wrapping-tiers">
                           ${(bouquetWrappingTiers.length ? bouquetWrappingTiers : [{ maxStems: "", fee: "" }]).map((tier, index) => `
                               <div class="delivery-zone-row" data-wrapping-tier>
                                   <label><span class="field-label">Tối đa số cành</span><input name="maxStems" type="number" min="1" max="50" step="1" value="${escapeHtml(tier.maxStems)}" required></label>
                                   <label><span class="field-label">Phí gói (₫)</span><input name="fee" type="number" min="0" max="1000000000" step="1" value="${escapeHtml(tier.fee)}" required></label>
                                   <button class="delete-product" data-wrapping-tier-remove type="button" ${index === 0 ? "disabled" : ""}>Xóa bậc</button>
                               </div>
                           `).join("")}
                       </div>
                       <div class="product-row-actions">
                           <button class="secondary-btn" data-wrapping-tier-add type="button">Thêm bậc</button>
                           <button class="submit-btn" type="submit">Lưu phí bó hoa</button>
                       </div>
                   </form>
               ` : `<div class="empty-state">${escapeHtml(bouquetWrappingLoadError || "Đang tải cấu hình…")}</div>${bouquetWrappingLoadError ? '<button class="secondary-btn" data-wrapping-reload type="button">Thử tải lại</button>' : ""}`}
           </div>
       </section>
   `;
   if (!deliveryZonesLoaded && !deliveryZonesLoading && !deliveryZonesLoadError) void loadDeliveryZones();
   if (!bouquetWrappingLoaded && !bouquetWrappingLoading && !bouquetWrappingLoadError) void loadBouquetWrapping();
}

async function loadDeliveryZones() {
   deliveryZonesLoading = true;
   deliveryZonesLoadError = "";
   try {
       const result = await window.FlowerOrderStore.getDeliveryZones(true);
       deliveryZonesCache = Array.isArray(result.zones) ? result.zones : [];
       deliveryZonesLoaded = true;
   } catch (error) {
       console.error("Không thể tải cấu hình khu vực giao hàng:", error);
       deliveryZonesLoadError = error.message || "Không thể tải cấu hình khu vực giao hàng.";
       deliveryZonesLoaded = false;
   } finally {
       deliveryZonesLoading = false;
       if (main.querySelector(".delivery-zones-page")) renderDeliveryZonesTab();
   }
}

async function loadBouquetWrapping() {
   bouquetWrappingLoading = true;
   bouquetWrappingLoadError = "";
   try {
       const result = await window.FlowerOrderStore.getBouquetWrapping(true);
       bouquetWrappingTiers = Array.isArray(result.tiers) ? result.tiers : [];
       bouquetWrappingLoaded = true;
   } catch (error) {
       console.error("Không thể tải cấu hình phí bó hoa:", error);
       bouquetWrappingLoadError = error.message || "Không thể tải cấu hình phí bó hoa.";
       bouquetWrappingLoaded = false;
   } finally {
       bouquetWrappingLoading = false;
       if (main.querySelector(".delivery-zones-page")) renderDeliveryZonesTab();
   }
}

function renderDesignRequestsTab() {
   const statuses = ["Chờ tư vấn", "Chờ báo giá", "Chờ khách xác nhận", "Đang thực hiện", "Hoàn thành", "Đã hủy"];
   main.innerHTML = `
       <section class="panel-wrap design-requests-page">
           <div class="panel">
               <h2>Yêu cầu thiết kế riêng</h2>
               <p class="category-help">Khách nhận mã truy cập riêng để theo dõi. Kiểm tra nguyên liệu trước khi gửi báo giá; khách chỉ có thể chấp nhận hoặc từ chối khi trạng thái là “Chờ khách xác nhận”.</p>
               ${designRequestsLoadError ? `<p class="delivery-zone-admin-message" role="status">${escapeHtml(designRequestsLoadError)}</p><button class="secondary-btn" data-design-requests-reload type="button">Thử tải lại</button>` : ""}
               ${designRequestsLoading && !designRequestsLoaded ? '<p>Đang tải yêu cầu thiết kế…</p>' : ""}
               ${designRequestsLoaded && !designRequestsLoadError ? designRequestsCache.map((request) => `
                   <article class="design-request-admin-card">
                       <header>
                           <div><h3>Yêu cầu #${escapeHtml(request.id)} · ${escapeHtml(request.customerName)}</h3><p>${escapeHtml(request.phone)} · ${escapeHtml(request.createdAt ? new Date(request.createdAt).toLocaleString("vi-VN") : "")}</p></div>
                           <strong>${escapeHtml(request.status)}</strong>
                       </header>
                       <div class="design-request-admin-details">
                           <p><b>Giao:</b> ${escapeHtml(request.address)} · ${escapeHtml(request.deliveryDistrict || "")}, ${escapeHtml(request.deliveryProvince || "")} · ${escapeHtml(request.deliveryDate)} · ${escapeHtml(request.deliveryTime)}</p>
                           <p><b>Hoa:</b> ${(request.stems || []).map((item) => `${escapeHtml(item.title)} × ${Number(item.quantity) || 0} (${escapeHtml(item.color)} · ${item.role === "main" ? "hoa chính" : "hoa phụ"} · tồn lúc gửi ${Number(item.stock) || 0})`).join(", ") || "Khách chọn thiết kế bất ngờ theo ngân sách"}</p>
                           <p><b>Thiết kế:</b> ${escapeHtml([request.design?.arrangement, request.design?.size, request.design?.wrapStyle, request.design?.paperMaterial, request.design?.paperColor, request.design?.bowStyle, request.design?.bowColor, request.design?.theme, request.design?.style, request.design?.palette].filter(Boolean).join(" · "))}</p>
                           <p><b>Phụ kiện:</b> ${escapeHtml((request.design?.addons || []).join(", ") || "Không yêu cầu")} · <b>Ngân sách:</b> ${request.design?.budget ? moneyFormat(request.design.budget) : "Không giới hạn"}</p>
                           <p><b>Dự toán:</b> ${moneyFormat(request.estimatedTotal || 0)} · <b>Ghi chú:</b> ${escapeHtml(request.specialRequest || "Không có")}</p>
                           ${request.design?.excludedFlowers?.length ? `<p><b>Không dùng:</b> ${escapeHtml(request.design.excludedFlowers.join(", "))}</p>` : ""}
                           ${request.design?.dislikedFlowers?.length ? `<p><b>Không thích:</b> ${escapeHtml(request.design.dislikedFlowers.join(", "))}</p>` : ""}
                           ${request.deliveryNote ? `<p><b>Lời nhắn giao hàng:</b> ${escapeHtml(request.deliveryNote)}</p>` : ""}
                           ${request.referenceImage ? `<img class="design-request-reference-image" src="${escapeHtml(request.referenceImage)}" alt="Ảnh mẫu yêu cầu">` : ""}
                       </div>
                       <div class="design-request-admin-fields">
                           <label>Trạng thái<select data-design-status="${escapeHtml(request.id)}">${statuses.map((status) => `<option ${status === request.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
                           <label>Báo giá cuối (₫)<input data-design-total="${escapeHtml(request.id)}" type="number" min="0" max="1000000000" step="1" value="${Number(request.quotedTotal) || ""}"></label>
                           <label>Ghi chú / đề xuất thay hoa<textarea data-design-quote-note="${escapeHtml(request.id)}" maxlength="1000" rows="2">${escapeHtml(request.quoteNote || "")}</textarea></label>
                           <button class="secondary-btn" data-design-request-save="${escapeHtml(request.id)}" type="button">Lưu và gửi cập nhật</button>
                       </div>
                   </article>
               `).join("") : ""}
               ${designRequestsLoaded && !designRequestsLoadError && !designRequestsCache.length ? '<p class="empty-state">Chưa có yêu cầu thiết kế nào.</p>' : ""}
           </div>
       </section>
   `;
   if (!designRequestsLoaded && !designRequestsLoading && !designRequestsLoadError) void loadDesignRequests();
}

async function loadDesignRequests() {
   designRequestsLoading = true;
   designRequestsLoadError = "";
   try {
       const result = await window.FlowerOrderStore.getDesignRequests();
       designRequestsCache = Array.isArray(result.requests) ? result.requests : [];
       designRequestsLoaded = true;
   } catch (error) {
       console.error("Không thể tải yêu cầu thiết kế:", error);
       designRequestsLoadError = error.message || "Không thể tải yêu cầu thiết kế.";
   } finally {
       designRequestsLoading = false;
       if (main.querySelector(".design-requests-page")) renderDesignRequestsTab();
   }
}

async function saveDesignRequest(id) {
   const status = main.querySelector(`[data-design-status="${CSS.escape(id)}"]`);
   const total = main.querySelector(`[data-design-total="${CSS.escape(id)}"]`);
   const note = main.querySelector(`[data-design-quote-note="${CSS.escape(id)}"]`);
   if (!status || !total || !note) return;
   const quotedTotal = total.value === "" ? null : Number(total.value);
   if ((status.value === "Chờ khách xác nhận" && quotedTotal === null)
       || (quotedTotal !== null && (!Number.isSafeInteger(quotedTotal) || quotedTotal < 0 || quotedTotal > 1000000000))) {
       alert("Nhập báo giá cuối là số nguyên VND hợp lệ trước khi chờ khách xác nhận.");
       total.focus();
       return;
   }
   try {
       const result = await window.FlowerOrderStore.updateDesignRequest({
           id,
           status: status.value,
           quotedTotal,
           quoteNote: note.value.trim()
       });
       designRequestsCache = designRequestsCache.map((request) => request.id === id ? result.request : request);
       renderDesignRequestsTab();
   } catch (error) {
       console.error("Không thể cập nhật yêu cầu thiết kế:", error);
       alert(error.message || "Chưa thể cập nhật yêu cầu thiết kế.");
   }
}

async function saveBouquetWrapping(event) {
   event.preventDefault();
   const rows = [...main.querySelectorAll("[data-wrapping-tier]")];
   const tiers = rows.map((row) => ({
       maxStems: Number(row.querySelector('[name="maxStems"]').value),
       fee: Number(row.querySelector('[name="fee"]').value)
   }));
   const normalized = window.FlowerBouquetWrapping?.normalizeTiers(tiers);
   if (!normalized) {
       const status = document.getElementById("bouquet-wrapping-admin-message");
       if (status) status.textContent = "Các mốc phải tăng dần từ 1 đến 50 cành; mốc cuối phải là 50 và phí là số nguyên VND không âm.";
       return;
   }
   try {
       const result = await window.FlowerOrderStore.saveBouquetWrapping(normalized);
       bouquetWrappingTiers = result.tiers;
       bouquetWrappingLoaded = true;
       bouquetWrappingLoadError = "";
       renderDeliveryZonesTab();
   } catch (error) {
       console.error("Không thể lưu cấu hình phí bó hoa:", error);
       const status = document.getElementById("bouquet-wrapping-admin-message");
       if (status) status.textContent = error.message || "Chưa thể lưu phí bó hoa. Vui lòng thử lại.";
   }
}

function createDeliveryZoneId() {
   return window.crypto?.randomUUID
       ? window.crypto.randomUUID()
       : `zone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function addDeliveryZone(event) {
   event.preventDefault();
   const data = new FormData(event.currentTarget);
   const zone = {
       id: createDeliveryZoneId(),
       province: String(data.get("province") || "").trim(),
       district: String(data.get("district") || "").trim(),
       fee: Number(data.get("fee")),
       enabled: data.get("enabled") === "on"
   };
   if (!zone.province || !zone.district || !Number.isSafeInteger(zone.fee) || zone.fee < 0) return;
   try {
       const result = await window.FlowerOrderStore.saveDeliveryZone(zone);
       deliveryZonesCache = result.zones;
       deliveryZonesLoaded = true;
       deliveryZonesLoadError = "";
       renderDeliveryZonesTab();
   } catch (error) {
       console.error("Không thể thêm khu vực giao hàng:", error);
       const status = document.getElementById("delivery-zone-admin-message");
       if (status) status.textContent = error.message || "Chưa thể lưu khu vực. Kiểm tra dữ liệu rồi thử lại.";
   }
}

async function saveDeliveryZoneRow(id) {
   const form = [...main.querySelectorAll("[data-delivery-zone-row]")]
       .find((item) => item.dataset.deliveryZoneRow === id);
   if (!form) return;
   const data = new FormData(form);
   const zone = {
       id,
       province: String(data.get("province") || "").trim(),
       district: String(data.get("district") || "").trim(),
       fee: Number(data.get("fee")),
       enabled: data.get("enabled") === "on"
   };
   if (!zone.province || !zone.district || !Number.isSafeInteger(zone.fee) || zone.fee < 0) {
       document.getElementById("delivery-zone-admin-message").textContent = "Nhập tỉnh/thành, quận/huyện và phí giao hàng là số nguyên không âm.";
       return;
   }
   try {
       const result = await window.FlowerOrderStore.saveDeliveryZone(zone);
       deliveryZonesCache = result.zones;
       deliveryZonesLoaded = true;
       renderDeliveryZonesTab();
   } catch (error) {
       console.error("Không thể cập nhật khu vực giao hàng:", error);
       document.getElementById("delivery-zone-admin-message").textContent = error.message || "Chưa thể lưu thay đổi khu vực.";
   }
}

async function removeDeliveryZone(id) {
   const zone = deliveryZonesCache.find((item) => item.id === id);
   if (!zone || !window.confirm(`Xóa khu vực ${zone.district}, ${zone.province}?`)) return;
   try {
       const result = await window.FlowerOrderStore.deleteDeliveryZone(id);
       deliveryZonesCache = result.zones;
       renderDeliveryZonesTab();
   } catch (error) {
       console.error("Không thể xóa khu vực giao hàng:", error);
       document.getElementById("delivery-zone-admin-message").textContent = error.message || "Chưa thể xóa khu vực.";
   }
}


registerAdminFunctions({ renderDeliveryZonesTab, loadDeliveryZones, loadBouquetWrapping, renderDesignRequestsTab, loadDesignRequests, saveDesignRequest, saveBouquetWrapping, createDeliveryZoneId, addDeliveryZone, saveDeliveryZoneRow, removeDeliveryZone });
