let products = []
let cart = []
let wish = []
let Total = document.getElementById("cartTotal")
let WishTotal = document.getElementById("wishTotal")
let container = document.getElementById("container")
let searchButton = document.getElementById("sbtn")
let searchInput = document.getElementById("search")
let actionMessage = document.getElementById("shopping-action-message")
const relatedFlowersSection = document.getElementById("related-flowers")
const relatedFlowersStatus = document.getElementById("related-flowers-status")
const relatedFlowersGrid = document.getElementById("related-flowers-grid")

function showShoppingFeedback(title, icon, detail = "") {
  actionMessage.textContent = detail || title
  actionMessage.hidden = false
  actionMessage.classList.toggle("is-error", icon === "error")
}

function showShoppingError(error) {
  console.error("Không thể cập nhật giỏ hàng hoặc yêu thích:", error)
  showShoppingFeedback("Chưa thể hoàn tất thao tác", "error", error.message || "Vui lòng thử lại.")
}

function updateProductStructuredData(product, productName, productDescription) {
  const baseUrl = "https://flower-com-six.vercel.app"
  const canonicalUrl = `${baseUrl}/product.html?id=${encodeURIComponent(product.id)}`
  const imageUrl = product.image
    ? new URL(product.image, window.location.href).href
    : `${baseUrl}/images/flowerflow-logo.png`
  const price = Math.round(Number(product.price) || 0)
  const available = Number(product.quantity) > 0
  const descriptionMeta = document.querySelector('meta[name="description"]')
  const canonicalLink = document.querySelector('link[rel="canonical"]')
  const structuredData = document.getElementById("catalog-structured-data")
  document.title = `${productName} | Hoa tươi Flowerflow`
  if (descriptionMeta) descriptionMeta.content = productDescription
  if (canonicalLink) canonicalLink.href = canonicalUrl
  document.querySelector('meta[property="og:type"]')?.setAttribute("content", "product")
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title)
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", productDescription)
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl)
  document.querySelector('meta[property="og:image"]')?.setAttribute("content", imageUrl)
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", document.title)
  document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", productDescription)
  document.querySelector('meta[name="twitter:image"]')?.setAttribute("content", imageUrl)
  if (structuredData) {
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: productName,
      description: productDescription,
      image: [imageUrl],
      sku: String(product.id),
      brand: { "@type": "Brand", name: "Flowerflow" },
      offers: {
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "VND",
        price: price,
        availability: `https://schema.org/${available ? "InStock" : "OutOfStock"}`,
        itemCondition: "https://schema.org/NewCondition"
      }
    }).replace(/</g, "\\u003c")
  }
}

function updateShoppingCounts() {
  Total.textContent = cart.length
  if (WishTotal) WishTotal.textContent = wish.length
  document.querySelectorAll(".favorite-count").forEach((count) => {
    count.textContent = String(wish.length)
  })
}

function updateCatalogStructuredData(catalog) {
  const structuredData = document.getElementById("catalog-structured-data")
  if (!structuredData || new URLSearchParams(window.location.search).has("id")) return
  structuredData.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Danh sách hoa tươi Flowerflow",
    url: "https://flower-com-six.vercel.app/product.html",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: catalog.length,
    itemListElement: catalog.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: getVietnameseProductName(product.title || "Sản phẩm hoa"),
      url: `https://flower-com-six.vercel.app/product.html?id=${encodeURIComponent(product.id)}`
    }))
  }).replace(/</g, "\\u003c")
}

try {
  cart = FlowerShoppingStore.readCart()
  wish = FlowerShoppingStore.readWishlist()
} catch (error) {
  console.error("Không thể tải giỏ hàng hoặc danh sách yêu thích:", error)
  actionMessage.textContent = error.message
  actionMessage.hidden = false
  actionMessage.classList.add("is-error")
}
updateShoppingCounts()

function isProductWished(product) {
  return wish.some((item) => String(item.id) === String(product.id))
}

function updateWishlistButton(button, product) {
  const isWished = isProductWished(product)
  button.classList.toggle("is-wished", isWished)
  button.setAttribute("aria-pressed", String(isWished))
  button.textContent = isWished ? "♥ Đã yêu thích" : "♡ Thêm vào yêu thích"
}

function refreshWishlistButtons() {
  document.querySelectorAll(".product-wishlist[data-product-id]").forEach((button) => {
    const product = products.find((item) => String(item.id) === button.dataset.productId)
    if (product) updateWishlistButton(button, product)
  })
  document.querySelectorAll(".related-flower-favorite[data-product-id]").forEach((button) => {
    const product = products.find((item) => String(item.id) === button.dataset.productId)
    if (!product) return
    const isWished = isProductWished(product)
    button.classList.toggle("is-wished", isWished)
    button.setAttribute("aria-pressed", String(isWished))
    button.setAttribute("aria-label", `${isWished ? "Bỏ yêu thích" : "Thêm vào yêu thích"}: ${getVietnameseProductName(product.title)}`)
    button.textContent = isWished ? "♥" : "♡"
  })
  if (selectedProduct) updateWishlistButton(document.getElementById("detail-wishlist"), selectedProduct)
}

function toggleProductWishlist(product) {
  try {
    const result = FlowerShoppingStore.toggleWishlist(product)
    wish = result.wishlist
    updateShoppingCounts()
    refreshWishlistButtons()
    showShoppingFeedback(
      result.added ? "Đã thêm vào yêu thích" : "Đã xóa khỏi yêu thích",
      "success"
    )
  } catch (error) {
    showShoppingError(error)
  }
}

function addProductToCart(product, quantity = 1) {
  try {
    cart = FlowerShoppingStore.addToCart(product, quantity)
    updateShoppingCounts()
    showShoppingFeedback("Đã thêm vào giỏ hàng", "success")
    return true
  } catch (error) {
    showShoppingError(error)
    return false
  }
}


function display(data) {

    container.replaceChildren()

    if (!data.length) {
      const emptyState = document.createElement("p")
      emptyState.className = "catalog-empty"
      emptyState.textContent = "Không tìm thấy sản phẩm phù hợp."
      container.append(emptyState)
      return
    }

    const cards = document.createDocumentFragment()
    data.forEach((el, index) => {

        const productName = getVietnameseProductName(el.title || "Sản phẩm hoa")
        const box = document.createElement("article")
        const imageFrame = document.createElement("div")
        let img = document.createElement("img")
        let title = document.createElement("h2")
        let price = document.createElement("p")
        let stock = document.createElement("p")
        let actions = document.createElement("div")
        let badges = document.createElement("div")
        let detailsButton = document.createElement("a")
        let orderButton = document.createElement("button")
        let cartButton = document.createElement("button")
        let wishlistButton = document.createElement("button")
        const quantity = Math.max(0, Number(el.quantity) || 0)

        imageFrame.className = "product-image"
        img.src = el.image || ""
        img.alt = productName
        img.width = 420
        img.height = 315
        img.loading = index === 0 ? "eager" : "lazy"
        if (index === 0) img.fetchPriority = "high"
        img.decoding = "async"
        img.addEventListener("error", () => {
          img.hidden = true
          imageFrame.classList.add("image-unavailable")
          imageFrame.setAttribute("aria-label", `Ảnh ${productName} hiện không khả dụng`)
        }, { once: true })
        title.innerText = productName
        price.className = "product-price"
        price.innerText = formatVnd(el.price)
        stock.className = quantity > 0 ? "stock-status" : "stock-status out-of-stock"
        stock.innerText = quantity > 0 ? `Còn hàng: ${quantity}` : "Hết hàng"
        badges.className = "product-badges"
        if (el.onSale) {
          const saleBadge = document.createElement("span")
          saleBadge.className = "product-badge product-badge--sale"
          saleBadge.textContent = "Ưu đãi"
          badges.append(saleBadge)
        }
        if (el.sameDayDelivery) {
          const deliveryBadge = document.createElement("span")
          deliveryBadge.className = "product-badge product-badge--delivery"
          deliveryBadge.textContent = "Giao trong ngày"
          badges.append(deliveryBadge)
        }
        orderButton.type = "button"
        orderButton.className = "product-order"
        orderButton.innerText = "Đặt hàng"
        orderButton.disabled = quantity === 0
        cartButton.type = "button"
        cartButton.className = "product-add-to-cart"
        cartButton.innerText = "Thêm vào giỏ"
        cartButton.disabled = quantity === 0
        wishlistButton.type = "button"
        wishlistButton.className = "product-wishlist"
        wishlistButton.dataset.productId = String(el.id)
        updateWishlistButton(wishlistButton, el)
        detailsButton.className = "product-view-details"
        detailsButton.href = `./product.html?id=${encodeURIComponent(el.id)}`
        detailsButton.textContent = "Xem chi tiết"

        box.className = "box product-card"
        actions.className = "product-actions"

        cartButton.addEventListener("click", () => {
          addProductToCart(el)
        })

        orderButton.addEventListener("click", () => {
          if (addProductToCart(el)) window.location.assign("./checkout.html")
        })

        wishlistButton.addEventListener("click", () => {
          toggleProductWishlist(el)
        })

        imageFrame.append(img)
        actions.append(orderButton, cartButton, wishlistButton, detailsButton)
        box.append(imageFrame, title)
        if (badges.childElementCount) box.append(badges)
        box.append(price, stock, actions)
        cards.append(box)
    });
    container.append(cards)
}

function setRelatedFlowersStatus(message, state = "") {
  relatedFlowersStatus.textContent = message
  relatedFlowersStatus.hidden = !message
  relatedFlowersStatus.className = `related-flowers-status${state ? ` is-${state}` : ""}`
  relatedFlowersGrid.replaceChildren()
}

function createRelatedFlowerCard(product) {
  const card = document.createElement("article")
  const imageLink = document.createElement("a")
  const imageFrame = document.createElement("div")
  const fallback = document.createElement("span")
  const image = document.createElement("img")
  const content = document.createElement("div")
  const name = document.createElement("h3")
  const price = document.createElement("p")
  const stock = document.createElement("p")
  const actions = document.createElement("div")
  const detailLink = document.createElement("a")
  const favoriteButton = document.createElement("button")
  const productName = getVietnameseProductName(product.title || "Sản phẩm hoa")
  const isAvailable = Number(product.quantity) > 0
  const productUrl = `./product.html?id=${encodeURIComponent(product.id)}`

  card.className = "related-flower-card"
  imageLink.className = "related-flower-image-link"
  imageLink.href = productUrl
  imageLink.setAttribute("aria-label", `Xem ${productName}`)
  imageFrame.className = "related-flower-image"
  fallback.className = "related-flower-image-fallback"
  fallback.setAttribute("aria-hidden", "true")
  fallback.textContent = "✿"
  image.src = product.image || ""
  image.alt = productName
  image.width = 420
  image.height = 315
  image.loading = "lazy"
  image.decoding = "async"
  image.addEventListener("error", () => {
    image.hidden = true
    imageFrame.classList.add("image-unavailable")
  }, { once: true })
  if (!product.image) {
    image.hidden = true
    imageFrame.classList.add("image-unavailable")
  }
  imageFrame.append(image, fallback)
  imageLink.append(imageFrame)

  content.className = "related-flower-content"
  name.textContent = productName
  price.className = "related-flower-price"
  price.textContent = formatVnd(product.price)
  stock.className = `related-flower-stock${isAvailable ? "" : " out-of-stock"}`
  stock.textContent = isAvailable ? "Còn hàng" : "Tạm hết hàng"
  actions.className = "related-flower-actions"
  detailLink.className = "related-flower-details"
  detailLink.href = productUrl
  detailLink.textContent = "Xem sản phẩm"
  favoriteButton.type = "button"
  favoriteButton.className = "related-flower-favorite"
  favoriteButton.dataset.productId = String(product.id)
  favoriteButton.setAttribute("aria-label", `${isProductWished(product) ? "Bỏ yêu thích" : "Thêm vào yêu thích"}: ${productName}`)
  favoriteButton.setAttribute("aria-pressed", String(isProductWished(product)))
  favoriteButton.textContent = isProductWished(product) ? "♥" : "♡"
  favoriteButton.addEventListener("click", () => {
    toggleProductWishlist(product)
    const isWished = isProductWished(product)
    favoriteButton.setAttribute("aria-label", `${isWished ? "Bỏ yêu thích" : "Thêm vào yêu thích"}: ${productName}`)
    favoriteButton.setAttribute("aria-pressed", String(isWished))
    favoriteButton.textContent = isWished ? "♥" : "♡"
  })
  actions.append(detailLink, favoriteButton)
  content.append(name, price, stock, actions)
  card.append(imageLink, content)
  return card
}

function renderRelatedFlowers(product) {
  relatedFlowersSection.hidden = false
  relatedFlowersGrid.replaceChildren()
  relatedFlowersStatus.hidden = true

  const relatedProducts = FlowerRelatedProducts.getRelatedProducts(products, product, 4)
  if (!relatedProducts.length) {
    setRelatedFlowersStatus(
      products.length
        ? "Hiện chưa có mẫu hoa liên quan. Hãy xem toàn bộ danh mục để khám phá thêm."
        : "Chưa có dữ liệu hoa để gợi ý. Vui lòng thử tải lại trang.",
      products.length ? "empty" : "error"
    )
    return
  }

  relatedProducts.forEach((relatedProduct) => {
    relatedFlowersGrid.append(createRelatedFlowerCard(relatedProduct))
  })
}

const sortSelect = document.querySelector(".arrange")
const flowerTypeSelect = document.getElementById("flower-type")
const priceFilterSelect = document.getElementById("price-filter")
const colorFilterSelect = document.getElementById("color-filter")
const occasionFilterSelect = document.getElementById("occasion-filter")
const detailPage = document.getElementById("product-detail")
const productPage = document.querySelector(".product-page")
const detailQuantity = document.getElementById("detail-quantity")
const detailQuantityError = document.getElementById("detail-quantity-error")
let selectedProduct = null
let unsubscribeProductReviews = null
let subscribedReviewProductId = null
let productReviewObserver = null

function renderProductReviews(reviews) {
  const section = document.getElementById("product-reviews")
  const summary = document.getElementById("product-reviews-summary")
  const list = document.getElementById("product-reviews-list")
  const average = reviews.length
    ? (reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviews.length).toFixed(1)
    : "0"

  section.hidden = false
  summary.textContent = reviews.length
    ? `${reviews.length} đánh giá · trung bình ${average}/5 sao`
    : "Sản phẩm chưa có đánh giá. Hãy là người đầu tiên chia sẻ cảm nhận!"
  list.replaceChildren()

  reviews.forEach((review) => {
    const card = document.createElement("article")
    const meta = document.createElement("div")
    const name = document.createElement("span")
    const stars = document.createElement("span")
    const date = document.createElement("time")
    const comment = document.createElement("p")
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 0))
    const createdAt = review.createdAt?.toDate?.() || new Date(review.createdAt || "")

    card.className = "product-review-card"
    meta.className = "product-review-meta"
    name.className = "product-review-name"
    name.textContent = review.customerName || "Khách hàng"
    stars.className = "product-review-stars"
    stars.setAttribute("aria-label", `${rating} trên 5 sao`)
    stars.textContent = `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`
    date.textContent = Number.isNaN(createdAt.getTime())
      ? ""
      : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(createdAt)
    if (!Number.isNaN(createdAt.getTime())) date.dateTime = createdAt.toISOString()
    comment.className = "product-review-comment"
    comment.textContent = review.comment || ""
    meta.append(name, stars, date)
    card.append(meta, comment)
    if (review.verifiedPurchase === true) {
      const verified = document.createElement("p")
      verified.className = "review-verified"
      verified.textContent = "Đã mua hàng"
      card.append(verified)
    }
    if (Array.isArray(review.photoIds) && review.photoIds.length) {
      const photos = document.createElement("div")
      photos.className = "review-photos"
      review.photoIds.forEach((id, index) => {
        const link = document.createElement("a")
        link.href = window.FlowerReviewStore.photoUrl(id)
        link.target = "_blank"
        link.rel = "noopener"
        link.setAttribute("aria-label", `Xem ảnh đánh giá ${index + 1}`)
        const image = document.createElement("img")
        image.src = link.href
        image.alt = `Ảnh khách hàng sau mua ${index + 1}`
        image.loading = "lazy"
        image.width = 120
        image.height = 120
        link.append(image)
        photos.append(link)
      })
      card.append(photos)
    }
    const replyText = String(review.reply || "").trim()
    if (replyText) {
      const reply = document.createElement("p")
      const replyLabel = document.createElement("strong")
      reply.className = "product-review-reply"
      replyLabel.textContent = "Phản hồi từ Flowerflow: "
      reply.append(replyLabel, document.createTextNode(replyText))
      card.append(reply)
    }
    list.append(card)
  })
}

function watchProductReviews(product) {
  const section = document.getElementById("product-reviews")
  const summary = document.getElementById("product-reviews-summary")
  const productId = String(product.id)
  section.hidden = false
  if (subscribedReviewProductId === productId) return

  if (unsubscribeProductReviews) unsubscribeProductReviews()
  if (productReviewObserver) productReviewObserver.disconnect()
  productReviewObserver = null
  subscribedReviewProductId = productId
  summary.textContent = "Đánh giá sẽ tải khi bạn đến mục này."
  if (!window.FlowerReviewStore) {
    summary.textContent = "Chưa thể kết nối tới dịch vụ đánh giá."
    return
  }

  const subscribe = () => {
    if (subscribedReviewProductId !== productId) return
    unsubscribeProductReviews = window.FlowerReviewStore.subscribe(productId, renderProductReviews, () => {
      summary.textContent = "Chưa thể tải đánh giá lúc này. Vui lòng tải lại trang."
    })
  }
  if (typeof window.IntersectionObserver === "function") {
    productReviewObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      productReviewObserver.disconnect()
      productReviewObserver = null
      subscribe()
    }, { rootMargin: "200px" })
    productReviewObserver.observe(section)
  } else {
    window.setTimeout(subscribe, 3000)
  }
}

const pageParams = new URLSearchParams(window.location.search)
const initialSearch = pageParams.get("search") || pageParams.get("q") || ""
const initialFlowerType = pageParams.get("flower") || ""
const initialCategoryKey = pageParams.get("category") || ""
const initialCategory = FlowerProductCategories.getCategory(initialCategoryKey)
let initialCategoryApplied = false

if (initialSearch) searchInput.value = initialSearch
if (initialCategory) {
  document.getElementById("catalog-title").textContent = initialCategory.title
  document.querySelector(".catalog-heading > p:last-child").textContent = initialCategory.description
}

const flowerCategoryLabels = {
  rose: "Hoa hồng",
  orchid: "Hoa lan",
  lily: "Hoa ly",
  lavender: "Hoa oải hương",
  gerber: "Hoa đồng tiền",
  tulip: "Hoa tulip",
  hydrangea: "Hoa cẩm tú cầu",
  peony: "Hoa mẫu đơn",
  carnation: "Hoa cẩm chướng",
  sunflower: "Hoa hướng dương",
  babyBreath: "Hoa bi",
  iris: "Hoa diên vĩ",
  mixed: "Hoa tổng hợp"
}

// ?flower=rose etc. from the homepage, menu and footer; cleared when the shopper picks
// another category from the filter.
let activeFlowerType = Object.prototype.hasOwnProperty.call(flowerCategoryLabels, initialFlowerType) ? initialFlowerType : ""
if (activeFlowerType && !initialCategory) {
  document.getElementById("catalog-title").textContent = flowerCategoryLabels[activeFlowerType]
}

function getAdminCategories() {
  return FlowerInventory.readCategories()
}

// Occasions the admin set on products appear in the filter next to the usual ones (#30).
function populateOccasionFilter() {
  const wanted = FlowerCatalogSearch.normalize(occasionFilterSelect.value || pageParams.get("occasion") || "")
  occasionFilterSelect.replaceChildren(new Option("Mọi dịp", ""))
  FlowerCatalogSearch.occasionOptions(products).forEach((label) => occasionFilterSelect.append(new Option(label, label.toLocaleLowerCase("vi"))))
  const match = [...occasionFilterSelect.options].find((option) => option.value && FlowerCatalogSearch.normalize(option.value) === wanted)
  occasionFilterSelect.value = match ? match.value : ""
}

function populateFlowerCategoryFilter() {
  populateOccasionFilter()
  const selectedValue = flowerTypeSelect.value
  const allCategoriesOption = document.createElement("option")
  allCategoriesOption.value = ""
  allCategoriesOption.textContent = "Tất cả phân loại"
  const categories = [...new Set([
    ...getAdminCategories(),
    ...products.map((product) => String(product.category || "").trim())
  ].filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, "vi"))

  flowerTypeSelect.replaceChildren(allCategoriesOption)
  categories.forEach((category) => {
    const option = document.createElement("option")
    option.value = `category:${category}`
    option.textContent = category
    flowerTypeSelect.append(option)
  })

  if ([...flowerTypeSelect.options].some((option) => option.value === selectedValue)) {
    flowerTypeSelect.value = selectedValue
  }

  const species = document.createElement("optgroup")
  species.label = "Loài hoa"
  Object.entries(FlowerCatalogSearch.flowers).forEach(([id, labels]) => {
    const option = new Option(labels[0], id)
    species.append(option)
  })
  flowerTypeSelect.append(species)
  species.append(new Option("Hoa phối nhiều loài", "mixed"))
  const requested = initialCategoryApplied ? selectedValue : initialFlowerType
  const matching = [...flowerTypeSelect.options].find((option) => option.value === requested)
    || [...flowerTypeSelect.options].find((option) => normalizeSearchText(option.textContent) === normalizeSearchText(requested))
  flowerTypeSelect.value = matching?.value || ""
  activeFlowerType = ""
  initialCategoryApplied = true
}

function getProductCategory(product) {
  if (product.category) return product.category
  const types = getFlowerTypes(product)
  return types.length === 1 ? flowerCategoryLabels[types[0]] : flowerCategoryLabels.mixed
}

function getProductImages(product) {
  return [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])]
    .filter((image) => typeof image === "string" && image.trim()))]
}

function renderProductDetail(product) {
  const mainImage = document.getElementById("detail-main-image")
  const previousImage = selectedProduct && String(selectedProduct.id) === String(product.id)
    ? mainImage.getAttribute("src")
    : ""
  selectedProduct = product
  watchProductReviews(product)
  const productName = getVietnameseProductName(product.title || "Sản phẩm hoa")
  const productDescription = getVietnameseProductDescription(product.description)
    || "Sản phẩm hoa tươi được tuyển chọn và sắp xếp chỉn chu để gửi trao những lời yêu thương."
  updateProductStructuredData(product, productName, productDescription)
  const images = getProductImages(product)
  const thumbnails = document.getElementById("detail-thumbnails")
  const stock = Math.max(0, Number(product.quantity) || 0)
  const sameProduct = previousImage !== "";
  let quantityInCart = 0
  try {
    cart = FlowerShoppingStore.readCart()
    quantityInCart = cart
      .filter((item) => String(item.productId ?? item.id) === String(product.id))
      .reduce((sum, item) => sum + Number(item.quantity ?? 1), 0)
  } catch (error) {
    showShoppingError(error)
  }
  const selectedImageIndex = Math.max(0, images.indexOf(previousImage))

  productPage.classList.add("is-detail-view")
  detailPage.hidden = false
  document.getElementById("detail-breadcrumb-name").textContent = productName
  document.getElementById("detail-name").textContent = productName
  document.getElementById("detail-category").textContent = getProductCategory(product)
  document.getElementById("detail-price").textContent = formatVnd(product.price)
  document.getElementById("detail-stock").textContent = stock > 0 ? `Còn hàng · ${stock} bó · Có thể thêm ${Math.max(0, stock - quantityInCart)} bó` : "Hiện đã hết hàng"
  document.getElementById("detail-stock").classList.toggle("out-of-stock", stock === 0)
  initializeBouquetOptions(product, sameProduct)
  document.getElementById("detail-description").textContent = productDescription

  detailQuantity.min = "1"
  // At most what is in stock, and never more than the 50 per product an order may hold.
  const orderLimit = Math.min(stock, FlowerShoppingStore.MAX_QUANTITY_PER_PRODUCT || 50)
  detailQuantity.max = String(Math.max(0, orderLimit - quantityInCart))
  detailQuantity.value = stock > 0 ? "1" : "0"
  detailQuantity.disabled = stock === 0 || quantityInCart >= orderLimit
  detailQuantityError.textContent = ""
  detailQuantity.setCustomValidity("")
  thumbnails.replaceChildren()
  mainImage.hidden = images.length === 0
  mainImage.alt = productName
  mainImage.fetchPriority = "high"
  mainImage.decoding = "async"
  mainImage.onerror = () => {
    mainImage.hidden = true
    mainImage.parentElement.classList.add("image-unavailable")
  }
  mainImage.parentElement.classList.toggle("image-unavailable", images.length === 0)
  mainImage.src = images[selectedImageIndex] || ""
  mainImage.parentElement.classList.remove("is-closeup")
  document.getElementById("detail-gallery-caption").textContent = "Ảnh toàn cảnh sản phẩm"

  images.forEach((imageUrl, index) => {
    const thumbnail = document.createElement("button")
    const image = document.createElement("img")
    thumbnail.type = "button"
    thumbnail.className = `gallery-thumbnail${index === selectedImageIndex ? " is-active" : ""}`
    thumbnail.setAttribute("aria-label", `Xem ảnh ${index + 1} của ${productName}`)
    thumbnail.setAttribute("aria-pressed", String(index === selectedImageIndex))
    image.src = imageUrl
    image.alt = ""
    image.width = 96
    image.height = 96
    image.loading = "lazy"
    image.decoding = "async"
    image.addEventListener("error", () => thumbnail.remove(), { once: true })
    thumbnail.append(image)
    thumbnail.addEventListener("click", () => {
      mainImage.parentElement.classList.remove("is-closeup")
      document.getElementById("detail-gallery-caption").textContent = `Ảnh sản phẩm ${index + 1}`
      mainImage.src = imageUrl
      mainImage.hidden = false
      mainImage.parentElement.classList.remove("image-unavailable")
      thumbnails.querySelectorAll(".gallery-thumbnail").forEach((item) => {
        const isActive = item === thumbnail
        item.classList.toggle("is-active", isActive)
        item.setAttribute("aria-pressed", String(isActive))
      })
    })
    thumbnails.append(thumbnail)
  })
  if (images.length) {
    const closeup = document.createElement("button")
    closeup.type = "button"
    closeup.className = "gallery-thumbnail gallery-closeup"
    closeup.setAttribute("aria-label", "Xem cận cảnh từ ảnh gốc")
    closeup.setAttribute("aria-pressed", "false")
    const preview = document.createElement("img")
    preview.src = images[0]
    preview.alt = "Cận cảnh"
    closeup.append(preview)
    closeup.addEventListener("click", () => {
      mainImage.src = images[0]
      mainImage.hidden = false
      mainImage.parentElement.classList.remove("image-unavailable")
      mainImage.parentElement.classList.add("is-closeup")
      document.getElementById("detail-gallery-caption").textContent = "Cận cảnh phóng to từ ảnh gốc"
      thumbnails.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", button === closeup)
        button.setAttribute("aria-pressed", String(button === closeup))
      })
    })
    thumbnails.append(closeup)
  }

  const outOfStock = stock === 0
  document.getElementById("detail-add-to-cart").disabled = outOfStock || quantityInCart >= stock
  document.getElementById("detail-buy-now").disabled = outOfStock || quantityInCart >= stock
  updateWishlistButton(document.getElementById("detail-wishlist"), product)
  document.title = `${productName} | Flowerflow`
}

function configuredBouquet() {
  const size = document.getElementById("detail-size").value || "standard"
  return { ...selectedProduct, productId: String(selectedProduct.id), size,
    color: document.getElementById("detail-color").value || "original",
    cardMessage: document.getElementById("detail-card").value.trim(),
    personalNote: document.getElementById("detail-note").value.trim(),
    price: FlowerBouquetOptions.price(selectedProduct.price, size) }
}

function updateBouquetPrice() {
  if (!selectedProduct) return
  const choice = configuredBouquet()
  document.getElementById("detail-price").textContent = formatVnd(choice.price) + " / bó"
  const quantity = Number(detailQuantity.value)
  document.getElementById("detail-selection-total").textContent = Number.isInteger(quantity) && quantity > 0
    ? "Tổng lựa chọn: " + formatVnd(choice.price * quantity) : "Nhập số lượng bó hợp lệ."
  document.getElementById("detail-text-count").textContent = "Thiệp " + document.getElementById("detail-card").value.length + "/300 · Ghi chú " + document.getElementById("detail-note").value.length + "/500 ký tự"
}

function initializeBouquetOptions(product, sameProduct) {
  if (!sameProduct) {
    for (const [id, options] of [["detail-size", FlowerBouquetOptions.sizes], ["detail-color", FlowerBouquetOptions.colors]]) {
      const select = document.getElementById(id)
      select.replaceChildren(...options.map((option) => new Option(id === "detail-size"
        ? `${option.label} · ${formatVnd(FlowerBouquetOptions.price(product.price, option.id))}` : option.label, option.id)))
    }
    document.getElementById("detail-card").value = ""
    document.getElementById("detail-note").value = ""
  }
  const meanings = {
    rose: "Hoa hồng gợi tình yêu và sự trân trọng dành cho người nhận.",
    orchid: "Hoa lan gửi lời chúc thanh lịch, may mắn và thịnh vượng.",
    lily: "Hoa ly gợi sự thanh cao và lời chúc hạnh phúc.",
    lavender: "Oải hương gợi sự bình yên và tình cảm thủy chung.",
    gerber: "Hoa đồng tiền gửi lời chúc vui vẻ và thành công.",
    tulip: "Tulip gợi tình cảm chân thành và những khởi đầu mới.",
    hydrangea: "Cẩm tú cầu gửi lời cảm ơn và sự thấu hiểu.",
    peony: "Mẫu đơn gợi sự viên mãn và lời chúc sung túc.",
    carnation: "Cẩm chướng thể hiện lòng biết ơn và tình yêu thương.",
    sunflower: "Hướng dương gửi năng lượng tích cực và niềm tin vào ngày mai.",
    babyBreath: "Hoa bi gợi sự dịu dàng và tình cảm bền lâu.",
    iris: "Diên vĩ gợi hy vọng và niềm tin."
  }
  document.getElementById("detail-meaning").textContent = product.meaning || getFlowerTypes(product).filter((type) => meanings[type]).map((type) => meanings[type]).join(" ") || "Bó hoa phối nhiều loài gửi lời chúc tươi vui, sự quan tâm và gắn kết."
}

for (const id of ["detail-size", "detail-color", "detail-card", "detail-note"]) {
  document.getElementById(id).addEventListener("input", updateBouquetPrice)
}

function showQuantityError(text) {
  detailQuantityError.textContent = text
  detailQuantity.setCustomValidity(text)
}

function getRequestedQuantity() {
  const quantity = Number(detailQuantity.value)
  if (!Number.isInteger(quantity) || quantity < 1) {
    showQuantityError("Số lượng phải là số nguyên lớn hơn 0.")
    return null
  }
  if (quantity > Number(detailQuantity.max)) {
    showQuantityError(`Chỉ có thể thêm tối đa ${detailQuantity.max} bó với tồn kho hiện tại.`)
    return null
  }
  showQuantityError("")
  return quantity
}

function navigateToProductDetail() {
  const productId = new URLSearchParams(window.location.search).get("id")
  if (!productId) {
    detailPage.hidden = true
    relatedFlowersSection.hidden = true
    relatedFlowersGrid.replaceChildren()
    productPage.classList.remove("is-detail-view")
    document.title = "Cửa hàng hoa | Flowerflow"
    return
  }
  const product = products.find((item) => String(item.id) === productId)
  if (!product) {
    detailPage.hidden = true
    relatedFlowersSection.hidden = true
    relatedFlowersGrid.replaceChildren()
    productPage.classList.remove("is-detail-view")
    container.textContent = "Không tìm thấy sản phẩm. Hãy quay lại danh sách hoa."
    return
  }
  renderProductDetail(product)
  renderRelatedFlowers(product)
}

detailQuantity.addEventListener("input", () => {
  detailQuantity.setCustomValidity("")
  detailQuantityError.textContent = ""
  updateBouquetPrice()
})

document.getElementById("detail-add-to-cart").addEventListener("click", () => {
  if (!selectedProduct) return
  const quantity = getRequestedQuantity()
  if (quantity === null) return
  if (addProductToCart(configuredBouquet(), quantity)) renderProductDetail(selectedProduct)
})

document.getElementById("detail-wishlist").addEventListener("click", () => {
  if (selectedProduct) toggleProductWishlist(selectedProduct)
})

document.getElementById("detail-buy-now").addEventListener("click", () => {
  if (!selectedProduct) return
  const quantity = getRequestedQuantity()
  if (quantity === null) return
  if (addProductToCart(configuredBouquet(), quantity)) window.location.assign("./checkout.html")
})

function normalizeSearchText(value) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
}

// Keywords are matched on title + description without Vietnamese diacritics.
const flowerTypeKeywords = {
  rose: /\b(hoa hong|bo hong|gio hong|roses?)\b/,
  orchid: /\b(hoa lan|lan ho diep|orchids?)\b/,
  lily: /\b(hoa ly|lily|lilies)\b/,
  lavender: /\b(oai huong|lavender)\b/,
  gerber: /\b(dong tien|gerberas?|gerbers?)\b/,
  tulip: /\btulips?\b/,
  hydrangea: /\b(cam tu cau|hydrangeas?)\b/,
  peony: /\b(mau don|peony|peonies)\b/,
  carnation: /\b(cam chuong|carnations?)\b/,
  sunflower: /\b(huong duong|sunflowers?)\b/,
  babyBreath: /\b(hoa bi|baby'?s breath|gypsophila)\b/,
  iris: /\b(dien vi|iris|irises)\b/
}

// Flower species found in a product; a bouquet with zero or several species is "mixed".
function getFlowerTypes(product) {
  const productDetails = normalizeSearchText(`${product.title} ${product.description}`)
  const types = Object.keys(flowerTypeKeywords).filter((type) => flowerTypeKeywords[type].test(productDetails))
  return types.length === 1 ? types : [...types, "mixed"]
}

function getCatalogResults() {
  const minInput = document.getElementById("price-min")
  const maxInput = document.getElementById("price-max")
  const number = (input) => input.value === "" ? undefined : Number(input.value)
  let min = number(minInput)
  let max = number(maxInput)
  const valid = [min, max].every((value) => value === undefined || (Number.isSafeInteger(value) && value >= 0))
    && (min === undefined || max === undefined || min <= max) && !minInput.validity.badInput && !maxInput.validity.badInput
  const error = valid ? "" : "Nhập khoảng giá VND hợp lệ: giá từ không được lớn hơn giá đến."
  document.getElementById("price-range-error").textContent = error
  minInput.setAttribute("aria-invalid", String(!valid))
  maxInput.setAttribute("aria-invalid", String(!valid))
  if (min === undefined && max === undefined) {
    if (priceFilterSelect.value === "price-under-1500000") max = 1499999
    if (priceFilterSelect.value === "price-1500000-2000000") { min = 1500000; max = 1999999 }
    if (priceFilterSelect.value === "price-over-2000000") min = 2000000
  }
  const filters = { query: searchInput.value, flower: flowerTypeSelect.value, min, max,
    color: colorFilterSelect.value, occasion: occasionFilterSelect.value, sort: sortSelect.value }
  if (!initialCategory) document.getElementById("catalog-title").textContent = filters.flower
    ? flowerTypeSelect.selectedOptions[0].textContent : "Hoa tươi dành cho bạn"
  const params = new URLSearchParams(window.location.search)
  params.delete("search")
  for (const [key, value] of Object.entries({ q: filters.query.trim(), flower: filters.flower,
    min: minInput.value, max: maxInput.value, price: priceFilterSelect.value,
    color: filters.color, occasion: filters.occasion, sort: filters.sort })) {
    if (value) params.set(key, value); else params.delete(key)
  }
  const query = params.toString()
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash)
  const candidates = products.filter((product) => FlowerProductCategories.matchesCategory(product, initialCategoryKey))
  const result = valid ? FlowerCatalogSearch.search(candidates, filters, (product) => getVietnameseProductName(product.title)) : []
  document.getElementById("catalog-results-count").textContent = valid
    ? `${result.length} / ${products.length} sản phẩm phù hợp` : "Khoảng giá chưa hợp lệ"
  document.getElementById("catalog-sort-note").textContent = filters.sort === "popular"
    ? products.some((product) => Number(product.soldCount) > 0)
      ? "Xếp theo số bó đã giao thành công được ghi nhận."
      : "Chưa có số liệu bán hàng; sản phẩm tạm được xếp theo tên."
    : ""
  return result
}

for (const id of ["price-min", "price-max"]) {
  document.getElementById(id).addEventListener("input", () => { priceFilterSelect.value = ""; renderProducts() })
}
for (const [id, key] of [["price-min", "min"], ["price-max", "max"], ["price-filter", "price"],
  ["color-filter", "color"], ["occasion-filter", "occasion"], ["sort", "sort"]]) {
  const input = document.getElementById(id)
  const value = pageParams.get(key)
  if (value !== null && (input.tagName !== "SELECT" || [...input.options].some((option) => option.value === value))) input.value = value
}

function renderProducts() {
  updateCatalogStructuredData(products)
  const visibleProducts = getCatalogResults()
  if (!visibleProducts.length) {
    const emptyMessage = document.createElement("p")
    emptyMessage.className = "catalog-empty"
    emptyMessage.textContent = "Không tìm thấy sản phẩm phù hợp. Hãy thử tên hoặc loại hoa khác, mở rộng khoảng giá hoặc xóa bộ lọc."
    container.replaceChildren(emptyMessage)
    const allProductsLink = document.createElement("a")
    allProductsLink.className = "catalog-empty-link"
    allProductsLink.href = "./product.html"
    allProductsLink.textContent = "Xem tất cả sản phẩm"
    container.append(allProductsLink)
    return
  }

  display(visibleProducts)
  navigateToProductDetail()
}

sortSelect.addEventListener("change", renderProducts)
flowerTypeSelect.addEventListener("change", () => {
  activeFlowerType = ""
  renderProducts()
})
priceFilterSelect.addEventListener("change", () => {
  document.getElementById("price-min").value = ""
  document.getElementById("price-max").value = ""
  renderProducts()
})
colorFilterSelect.addEventListener("change", renderProducts)
occasionFilterSelect.addEventListener("change", renderProducts)
function searchCatalog() {
  const params = new URLSearchParams(window.location.search)
  if (params.has("id")) {
    params.delete("id")
    const query = params.toString()
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""))
    detailPage.hidden = true
    relatedFlowersSection.hidden = true
    productPage.classList.remove("is-detail-view")
    document.title = "Cửa hàng hoa | Flowerflow"
  }
  renderProducts()
}
document.querySelector(".search-form").addEventListener("submit", (event) => { event.preventDefault(); searchCatalog() })
searchInput.addEventListener("input", searchCatalog)

window.addEventListener("storage", (event) => {
  if (event.key === "flowerInventory") {
    products = FlowerInventory.readProducts().filter((product) => product.status !== "hidden")
    populateFlowerCategoryFilter()
    renderProducts()
    navigateToProductDetail()
  }
  if (event.key === "flowerCategories") {
    populateFlowerCategoryFilter()
    renderProducts()
  }
  if (event.key === "cart" || event.key === "wish") {
    try {
      cart = FlowerShoppingStore.readCart()
      wish = FlowerShoppingStore.readWishlist()
      updateShoppingCounts()
      refreshWishlistButtons()
      if (selectedProduct) renderProductDetail(selectedProduct)
    } catch (error) {
      showShoppingError(error)
    }
  }
})

window.addEventListener("flowerinventorychange", (event) => {
  products = (event.detail || FlowerInventory.readProducts()).filter((product) => product.status !== "hidden")
  populateFlowerCategoryFilter()
  renderProducts()
  navigateToProductDetail()
})

window.addEventListener("flowercategorieschange", () => {
  populateFlowerCategoryFilter()
  renderProducts()
})

async function fetchAndRenderProducts() {
  const requestedProductId = new URLSearchParams(window.location.search).get("id")
  if (requestedProductId) {
    relatedFlowersSection.hidden = false
    setRelatedFlowersStatus("Đang tìm những bó hoa phù hợp...", "loading")
  }
  try {
    products = (await FlowerInventory.initialize()).filter((product) => product.status !== "hidden")
    if (!products.length) throw new Error("Kho sản phẩm hiện chưa có dữ liệu hoặc dịch vụ danh mục đang không khả dụng.")
    populateFlowerCategoryFilter()
    renderProducts()
    navigateToProductDetail()
  } catch (error) {
    console.error("Không thể tải danh sách hoa:", error)
    container.textContent = "Chưa thể tải danh sách sản phẩm. Vui lòng tải lại trang."
    if (requestedProductId) {
      setRelatedFlowersStatus("Chưa thể tải gợi ý hoa lúc này. Vui lòng tải lại trang.", "error")
    }
  }
}

fetchAndRenderProducts()
