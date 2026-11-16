import { registerAdminFunctions } from "./admin-state.js";

function rerenderKeepingEdits(render) {
   const isDirty = (field) => field.tagName === "SELECT"
       ? [...field.options].some((option) => option.selected !== option.defaultSelected)
       : field.value !== field.defaultValue;
   const keyOf = (field) => {
       if (field.id) return field.id;
       const recordId = field.dataset.id ?? field.dataset.orderId ?? field.dataset.reviewId ?? field.dataset.messageId;
       return recordId === undefined ? "" : `${field.className}:${recordId}`;
   };
   const edits = new Map();
   main.querySelectorAll("input, select, textarea").forEach((field) => {
       const key = keyOf(field);
       if (key && isDirty(field)) edits.set(key, field.value);
   });
   const focusedKey = document.activeElement && main.contains(document.activeElement) ? keyOf(document.activeElement) : "";
   const openDetails = new Set([...main.querySelectorAll(".record-details:not([hidden])")]
       .map((element) => element.dataset.recordDetails));
   const scrollY = window.scrollY;

   render();

   main.querySelectorAll(".record-details").forEach((details) => {
       if (!openDetails.has(details.dataset.recordDetails)) return;
       details.hidden = false;
       const [type, id] = details.dataset.recordDetails.split(/:(.*)/s);
       const button = [...main.querySelectorAll(".show-record-details")]
           .find((element) => element.dataset.recordType === type && element.dataset.recordId === id);
       if (button) {
           button.setAttribute("aria-expanded", "true");
           button.textContent = "Ẩn chi tiết";
       }
   });
   main.querySelectorAll("input, select, textarea").forEach((field) => {
       const key = keyOf(field);
       if (edits.has(key)) field.value = edits.get(key);
       if (key && key === focusedKey) field.focus({ preventScroll: true });
   });
   window.scrollTo(0, scrollY);
}

function refreshProductTabKeepingEdits() {
   rerenderKeepingEdits(renderProductTab);
   renderProductImagePreviews();
}

window.addEventListener("storage", (event) => {
   const activeHeading = main.querySelector(".panel h2");
   if (event.key === "flowerInventory" && activeHeading?.textContent === "Quản lý kho hoa") {
       refreshProductTabKeepingEdits();
   }
});

window.addEventListener("pagehide", () => {
   if (stopOrderSubscription) stopOrderSubscription();
   if (stopPromotionSubscription) stopPromotionSubscription();
   if (stopReviewSubscription) stopReviewSubscription();
   if (stopCategorySubscription) stopCategorySubscription();
   if (stopMessageSubscription) stopMessageSubscription();
});

window.addEventListener("flowerinventorychange", () => {
    const activeHeading = main.querySelector(".panel h2");
    if (activeHeading?.textContent === "Quản lý kho hoa") {
         refreshProductTabKeepingEdits();
    } else if (main.querySelector(".dashboard")) {
         renderDashboard();
    } else if (activeHeading?.textContent === "Doanh thu & kho hàng") {
         renderRevenueTab();
    }
});


registerAdminFunctions({ rerenderKeepingEdits, refreshProductTabKeepingEdits });
