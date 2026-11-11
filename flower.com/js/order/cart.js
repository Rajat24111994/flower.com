      // Same limit as the order API (api/orders.js MAX_QUANTITY_PER_PRODUCT).
      const MAX_QUANTITY_PER_PRODUCT = 50;
      const MAX_BOUQUET_STEMS = 50;
      let CartContainer = document.getElementById("product-container");
      const cartActionMessage = document.getElementById("cart-action-message");
      let cartQuoteVersion = 0;
      let Cart = FlowerSafeStorage.readJson("cart", {
        fallback: [],
        validate: (value) => Array.isArray(value)
          && value.every((item) => item && typeof item === "object" && !Array.isArray(item) && item.id !== undefined)
      });

      function saveCart(nextCart) {
        try {
          FlowerSafeStorage.writeJson("cart", nextCart, { required: true });
          Cart = nextCart;
          DisplayProduct();
          return true;
        } catch (error) {
          console.error("Không thể lưu giỏ hàng:", error);
          alert("Chưa thể lưu thay đổi giỏ hàng. Hãy kiểm tra dung lượng hoặc quyền lưu trữ của trình duyệt rồi thử lại.");
          return false;
        }
      }

      async function updateWrappingSummary() {
        const requestVersion = ++cartQuoteVersion;
        const wrappingElement = document.getElementById("bouquetWrappingCharge");
        const totalElement = document.getElementById("total");
        const currentTotal = calculateCartTotals(Cart).total;
        if (!Cart.some((item) => item.customBouquetId || item.saleType === "flower")) {
          wrappingElement.textContent = formatVnd(0);
          totalElement.textContent = formatVnd(currentTotal);
          return;
        }
        wrappingElement.textContent = "Đang xác minh";
        try {
          const quote = await FlowerOrderStore.quote(Cart.map((item) => ({
            id: item.id,
            productId: item.productId,
            customBouquetId: item.customBouquetId,
            quantity: Math.max(1, Number(item.quantity) || 1)
          })));
          if (requestVersion !== cartQuoteVersion) return;
          const wrappingFee = Number(quote.totals?.wrappingFee);
          if (!Number.isSafeInteger(wrappingFee) || wrappingFee < 0) throw new Error("Máy chủ chưa trả về phí gói hợp lệ.");
          wrappingElement.textContent = formatVnd(wrappingFee);
          totalElement.textContent = formatVnd(currentTotal + wrappingFee);
        } catch (error) {
          if (requestVersion !== cartQuoteVersion) return;
          console.error("Không thể xác minh phí bó hoa trong giỏ:", error);
          wrappingElement.textContent = "Chưa xác minh";
          cartActionMessage.textContent = error.message || "Chưa thể xác minh phí bó hoa. Phí cuối cùng sẽ được kiểm tra khi thanh toán.";
          cartActionMessage.hidden = false;
        }
      }

      function DisplayProduct() {
        const cartTotal = document.getElementById("cartTotal");
        cartTotal.textContent = FlowerSafeStorage.countCartUnits(Cart);
        document.querySelector(".nav").classList.toggle("is-empty", Cart.length === 0);

        CartContainer.innerHTML = "";
        if (!Cart.length) {
          const empty = document.createElement("div");
          const icon = document.createElement("span");
          const heading = document.createElement("h2");
          const text = document.createElement("p");
          const link = document.createElement("a");
          empty.className = "cart-empty";
          icon.className = "cart-empty-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.textContent = "✿";
          heading.textContent = "Giỏ hàng đang trống";
          text.textContent = "Chọn bó hoa làm sẵn hoặc tự phối hoa theo giá trong ngày rồi quay lại thanh toán.";
          link.href = "./custom-bouquet.html";
          link.textContent = "Tự phối bó hoa";
          empty.append(icon, heading, text, link);
          CartContainer.append(empty);
        }

        const bouquetNumbers = new Map();
        Cart.forEach((product) => {
          if (product.customBouquetId && !bouquetNumbers.has(product.customBouquetId)) {
            bouquetNumbers.set(product.customBouquetId, bouquetNumbers.size + 1);
          }
          const image = document.createElement("img");
          const info = document.createElement("div");
          const details = document.createElement("h3");
          const price = document.createElement("p");
          const actions = document.createElement("div");
          const Remove = document.createElement("button");
          const Increase = document.createElement("button");
          const Decrease = document.createElement("button");
          const card = document.createElement("article");
          const quantity = document.createElement("span");
          const stockNote = document.createElement("p");
          const productName = product.title || "Sản phẩm hoa";

          card.className = "cart-item";
          info.className = "cart-item-details";
          details.className = "cart-item-name";
          price.className = "cart-item-price";
          stockNote.className = "cart-stock-note";
          actions.className = "cart-item-actions";
          Remove.className = "cart-remove";
          image.src = product.image;
          const bouquetSummary = FlowerBouquetOptions.summary(product);
          image.alt = productName;
          details.textContent = productName;
          const customization = document.createElement("p");
          customization.className = "cart-item-options";
          customization.textContent = product.customBouquetId
            ? `Bó tùy chỉnh ${bouquetNumbers.get(product.customBouquetId)} · ${bouquetSummary}`
            : bouquetSummary;
          price.textContent = `${formatVnd(product.price)} / ${product.saleType === "flower" ? "cành" : "bó"}`;
          [Decrease, Increase, Remove].forEach((button) => { button.type = "button"; });
          Remove.textContent = "Xóa";
          Increase.textContent = "+";
          Decrease.textContent = "−";
          Decrease.setAttribute("aria-label", `Giảm số lượng ${productName}`);
          Increase.setAttribute("aria-label", `Tăng số lượng ${productName}`);
          Remove.setAttribute("aria-label", `Xóa ${productName} khỏi giỏ hàng`);
          quantity.setAttribute("aria-live", "polite");
          const productQuantity = Math.max(1, Number(product.quantity) || 1);
          Decrease.disabled = productQuantity <= 1;
          const stockQuantity = Number(product.stockQuantity);
          const hasStockLimit = Number.isFinite(stockQuantity) && stockQuantity >= 0;
          const requestedStock = FlowerBouquetOptions.demand(Cart, product.productId ?? product.id);
          const requestedBouquetStems = product.customBouquetId
            ? Cart.filter((item) => item.customBouquetId === product.customBouquetId)
              .reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0)
            : 0;
          quantity.textContent = productQuantity;
          // Stock is shared by every line of the same flower; the 50 limit is per line (as on the server).
          const atOrderLimit = productQuantity >= MAX_QUANTITY_PER_PRODUCT;
          Increase.disabled = atOrderLimit || (hasStockLimit && requestedStock >= stockQuantity)
            || (product.customBouquetId && requestedBouquetStems >= MAX_BOUQUET_STEMS);
          stockNote.textContent = productQuantity > MAX_QUANTITY_PER_PRODUCT
            ? `Mỗi lựa chọn bó hoa đặt tối đa ${MAX_QUANTITY_PER_PRODUCT} bó.`
            : hasStockLimit
              ? requestedStock > stockQuantity
                ? `Số lượng trong giỏ vượt tồn kho (${stockQuantity}).`
                : `Tồn kho: ${stockQuantity}${atOrderLimit ? ` · tối đa ${MAX_QUANTITY_PER_PRODUCT} mỗi lựa chọn` : ""}`
              : "";

          Decrease.addEventListener("click", () => {
            if (productQuantity > 1) {
              saveCart(Cart.map((item) => item.id === product.id
                ? { ...item, quantity: productQuantity - 1 }
                : item));
            }
          });
          Increase.addEventListener("click", () => {
            if (atOrderLimit || (hasStockLimit && requestedStock >= stockQuantity)) return;
            if (product.customBouquetId && requestedBouquetStems >= MAX_BOUQUET_STEMS) {
              cartActionMessage.textContent = `Mỗi bó tùy chỉnh tối đa ${MAX_BOUQUET_STEMS} cành.`;
              cartActionMessage.hidden = false;
              return;
            }
            saveCart(Cart.map((item) => item.id === product.id
              ? { ...item, quantity: productQuantity + 1 }
              : item));
          });
          Remove.addEventListener("click", () => {
            const nextCart = Cart.filter((ele) => ele.id !== product.id);
            if (saveCart(nextCart)) {
              cartActionMessage.textContent = "Đã xóa sản phẩm khỏi giỏ hàng.";
              cartActionMessage.hidden = false;
            }
          });
          actions.append(Decrease, quantity, Increase, Remove);
          info.append(details, customization, price, stockNote, actions);
          card.append(image, info);
          CartContainer.append(card);
        });

        renderCartSummary(Cart);
        void updateWrappingSummary();
      }

      DisplayProduct();

      window.addEventListener("flowerstoragechange", (event) => {
        if (event.detail?.source !== "sync" || event.detail.key !== "cart") return;
        try {
          Cart = FlowerSafeStorage.readJson("cart", {
            fallback: [],
            validate: (value) => Array.isArray(value)
              && value.every((item) => item && typeof item === "object" && !Array.isArray(item) && item.id !== undefined)
          });
          DisplayProduct();
        } catch (error) {
          console.error("Không thể cập nhật giỏ hàng đã đồng bộ:", error);
          cartActionMessage.textContent = "Không thể tải giỏ hàng vừa đồng bộ. Dữ liệu cũ vẫn được giữ lại.";
          cartActionMessage.hidden = false;
        }
      });

      // The stock saved with each cart line is from when it was added; read the shop's current
      // stock so the page does not offer quantities that are no longer available.
      fetch("/api/products", { headers: { Accept: "application/json" } })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
        .then(({ products }) => {
          if (!Array.isArray(products) || !products.length) return;
          const stockById = new Map(products.map((product) => [String(product.id), Number(product.quantity)]));
          let changed = false;
          const nextCart = Cart.map((item) => {
            const stock = stockById.has(String(item.productId ?? item.id)) ? stockById.get(String(item.productId ?? item.id)) : 0;
            if (!Number.isInteger(stock) || stock === Number(item.stockQuantity)) return item;
            changed = true;
            return { ...item, stockQuantity: Math.max(0, stock) };
          });
          if (changed) saveCart(nextCart);
        })
        .catch((error) => console.warn("Không thể cập nhật tồn kho mới nhất:", error));
