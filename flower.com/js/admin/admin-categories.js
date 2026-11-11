import { registerAdminFunctions } from "./admin-state.js";

function renderCategoriesTab() {
   const categories = getCategories();
   const products = getProducts();
   main.innerHTML = `
       <section class="panel-wrap">
           <div class="panel">
               <h2>Quản lý phân loại</h2>
               <p class="category-help">Tạo danh mục để nhóm sản phẩm. Xóa danh mục sẽ chuyển sản phẩm thuộc danh mục đó về trạng thái chưa phân loại.</p>
               <form id="add-category-form" class="category-form">
                   <label class="visually-hidden" for="category-name">Tên phân loại</label>
                   <input id="category-name" name="category" type="text" placeholder="Ví dụ: Hoa sinh nhật" maxlength="80" required>
                   <button class="submit-btn" type="submit">Thêm phân loại</button>
               </form>
               <div class="category-list">
                   ${categories.map((category) => {
                       const productCount = products.filter((product) => product.category === category).length;
                       return `
                           <article class="category-row">
                               <div>
                                   <strong>${escapeHtml(category)}</strong>
                                   <span>${productCount} sản phẩm</span>
                               </div>
                               <div class="product-row-actions">
                                   <button class="secondary-btn edit-category" data-category="${escapeHtml(category)}" type="button">Đổi tên</button>
                                   <button class="delete-product delete-category" data-category="${escapeHtml(category)}" type="button">Xóa</button>
                               </div>
                           </article>
                       `;
                   }).join("") || '<div class="empty-state">Chưa có phân loại. Hãy thêm phân loại đầu tiên.</div>'}
               </div>
           </div>
       </section>
   `;
}

function addCategory(event) {
   event.preventDefault();
   const input = document.getElementById("category-name");
   const category = input.value.trim();
   if (!category) {
       alert("Vui lòng nhập tên phân loại.");
       return;
   }
   if (getCategories().some((existing) => existing.toLocaleLowerCase("vi") === category.toLocaleLowerCase("vi"))) {
       alert("Phân loại này đã tồn tại.");
       input.focus();
       return;
   }
   saveCategories([...getCategories(), category]);
   renderCategoriesTab();
}

async function renameCategory(oldCategory) {
   const newCategory = window.prompt("Nhập tên phân loại mới:", oldCategory)?.trim();
   if (!newCategory || newCategory === oldCategory) return;
   if (getCategories().some((category) => category.toLocaleLowerCase("vi") === newCategory.toLocaleLowerCase("vi"))) {
       alert("Phân loại này đã tồn tại.");
       return;
   }

   const categories = getCategories().map((category) => category === oldCategory ? newCategory : category);
   if (!await saveAdminProducts(getProducts().map((product) =>
       product.category === oldCategory ? { ...product, category: newCategory } : product
   ))) return;
   saveCategories(categories);
   renderCategoriesTab();
}

async function deleteCategory(category) {
   const productCount = getProducts().filter((product) => product.category === category).length;
   const message = productCount
       ? `Xóa phân loại “${category}” và bỏ phân loại khỏi ${productCount} sản phẩm?`
       : `Xóa phân loại “${category}”?`;
   if (!window.confirm(message)) return;

   const categories = getCategories().filter((existing) => existing !== category);
   if (!await saveAdminProducts(getProducts().map((product) =>
       product.category === category ? { ...product, category: "" } : product
   ))) return;
   saveCategories(categories);
   renderCategoriesTab();
}


registerAdminFunctions({ renderCategoriesTab, addCategory, renameCategory, deleteCategory });
