import { registerAdminFunctions } from "./admin-state.js";

function renderOffersTab() {
   const offers = getOffers();
   const products = getProducts();
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <h2>Thêm ưu đãi</h2>
               <p class="category-help">Chọn sản phẩm và phần trăm giảm giá. Tiền giảm = giá × số lượng × phần trăm giảm. Mỗi đơn chỉ áp dụng một ưu đãi; trang thanh toán tự chọn ưu đãi giúp khách giảm được nhiều tiền nhất.</p>
               <form id="add-offer-form" class="offer-form">
                   <label>
                       <span class="field-label">Tên ưu đãi</span>
                       <input id="offer-name" name="name" type="text" maxlength="80" placeholder="Ví dụ: Ưu đãi mùa hè" required>
                   </label>
                   <label>
                       <span class="field-label">Phần trăm giảm (%)</span>
                       <input id="offer-percent" name="percent" type="number" min="0.01" max="100" step="0.01" placeholder="10" required>
                   </label>
                   <label>
                       <span class="field-label">Ngày bắt đầu (để trống nếu áp dụng ngay)</span>
                       <input name="startDate" type="date">
                   </label>
                   <label>
                       <span class="field-label">Ngày kết thúc (để trống nếu không giới hạn)</span>
                       <input name="endDate" type="date">
                   </label>
                   <fieldset class="offer-products">
                       <legend>Chọn sản phẩm áp dụng</legend>
                       <button class="secondary-btn offer-select-all" data-offer-select-all type="button" ${products.length ? "" : "disabled"}>Chọn tất cả hoa / bỏ chọn tất cả</button>
                       ${products.map((product) => `
                           <label class="offer-product-option">
                               <input type="checkbox" name="productIds" value="${escapeHtml(product.id)}">
                               <span>${escapeHtml(product.title)}</span>
                               <small>${formatVnd(product.price)}</small>
                           </label>
                       `).join("") || '<p class="empty-state">Chưa có sản phẩm để áp dụng ưu đãi.</p>'}
                   </fieldset>
                   <button class="submit-btn" type="submit" ${products.length ? "" : "disabled"}>Tạo ưu đãi</button>
               </form>
           </div>
           <div class="panel">
               <h2>Danh sách ưu đãi</h2>
               <div class="offer-list">
                   ${offers.map((offer) => {
                       const productCount = Array.isArray(offer.productIds) ? offer.productIds.length : 0;
                       return `
                           <article class="offer-row">
                               <div>
                                   <strong>${escapeHtml(offer.name)}</strong>
                                   <span>Giảm ${Number(offer.discountPercent)}% · ${productCount} sản phẩm</span>
                                   ${offer.startDate || offer.endDate ? `<span>Hiệu lực: ${offer.startDate ? escapeHtml(offer.startDate) : "không giới hạn"} – ${offer.endDate ? escapeHtml(offer.endDate) : "không giới hạn"}</span>` : ""}
                                   ${offer.allProducts === true ? '<span>Áp dụng cho tất cả hoa</span>' : ""}
                                   <span class="offer-status ${offer.active ? "is-active" : "is-inactive"}">${offer.active ? "Đang áp dụng" : "Đã tạm dừng"}</span>
                               </div>
                               <div class="product-row-actions">
                                   <button class="secondary-btn" data-offer-action="toggle" data-offer-id="${escapeHtml(offer.id)}" type="button">${offer.active ? "Tạm dừng" : "Kích hoạt"}</button>
                                   <button class="delete-product" data-offer-action="delete" data-offer-id="${escapeHtml(offer.id)}" type="button">Xóa</button>
                               </div>
                           </article>
                       `;
                   }).join("") || '<div class="empty-state">Chưa có ưu đãi nào.</div>'}
               </div>
           </div>
       </section>
   `;
}

async function addOffer(event) {
   event.preventDefault();
   const form = event.target;
   if (!(form instanceof HTMLFormElement)) {
       console.error("Không thể tạo ưu đãi: biểu mẫu không hợp lệ.");
       return;
   }
   const formData = new FormData(form);
   const name = String(formData.get("name") || "").trim();
   const discountPercent = Number(formData.get("percent"));
   const productIds = formData.getAll("productIds").map(String);
   const startDate = String(formData.get("startDate") || "");
   const endDate = String(formData.get("endDate") || "");

   if (!name || !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
       alert("Vui lòng nhập tên ưu đãi và phần trăm giảm lớn hơn 0%, tối đa 100%.");
       return;
   }
   if (!productIds.length) {
       alert("Vui lòng chọn ít nhất một sản phẩm áp dụng.");
       return;
   }
   const validDate = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value)
       && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
       && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
   if (!validDate(startDate) || !validDate(endDate) || (startDate && endDate && startDate > endDate)) {
       alert("Ngày bắt đầu/kết thúc không hợp lệ. Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
       return;
   }

   const allProductIds = new Set(getProducts().map((product) => String(product.id)));
   const selectedProductIds = new Set(productIds);
   const newOffer = {
       id: (window.crypto && typeof window.crypto.randomUUID === "function")
           ? window.crypto.randomUUID()
           : String(Date.now()),
       name,
       discountPercent,
       ...(startDate ? { startDate } : {}),
       ...(endDate ? { endDate } : {}),
       productIds,
       allProducts: allProductIds.size > 0
           && productIds.length === allProductIds.size
           && [...allProductIds].every((id) => selectedProductIds.has(id)),
       active: true,
       createdAt: new Date().toISOString()
   };
   try {
       await updateOffers((offers) => [...offers, newOffer]);
   } catch (error) {
       console.error("Không thể lưu ưu đãi dùng chung:", error);
       alert("Chưa thể lưu ưu đãi lên hệ thống. Hãy thử lại sau.");
       return;
   }
   renderOffersTab();
}

async function updateOffer(offerId, action) {
   const offers = getOffers();
   const offer = offers.find((item) => String(item.id) === String(offerId));
   if (!offer) return;

   if (action === "delete") {
       if (!window.confirm(`Xóa ưu đãi “${offer.name}”?`)) return;
       try {
           await updateOffers((latest) => latest.filter((item) => String(item.id) !== String(offerId)));
       } catch (error) {
           console.error("Không thể xóa ưu đãi dùng chung:", error);
           alert("Chưa thể cập nhật ưu đãi trên hệ thống. Hãy thử lại sau.");
           return;
       }
   } else {
       try {
           const active = !offer.active;
           await updateOffers((latest) => latest.map((item) => String(item.id) === String(offerId)
               ? { ...item, active }
               : item
           ));
       } catch (error) {
           console.error("Không thể cập nhật ưu đãi dùng chung:", error);
           alert("Chưa thể cập nhật ưu đãi trên hệ thống. Hãy thử lại sau.");
           return;
       }
   }
   renderOffersTab();
}


registerAdminFunctions({ renderOffersTab, addOffer, updateOffer });
