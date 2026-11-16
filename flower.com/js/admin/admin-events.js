import { registerAdminFunctions } from "./admin-state.js";

function bindAdminEvents(authApi) {
const dashboardPage = document.getElementById("dashboard_page");
if (dashboardPage) {
   dashboardPage.addEventListener("click", renderDashboard);
   dashboardPage.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") { event.preventDefault(); renderDashboard(); }
   });
}
if (productPage) {
   productPage.addEventListener("click", renderProductTab);
}
main.addEventListener("change", (event) => {
   if (event.target?.id !== "product-sale-type") return;
   const priceInput = document.getElementById("product-price");
   if (!priceInput || editingProductId === null) return;
   const originalProduct = getProducts().find((item) => String(item.id) === String(editingProductId));
   const locked = originalProduct?.saleType === "flower" || event.target.value === "flower";
   priceInput.readOnly = locked;
   const hint = document.getElementById("product-price-hint");
   if (locked && !hint) {
       const message = document.createElement("small");
       message.id = "product-price-hint";
       message.textContent = "Để ghi nhận lịch sử đầy đủ, hãy đổi giá trong mục “Quản lý giá hoa” (Owner).";
       priceInput.insertAdjacentElement("afterend", message);
   } else if (!locked) {
       hint?.remove();
   }
});

if (categoriesPage) {
   categoriesPage.addEventListener("click", renderCategoriesTab);
}

if (offersPage) {
   offersPage.addEventListener("click", renderOffersTab);
}

if (deliveryPage) {
   deliveryPage.addEventListener("click", renderDeliveryZonesTab);
   deliveryPage.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") {
           event.preventDefault();
           renderDeliveryZonesTab();
       }
   });
}

if (ordersPage) {
   ordersPage.addEventListener("click", renderOrdersTab);
}

if (designRequestsPage) {
   designRequestsPage.addEventListener("click", renderDesignRequestsTab);
   designRequestsPage.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") {
           event.preventDefault();
           renderDesignRequestsTab();
       }
   });
}

if (reviewsPage) {
   reviewsPage.addEventListener("click", renderReviewsTab);
}

if (messagesPage) {
   messagesPage.addEventListener("click", renderMessagesTab);
}

if (revenuePage) {
   revenuePage.addEventListener("click", renderRevenueTab);
}

if (usersPage) {
   usersPage.addEventListener("click", renderUsersTab);
}

if (logOutPage) {
   logOutPage.addEventListener("click", async () => {
       try {
           await authApi.signOut(authApi.auth);
           window.FlowerSafeStorage.remove("loggedUser", { required: true });
           window.FlowerSafeStorage.remove("loggedAdmin");
           window.location.assign("./login.html");
       } catch (error) {
           console.error("Không thể hoàn tất đăng xuất:", error);
           alert("Chưa thể xóa phiên đăng nhập khỏi trình duyệt. Hãy thử lại trước khi rời trang.");
       }
   });
}

if (currentUserRole === "owner") {
   flowerPricesPage = document.createElement("p");
   flowerPricesPage.id = "flower_prices_page";
   flowerPricesPage.textContent = "Quản lý giá hoa";
   flowerPricesPage.tabIndex = 0;
   flowerPricesPage.setAttribute("role", "button");
   flowerPricesPage.addEventListener("click", () => { void loadFlowerPrices(); });
   flowerPricesPage.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") {
           event.preventDefault();
           void loadFlowerPrices();
       }
   });
   const ownerLink = document.createElement("p");
   ownerLink.id = "owner_page";
   ownerLink.textContent = "Owner · Quản lý quyền";
   ownerLink.tabIndex = 0;
   ownerLink.setAttribute("role", "link");
   ownerLink.addEventListener("click", () => window.location.assign("./owner.html"));
   ownerLink.addEventListener("keydown", (event) => {
       if (event.key === "Enter" || event.key === " ") {
           event.preventDefault();
           window.location.assign("./owner.html");
       }
   });
   logOutPage?.parentElement?.insertBefore(ownerLink, logOutPage);
   logOutPage?.parentElement?.insertBefore(flowerPricesPage, ownerLink);
}

main.addEventListener("click", (event) => {
   const refreshFlowerPrices = event.target.closest("[data-price-refresh]");
   if (refreshFlowerPrices) { void loadFlowerPrices(); return; }
   const editFlowerPrice = event.target.closest("[data-price-edit]");
   if (editFlowerPrice) {
       editingFlowerPriceId = editFlowerPrice.dataset.priceEdit;
       flowerPricesMessage = "";
       renderFlowerPricesTab();
       main.querySelector(`[data-flower-price="${CSS.escape(editingFlowerPriceId)}"]`)?.focus();
       return;
   }
   const cancelFlowerPrice = event.target.closest("[data-price-cancel]");
   if (cancelFlowerPrice) {
       editingFlowerPriceId = null;
       flowerPricesMessage = "";
       renderFlowerPricesTab();
       return;
   }
   const saveFlowerPriceButton = event.target.closest("[data-price-save]");
   if (saveFlowerPriceButton) { void saveFlowerPrice(saveFlowerPriceButton.dataset.priceSave); return; }
   const showFlowerPriceHistory = event.target.closest("[data-price-history]");
   if (showFlowerPriceHistory) { void loadFlowerPriceHistory(showFlowerPriceHistory.dataset.priceHistory); return; }
   const closeFlowerPriceHistory = event.target.closest("[data-price-history-close]");
   if (closeFlowerPriceHistory) {
       flowerPriceHistory = null;
       renderFlowerPricesTab();
       return;
   }
   const moderation = event.target.closest("[data-review-moderation]");
   if (moderation) { void moderateReview(moderation.dataset.reviewId, moderation.dataset.reviewModeration); return; }
   const reviewPhotos = event.target.closest("[data-review-photos]");
   if (reviewPhotos) { void loadReviewPhotos(reviewPhotos.dataset.reviewPhotos); return; }
   const reloadDeliveryZones = event.target.closest("[data-delivery-zone-reload]");
   if (reloadDeliveryZones) {
       deliveryZonesLoadError = "";
       void loadDeliveryZones();
       renderDeliveryZonesTab();
       return;
   }
   const reloadDesignRequests = event.target.closest("[data-design-requests-reload]");
   if (reloadDesignRequests) {
       designRequestsLoadError = "";
       designRequestsLoaded = false;
       void loadDesignRequests();
       renderDesignRequestsTab();
       return;
   }
   const saveDesignRequestButton = event.target.closest("[data-design-request-save]");
   if (saveDesignRequestButton) {
       void saveDesignRequest(saveDesignRequestButton.dataset.designRequestSave);
       return;
   }
   const reloadBouquetWrapping = event.target.closest("[data-wrapping-reload]");
   if (reloadBouquetWrapping) {
       bouquetWrappingLoadError = "";
       void loadBouquetWrapping();
       renderDeliveryZonesTab();
       return;
   }
   const addWrappingTier = event.target.closest("[data-wrapping-tier-add]");
   if (addWrappingTier) {
       const tiers = document.getElementById("bouquet-wrapping-tiers");
       if (!tiers || tiers.querySelectorAll("[data-wrapping-tier]").length >= window.FlowerBouquetWrapping.MAX_TIERS) return;
       const row = document.createElement("div");
       row.className = "delivery-zone-row";
       row.dataset.wrappingTier = "";
       row.innerHTML = '<label><span class="field-label">Tối đa số cành</span><input name="maxStems" type="number" min="1" max="50" step="1" required></label><label><span class="field-label">Phí gói (₫)</span><input name="fee" type="number" min="0" max="1000000000" step="1" required></label><button class="delete-product" data-wrapping-tier-remove type="button">Xóa bậc</button>';
       tiers.append(row);
       return;
   }
   const removeWrappingTier = event.target.closest("[data-wrapping-tier-remove]");
   if (removeWrappingTier) {
       const rows = main.querySelectorAll("[data-wrapping-tier]");
       if (rows.length > 1) removeWrappingTier.closest("[data-wrapping-tier]").remove();
       return;
   }

   const saveDeliveryZoneButton = event.target.closest("[data-delivery-zone-save]");
   if (saveDeliveryZoneButton) {
       void saveDeliveryZoneRow(saveDeliveryZoneButton.dataset.deliveryZoneSave);
       return;
   }

   const deleteDeliveryZoneButton = event.target.closest("[data-delivery-zone-delete]");
   if (deleteDeliveryZoneButton) {
       void removeDeliveryZone(deleteDeliveryZoneButton.dataset.deliveryZoneDelete);
       return;
   }

   const selectAllOfferProducts = event.target.closest("[data-offer-select-all]");
   if (selectAllOfferProducts) {
       const productCheckboxes = [...main.querySelectorAll('#add-offer-form input[name="productIds"]')];
       const shouldSelectAll = productCheckboxes.some((checkbox) => !checkbox.checked);
       productCheckboxes.forEach((checkbox) => {
           checkbox.checked = shouldSelectAll;
       });
       return;
   }

   const offerActionButton = event.target.closest("[data-offer-action]");
   if (offerActionButton) {
       updateOffer(offerActionButton.dataset.offerId, offerActionButton.dataset.offerAction);
       return;
   }

   const editCategoryButton = event.target.closest(".edit-category");
   if (editCategoryButton) {
       renameCategory(editCategoryButton.dataset.category);
       return;
   }

   const deleteCategoryButton = event.target.closest(".delete-category");
   if (deleteCategoryButton) {
       deleteCategory(deleteCategoryButton.dataset.category);
       return;
   }

   const detailsButton = event.target.closest(".show-record-details");
   if (detailsButton) {
       const details = [...main.querySelectorAll(".record-details")]
           .find((element) => element.dataset.recordDetails === `${detailsButton.dataset.recordType}:${detailsButton.dataset.recordId}`);
       if (details) {
           details.hidden = !details.hidden;
           detailsButton.setAttribute("aria-expanded", String(!details.hidden));
           detailsButton.textContent = details.hidden ? "Xem chi tiết" : "Ẩn chi tiết";
       }
       return;
   }

   const editProductButton = event.target.closest(".edit-product");
   if (editProductButton) {
       editingProductId = editProductButton.dataset.id;
       renderProductTab();
       document.getElementById("product-title").focus();
       document.getElementById("add-product-form").scrollIntoView({ behavior: "smooth", block: "center" });
       return;
   }

   const deleteProductButton = event.target.closest(".delete-product");
   if (deleteProductButton) {
       deleteProduct(deleteProductButton.dataset.id);
       return;
   }

   const actionButton = event.target.closest("[data-action]");
   if (actionButton?.dataset.action === "clear-search") {
       productSearchTerm = "";
       productFilterCategory = "";
       productFilterStatus = "";
       productFilterMinPrice = "";
       productFilterMaxPrice = "";
       productPriceSort = "";
       renderProductTab();
       return;
   }
   if (actionButton?.dataset.action === "restore-catalog") {
       void restoreCatalog();
       return;
   }
   if (actionButton?.dataset.action === "delete-all-products") {
       void deleteAllProducts();
       return;
   }
   if (actionButton?.dataset.action === "toggle-product-visibility") {
       void toggleProductVisibility(actionButton.dataset.id);
       return;
   }
   if (actionButton?.dataset.action === "cancel-edit") {
       editingProductId = null;
       renderProductTab();
       return;
   }

   const deleteButton = event.target.closest(".delete-record");
   if (deleteButton) {
       deleteAdminRecord(deleteButton.dataset.recordType, deleteButton.dataset.recordId);
       return;
   }

   const completeButton = event.target.closest(".complete-record");
   if (completeButton) {
       setRecordCompletion(completeButton.dataset.recordType, completeButton.dataset.recordId, true);
       return;
   }

   const restoreButton = event.target.closest(".restore-record");
   if (restoreButton) {
       setRecordCompletion(restoreButton.dataset.recordType, restoreButton.dataset.recordId, false);
       return;
   }

   const saveQty = event.target.closest(".save-qty");
   if (saveQty) {
       const id = saveQty.dataset.id;
       const input = [...main.querySelectorAll(".qty-input")].find((element) => element.dataset.id === id);
       if (input) {
           saveProductQuantity(id, input.value);
       }
   }

   const latePayment = event.target.closest(".record-late-payment");
   if (latePayment) {
       recordLateOrderPayment(latePayment.dataset.orderId);
       return;
   }

   const verifyPayment = event.target.closest(".verify-payment");
   if (verifyPayment) {
       verifyOrderPayment(verifyPayment.dataset.orderId);
       return;
   }

   const paymentAudit = event.target.closest(".payment-audit");
   if (paymentAudit) {
       viewOrderPaymentAudit(paymentAudit.dataset.orderId);
       return;
   }

   const paymentRefund = event.target.closest(".record-payment-refund");
   if (paymentRefund) {
       recordOrderPaymentRefund(paymentRefund.dataset.orderId);
       return;
   }

   const statusSave = event.target.closest(".status-save");
   if (statusSave) {
       const orderId = statusSave.dataset.orderId;
       const select = [...main.querySelectorAll(".status-select")].find((element) => element.dataset.orderId === orderId);
       const location = [...main.querySelectorAll(".tracking-location")].find((element) => element.dataset.orderId === orderId);
       const estimatedDelivery = [...main.querySelectorAll(".tracking-eta")].find((element) => element.dataset.orderId === orderId);
       if (select && location && estimatedDelivery) {
           updateOrderStatus(orderId, select.value, location.value.trim(), estimatedDelivery.value);
       }
   }

   const replyButton = event.target.closest(".send-reply");
   if (replyButton) {
       const reviewId = replyButton.dataset.reviewId;
       const messageId = replyButton.dataset.messageId;

       if (reviewId) {
           const input = [...main.querySelectorAll(".reply-input[data-review-id]")]
               .find((element) => element.dataset.reviewId === reviewId);
           if (input) updateReviewReply(reviewId, input.value.trim());
       }

       if (messageId) {
           const input = [...main.querySelectorAll(".reply-input[data-message-id]")]
               .find((element) => element.dataset.messageId === messageId);
           if (input) updateMessageReply(messageId, input.value.trim());
       }
   }
});

main.addEventListener("submit", (event) => {
   if (event.target && event.target.id === "add-delivery-zone-form") {
       void addDeliveryZone(event);
   }
   if (event.target && event.target.id === "bouquet-wrapping-form") {
       void saveBouquetWrapping(event);
   }

   if (event.target && event.target.id === "product-search-form") {
       event.preventDefault();
       const formData = new FormData(event.target);
       const minPriceText = String(formData.get("minPrice") || "").trim();
       const maxPriceText = String(formData.get("maxPrice") || "").trim();
       const minPrice = minPriceText === "" ? "" : Number(minPriceText);
       const maxPrice = maxPriceText === "" ? "" : Number(maxPriceText);
       const priceMessage = document.getElementById("product-search-message");
       if (event.target.elements.minPrice.validity.badInput || event.target.elements.maxPrice.validity.badInput
           || (minPrice !== "" && (!Number.isSafeInteger(minPrice) || minPrice < 0))
           || (maxPrice !== "" && (!Number.isSafeInteger(maxPrice) || maxPrice < 0))) {
           priceMessage.textContent = "Khoảng giá phải là số nguyên VND không âm.";
           return;
       }
       if (minPrice !== "" && maxPrice !== "" && minPrice > maxPrice) {
           priceMessage.textContent = "Giá từ không được lớn hơn giá đến.";
           event.target.elements.minPrice.focus();
           return;
       }
       productSearchTerm = String(formData.get("search") || "");
       productFilterCategory = String(formData.get("category") || "");
       productFilterStatus = String(formData.get("status") || "");
       productFilterMinPrice = minPrice;
       productFilterMaxPrice = maxPrice;
       productPriceSort = String(formData.get("priceSort") || "");
       renderProductTab();
   }

   if (event.target && event.target.id === "add-product-form") {
       addNewProduct(event);
   }

   if (event.target && event.target.id === "add-category-form") {
       addCategory(event);
   }

   if (event.target && event.target.id === "add-offer-form") {
       addOffer(event);
   }
});
}


registerAdminFunctions({ bindAdminEvents });
