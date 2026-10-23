(function addStoreHeader() {
  document.currentScript.insertAdjacentHTML("beforebegin", `
  <div class="announcement">
    <span>Hoa tươi trao tận tay, yêu thương gửi tận lòng</span>
    <a href="./product.html">Khám phá bộ sưu tập <span aria-hidden="true">→</span></a>
  </div>

  <header class="site-header">
    <div class="header-main">
      <a class="brand" href="./index.html" aria-label="Flowerflow - Trang chủ">
        <img src="./images/flowerflow-logo.png" alt="">
        <span>flowerflow</span>
      </a>

      <form class="search-form" action="./product.html" method="get" role="search">
        <label class="sr-only" for="search">Tìm hoa và quà tặng</label>
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m16 16 4.2 4.2"></path></svg>
        </span>
        <input id="search" type="search" name="search" placeholder="Bạn đang tìm loài hoa nào?" autocomplete="off">
        <button id="sbtn" type="submit">Tìm kiếm</button>
      </form>

      <div class="header-actions">
        <div class="header-action signin" role="button" tabindex="0">
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.6-3.8 2.9-5.8 7-5.8s6.4 2 7 5.8"></path></svg>
          </span>
          <h5>Tài khoản</h5>
        </div>
        <a class="header-action favorite-nav" href="./wish.html" aria-label="Yêu thích">
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M20.8 8.8c0 5.2-8.8 11-8.8 11s-8.8-5.8-8.8-11a4.7 4.7 0 0 1 8.8-2.2 4.7 4.7 0 0 1 8.8 2.2Z"></path></svg>
            <span class="favorite-count">0</span>
          </span>
          <span>Yêu thích</span>
        </a>
        <a class="header-action" href="./tracking.html">
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M3 6.5h11v11H3zM14 10h4l3 3v4h-7z"></path><circle cx="7.5" cy="18.5" r="1.8"></circle><circle cx="17.5" cy="18.5" r="1.8"></circle></svg>
          </span>
          <span>Đơn hàng</span>
        </a>
        <a class="header-action" href="./cart.html">
          <span class="action-icon bag-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M5 8h14l1 12H4L5 8Z"></path><path d="M9 9V6a3 3 0 0 1 6 0v3"></path></svg>
            <span id="cartTotal">0</span>
          </span>
          <span>Giỏ hàng</span>
        </a>
      </div>

      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-nav">
        <span class="sr-only">Mở menu</span>
        <span></span><span></span><span></span>
      </button>
    </div>

    <nav class="primary-nav" id="primary-nav" aria-label="Điều hướng chính">
      <a href="./index.html#flower-categories">Danh mục hoa</a>
      <a href="./product.html">Tất cả sản phẩm</a>
      <a href="./product.html?flower=mixed">Hoa tổng hợp</a>
      <a href="./index.html#footer">Về Flowerflow</a>
    </nav>
  </header>
  `);

  const menuToggle = document.querySelector(".menu-toggle");
  const primaryNav = document.getElementById("primary-nav");

  function setMenuOpen(isOpen) {
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.querySelector(".sr-only").textContent = isOpen ? "Đóng menu" : "Mở menu";
    primaryNav.classList.toggle("is-open", isOpen);
  }

  menuToggle.addEventListener("click", () => {
    setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });

  primaryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });
})();

function getCurrentAccount() {
    try {
        const account = JSON.parse(localStorage.getItem("loggedUser") || "null");
        return account && typeof account === "object" ? account : null;
    } catch (error) {
        console.error("Không thể đọc phiên tài khoản:", error);
        return null;
    }
}

function updateShoppingHeaderCounts() {
    try {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]");
        const wishlist = JSON.parse(localStorage.getItem("wish") || "[]");
        if (!Array.isArray(cart) || !Array.isArray(wishlist)) {
            throw new Error("Dữ liệu giỏ hàng hoặc yêu thích không hợp lệ.");
        }

        const cartCount = document.getElementById("cartTotal");
        if (cartCount) cartCount.textContent = String(cart.length);
        document.querySelectorAll(".favorite-count").forEach((count) => {
            count.textContent = String(wishlist.length);
        });
    } catch (error) {
        console.error("Không thể cập nhật số lượng giỏ hàng và yêu thích:", error);
    }
}

updateShoppingHeaderCounts();
window.addEventListener("storage", (event) => {
    if (event.key === "cart" || event.key === "wish" || event.key === null) {
        updateShoppingHeaderCounts();
    }
});

const accountNav = document.querySelector(".signin");
if (accountNav) {
    const account = getCurrentAccount();
    const label = accountNav.querySelector("h5");

    if (account && label) {
        label.textContent = account.role === "owner"
            ? "Chủ cửa hàng"
            : account.role === "admin"
                ? "Quản trị"
                : account.name || account.email || "Tài khoản";
    }

    accountNav.setAttribute("role", "link");
    accountNav.setAttribute("tabindex", "0");
    accountNav.addEventListener("click", () => {
        const currentAccount = getCurrentAccount();
        if (!currentAccount) {
            window.location.assign("./login.html");
        } else if (currentAccount.role === "owner") {
            window.location.assign("./owner.html");
        } else if (currentAccount.role === "admin") {
            window.location.assign("./admin.html");
        } else {
            window.location.assign("./account.html");
        }
    });
    accountNav.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            accountNav.click();
        }
    });
}
