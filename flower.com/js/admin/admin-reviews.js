import { registerAdminFunctions } from "./admin-state.js";
import { preparePhotos } from "../review/review-images.js?v=1";

function renderReviewCard(review, showCompletionAction = true) {
   return `
       <div class="review-item feedback-card content-card">
           <div class="card-header">
               <div>
                   <div class="title-row">
                       <span class="card-icon">⭐</span>
                       <strong>${escapeHtml(review.customerName)}</strong>
                   </div>
                   <div class="review-meta">
                       ${review.phone ? `<span>📞 ${escapeHtml(review.phone)}</span>` : ""}
                       <span>🕒 ${new Date(review.createdAt).toLocaleString("vi-VN")}</span>
                   </div>
               </div>
               <div class="card-actions">
                   <span class="card-tag card-tag-review">Đánh giá</span>
                   ${showCompletionAction ? renderCompletionAction("reviews", review) : ""}
               </div>
           </div>

           <div class="info-grid two-col">
               <div class="field">
                   <span class="field-label">Sản phẩm</span>
                   <span class="field-value">${escapeHtml(review.productName)}</span>
               </div>
               <div class="field">
                   <span class="field-label">Xếp hạng</span>
                   <span class="field-value rating-value">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</span>
               </div>
           </div>

           <div class="section-label">Nội dung đánh giá</div>
           <div class="detail-block quote-box">${escapeHtml(review.comment || "Không có nhận xét")}</div>
           <p class="review-original-note">${review.verifiedPurchase === true ? "Khách đã mua hàng" : "Đánh giá cũ"} · Nội dung gốc chỉ đọc. Quản trị không được sửa sao, nhận xét hoặc ảnh.</p>
           <p><strong>Kiểm duyệt:</strong> ${escapeHtml(({ pending: "Chờ duyệt", approved: "Đã duyệt", hidden: "Đã ẩn" })[review.moderationStatus || "pending"] || "Chờ duyệt")}</p>
           <div class="review-admin-photos" data-review-gallery="${escapeHtml(review.id)}"></div>
           ${review.photoIds?.length ? `<button type="button" class="secondary-btn" data-review-photos="${escapeHtml(review.id)}">Xem ${review.photoIds.length} ảnh khách gửi</button>` : ""}
           <label class="field-label">Lý do kiểm duyệt (không bắt buộc)
               <input class="review-moderation-reason" data-review-reason="${escapeHtml(review.id)}" maxlength="500" value="${escapeHtml(review.moderationReason || "")}">
           </label>
           <div class="review-moderation-actions">
               <button type="button" class="submit-btn" data-review-moderation="approved" data-review-id="${escapeHtml(review.id)}">Duyệt hiển thị</button>
               <button type="button" class="secondary-btn" data-review-moderation="hidden" data-review-id="${escapeHtml(review.id)}">Ẩn đánh giá</button>
           </div>

           <div class="reply-box">
               <label class="field-label">Phản hồi của bạn</label>
               <textarea class="reply-input" data-review-id="${escapeHtml(review.id)}" placeholder="Nhập phản hồi cho khách hàng...">${escapeHtml(review.reply || "")}</textarea>
               <button class="send-reply" data-review-id="${escapeHtml(review.id)}">Gửi phản hồi</button>
           </div>
       </div>
   `;
}

function renderActiveReviewSummary(review) {
   return renderReviewSummary(review);
}

function renderReviewSummary(review) {
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>${escapeHtml(review.customerName)} · ${escapeHtml(review.productName)}</strong>
               <span class="rating-value">${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</span>
               <span>${escapeHtml(({ pending: "Chờ duyệt", approved: "Đã duyệt", hidden: "Đã ẩn" })[review.moderationStatus || "pending"] || "Chờ duyệt")}</span>
               <span class="record-summary-preview"><b>Đánh giá:</b> ${escapeHtml(review.comment || "Không có nhận xét")}</span>
               <span><b>Thời gian:</b> ${new Date(review.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="reviews" data-record-id="${escapeHtml(review.id)}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="reviews:${escapeHtml(review.id)}" hidden>
               ${renderReviewCard(review)}
           </div>
       </article>
   `;
}

function renderReviewsTab() {
   const reviews = getReviews();
   const visible = reviews.filter((review) => reviewModerationFilter === "all" || (review.moderationStatus || "pending") === reviewModerationFilter);
   main.innerHTML = `
       <section class="panel">
           <h2>Đánh giá khách hàng</h2>
           <label for="review-moderation-filter">Lọc kiểm duyệt</label>
           <select id="review-moderation-filter">
               ${[["pending", "Chờ duyệt"], ["approved", "Đã duyệt"], ["hidden", "Đã ẩn"], ["all", "Tất cả"]].map(([value, label]) => `<option value="${value}" ${reviewModerationFilter === value ? "selected" : ""}>${label}</option>`).join("")}
           </select>
           <p>Chỉ đánh giá đã duyệt xuất hiện trên sản phẩm. Trả lời của cửa hàng tách riêng với nội dung khách.</p>
           <div class="list-stack">
               ${visible.length ? visible.map(renderActiveReviewSummary).join("") : '<div class="empty-state">Không có đánh giá phù hợp.</div>'}
           </div>
       </section>
   `;
   document.getElementById("review-moderation-filter").addEventListener("change", (event) => {
       reviewModerationFilter = event.target.value;
       renderReviewsTab();
   });
}

async function moderateReview(id, status) {
   const reason = [...main.querySelectorAll("[data-review-reason]")].find((input) => input.dataset.reviewReason === id)?.value.trim() || "";
   try { await window.FlowerReviewStore.update(id, { moderationStatus: status, moderationReason: reason }); }
   catch (error) { alert(error.message || "Chưa lưu được kiểm duyệt. Hãy thử lại."); }
}
async function loadReviewPhotos(id) {
   const review = getReviews().find((item) => item.id === id);
   const gallery = [...main.querySelectorAll("[data-review-gallery]")].find((element) => element.dataset.reviewGallery === id);
   if (!review || !gallery) return;
   try {
       const urls = await window.FlowerReviewStore.loadPhotos(review);
       gallery.replaceChildren(...urls.map((url, index) => {
           const image = document.createElement("img"); image.src = url; image.alt = `Ảnh khách gửi ${index + 1}`; return image;
       }));
   } catch (error) { gallery.textContent = error.message || "Chưa tải được ảnh."; }
}

function renderMessageCard(message, showCompletionAction = true) {
   return `
       <div class="message-item feedback-card content-card">
           <div class="card-header">
               <div>
                   <div class="title-row">
                       <span class="card-icon">💬</span>
                       <strong>${escapeHtml(message.customerName)}</strong>
                   </div>
                   <div class="message-meta">
                       <span>📞 ${escapeHtml(message.phone)}</span>
                       <span>🕒 ${new Date(message.createdAt).toLocaleString("vi-VN")}</span>
                   </div>
               </div>
               <div class="card-actions">
                   <span class="card-tag card-tag-message">Phản hồi</span>
                   ${showCompletionAction ? renderCompletionAction("messages", message) : ""}
               </div>
           </div>

           <div class="info-grid single-col">
               <div class="field">
                   <span class="field-label">Chủ đề</span>
                   <span class="field-value">${escapeHtml(message.subject || "Tư vấn đặt hàng")}</span>
               </div>
           </div>

           <div class="section-label">Nội dung khách nhắn</div>
           <div class="detail-block quote-box">${escapeHtml(message.message)}</div>
           ${message.reply ? `<div class="reply-banner"><strong>Phản hồi của bạn:</strong> ${escapeHtml(message.reply)}</div>` : ""}

           <div class="reply-box">
               <label class="field-label">Trả lời khách</label>
               <textarea class="reply-input" data-message-id="${escapeHtml(message.id)}" placeholder="Nhập câu trả lời cho khách hàng...">${escapeHtml(message.reply || "")}</textarea>
               <button class="send-reply" data-message-id="${escapeHtml(message.id)}">Trả lời</button>
           </div>
       </div>
   `;
}

function renderCompletedMessageSummary(message) {
   return renderMessageSummary(message);
}

function renderActiveMessageSummary(message) {
   return renderMessageSummary(message);
}

function renderMessageSummary(message) {
   return `
       <article class="record-summary">
           <div class="completed-order-info">
               <strong>${escapeHtml(message.customerName)} · ${escapeHtml(message.subject || "Tư vấn đặt hàng")}</strong>
               <span class="record-summary-preview"><b>Nội dung:</b> ${escapeHtml(message.message)}</span>
               <span><b>Thời gian:</b> ${new Date(message.createdAt).toLocaleString("vi-VN")}</span>
           </div>
           <div class="record-summary-actions">
               <button class="secondary-btn show-record-details" data-record-type="messages" data-record-id="${escapeHtml(message.id)}" type="button" aria-expanded="false">Xem chi tiết</button>
           </div>
           <div class="record-details" data-record-details="messages:${escapeHtml(message.id)}" hidden>
               ${renderMessageCard(message)}
           </div>
       </article>
   `;
}

function renderMessagesTab() {
   const messages = getMessages();
   const activeMessages = messages.filter((message) => !message.completedAt);
   const completedMessages = messages.filter((message) => message.completedAt);
   main.innerHTML = `
       <section class="panel">
           <h2>Phản hồi từ khách hàng</h2>
           <div class="list-stack">
               ${activeMessages.length ? activeMessages.map(renderActiveMessageSummary).join("") : '<div class="empty-state">Không có phản hồi nào cần xử lý.</div>'}
           </div>
           ${renderCompletedSection(completedMessages, renderCompletedMessageSummary, "phản hồi")}
       </section>
   `;
}

// Stock is a whole number of bouquets; the order API rejects anything else.
async function updateReviewReply(reviewId, reply) {
   try {
       await window.FlowerReviewStore.update(reviewId, { reply });
       alert(reply.trim()
           ? "Đã lưu phản hồi. Khách sẽ thấy ở trang sản phẩm và trang theo dõi đơn hàng."
           : "Đã xóa phản hồi.");
   } catch (error) {
       console.error("Không thể lưu phản hồi đánh giá:", error);
       alert("Chưa thể lưu phản hồi. Hãy thử lại sau.");
   }
}

async function updateMessageReply(messageId, reply) {
   const message = getMessages().find((item) => String(item.id) === String(messageId));
   if (!message) return;
   try {
       if (message.source === "legacy") {
           await window.FlowerMessageStore.updateAdminMessage(messageId, { reply });
       } else {
           await window.FlowerOrderStore.update(messageId, { orderNoteReply: reply });
       }
   } catch (error) {
       console.error("Không thể lưu câu trả lời:", error);
       alert("Chưa thể lưu câu trả lời. Hãy thử lại sau.");
   }
}

async function deleteAdminRecord(type, id) {
   const records = {
       orders: { label: "đơn hàng", render: renderOrdersTab },
       reviews: { label: "đánh giá", render: renderReviewsTab },
       messages: { label: "lời nhắn", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể xóa mục admin không hợp lệ:", type);
       return;
   }

   const warning = type === "orders"
       ? "Bạn có chắc muốn xóa đơn hàng này không? Nếu đơn còn đang giữ hàng, số lượng sẽ được trả lại kho. Không thể hoàn tác."
       : type === "messages"
           ? "Ẩn lời nhắn này khỏi danh sách phản hồi? Ghi chú gốc vẫn được giữ trong đơn hàng."
           : "Ẩn đánh giá khỏi sản phẩm? Nội dung gốc vẫn được lưu, không bị sửa hoặc xóa.";
   if (!window.confirm(warning)) return;

   if (type === "orders") {
       try {
           await window.FlowerOrderStore.remove(id);
       } catch (error) {
           console.error("Không thể xóa đơn hàng trên Firestore:", error);
           alert("Chưa thể xóa đơn hàng dùng chung. Hãy thử lại sau.");
       }
       return;
   }

   try {
       if (type === "reviews") await window.FlowerReviewStore.remove(id);
       else {
           const message = getMessages().find((item) => String(item.id) === String(id));
           if (message?.source === "legacy") await window.FlowerMessageStore.deleteAdminMessage(id);
           // The note belongs to the order: hide it from this list, never erase it.
           else if (message) await window.FlowerOrderStore.update(id, {
               orderNoteArchivedAt: new Date().toISOString()
           });
       }
   } catch (error) {
       console.error(`Không thể xóa ${record.label} trên Firestore:`, error);
       alert(`Chưa thể xóa ${record.label}. Hãy thử lại sau.`);
   }
}

async function setRecordCompletion(type, id, completed) {
   const records = {
       orders: { label: "đơn hàng", render: renderOrdersTab },
       reviews: { label: "đánh giá", render: renderReviewsTab },
       messages: { label: "lời nhắn", render: renderMessagesTab }
   };
   const record = records[type];
   if (!record) {
       console.error("Không thể cập nhật mục hoàn thành không hợp lệ:", type);
       return;
   }

   if (type === "orders") {
       try {
           await window.FlowerOrderStore.update(id, {
               completedAt: completed ? new Date().toISOString() : null
           });
       } catch (error) {
           console.error("Không thể cập nhật đơn hàng trên Firestore:", error);
           alert("Chưa thể cập nhật đơn hàng dùng chung. Hãy thử lại sau.");
       }
       return;
   }

   const completedAt = completed ? new Date().toISOString() : null;
   try {
       if (type === "reviews") await window.FlowerReviewStore.update(id, { completedAt });
       else {
           const message = getMessages().find((item) => String(item.id) === String(id));
           if (message?.source === "legacy") {
               await window.FlowerMessageStore.updateAdminMessage(id, { completedAt });
           } else if (message) {
               await window.FlowerOrderStore.update(id, { orderNoteCompletedAt: completedAt });
           }
       }
   } catch (error) {
       console.error(`Không thể cập nhật ${record.label} trên Firestore:`, error);
       alert(`Chưa thể cập nhật ${record.label}. Hãy thử lại sau.`);
   }
}


registerAdminFunctions({ renderReviewCard, renderActiveReviewSummary, renderReviewSummary, renderReviewsTab, moderateReview, loadReviewPhotos, renderMessageCard, renderCompletedMessageSummary, renderActiveMessageSummary, renderMessageSummary, renderMessagesTab, updateReviewReply, updateMessageReply, deleteAdminRecord, setRecordCompletion });
