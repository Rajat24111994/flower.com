(function addStoreFooter() {
  if (document.querySelector(".store-footer")) return;
  const isCheckoutPage = window.location.pathname.endsWith("/checkout.html");
  const storeFooter = document.createElement("footer");
  storeFooter.id = "footer";
  storeFooter.className = `store-footer${isCheckoutPage ? " store-footer--checkout" : ""}`;
  storeFooter.innerHTML = isCheckoutPage ? `
  <div class="store-footer-main">
    <div class="store-footer-brand">
      <a class="store-footer-logo" href="./index.html" aria-label="Flowerflow - Trang chủ">
        <img src="./images/flowerflow-logo.png" alt="">
        <span>flowerflow</span>
      </a>
      <p>Chọn một bó hoa thật đẹp để gửi lời yêu thương đến người bạn quý mến.</p>
      <a class="store-footer-email" href="mailto:hello@flowerflow.vn">hello@flowerflow.vn</a>
    </div>
    <nav class="store-footer-column" aria-label="Mua sắm">
      <h2>Mua sắm</h2>
      <a href="./product.html">Tất cả sản phẩm</a>
      <a href="./product.html?flower=rose">Hoa hồng</a>
      <a href="./product.html?flower=orchid">Hoa lan</a>
      <a href="./product.html?flower=mixed">Hoa tổng hợp</a>
    </nav>
    <nav class="store-footer-column" aria-label="Hỗ trợ">
      <h2>Hỗ trợ</h2>
      <a href="./tracking.html">Theo dõi đơn hàng</a>
      <a href="./account.html">Tài khoản của tôi</a>
      <a href="./login.html">Đăng nhập</a>
      <a href="mailto:hello@flowerflow.vn">Liên hệ với chúng tôi</a>
    </nav>
    <div class="store-footer-help">
      <h2>Cần giúp chọn hoa?</h2>
      <p>Chúng tôi sẵn lòng tư vấn để bạn chọn được món quà phù hợp.</p>
      <a class="store-footer-email" href="mailto:hello@flowerflow.vn">Nhắn Flowerflow <span aria-hidden="true">→</span></a>
    </div>
  </div>
  <div class="store-footer-bottom">
    <span>© <span data-store-footer-year></span> Flowerflow. Trao hoa, gửi yêu thương.</span>
    <a href="./index.html#top">Về đầu trang ↑</a>
  </div>
  ` : `
  <div class="store-footer-main">
    <div class="store-footer-brand">
      <a class="store-footer-logo" href="./index.html" aria-label="Flowerflow - Trang chủ">
        <img src="./images/flowerflow-logo.png" alt="">
        <span>flowerflow</span>
      </a>
      <p>Gửi hoa tươi, gửi những điều chưa kịp nói. Cảm ơn bạn đã để Flowerflow góp mặt trong khoảnh khắc của mình.</p>
      <a class="store-footer-email" href="mailto:hello@flowerflow.vn">hello@flowerflow.vn</a>
    </div>
    <nav class="store-footer-column" aria-label="Mua sắm">
      <h2>Mua sắm</h2>
      <a href="./product.html">Tất cả sản phẩm</a>
      <a href="./product.html?flower=rose">Hoa hồng</a>
      <a href="./product.html?flower=orchid">Hoa lan</a>
      <a href="./product.html?flower=mixed">Hoa tổng hợp</a>
    </nav>
    <nav class="store-footer-column" aria-label="Hỗ trợ">
      <h2>Hỗ trợ</h2>
      <a href="./tracking.html">Theo dõi đơn hàng</a>
      <a href="./account.html">Tài khoản của tôi</a>
      <a href="./login.html">Đăng nhập</a>
      <a href="mailto:hello@flowerflow.vn">Liên hệ với chúng tôi</a>
    </nav>
    <div class="store-footer-help">
      <h2>Cần giúp chọn hoa?</h2>
      <p>Chúng tôi sẵn lòng cùng bạn tìm món quà phù hợp cho người thương.</p>
      <a class="store-footer-email" href="mailto:hello@flowerflow.vn">Nhắn Flowerflow <span aria-hidden="true">→</span></a>
    </div>
  </div>
  <div class="store-footer-bottom">
    <span>© <span data-store-footer-year></span> Flowerflow. Trao hoa, gửi yêu thương.</span>
    <a href="./index.html#top">Về đầu trang ↑</a>
  </div>
  `;
  const year = storeFooter.querySelector("[data-store-footer-year]");
  if (year) year.textContent = String(new Date().getFullYear());
  document.body.append(storeFooter);
})();
