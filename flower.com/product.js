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
  actionMessage.textContent = detail
  actionMessage.hidden = !detail
  actionMessage.classList.toggle("is-error", icon === "error")
  if (typeof Swal !== "undefined") {
    Swal.fire({
      position: "center",
      icon,
      title,
      text: detail,
      showConfirmButton: false,
      timer: 1800
    })
  }
}

function showShoppingError(error) {
  console.error("Không thể cập nhật giỏ hàng hoặc yêu thích:", error)
  showShoppingFeedback("Chưa thể hoàn tất thao tác", "error", error.message || "Vui lòng thử lại.")
}

function updateShoppingCounts() {
  Total.textContent = cart.length
  if (WishTotal) WishTotal.textContent = wish.length
  document.querySelectorAll(".favorite-count").forEach((count) => {
    count.textContent = String(wish.length)
  })
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

    container.innerHTML = ""

    if (!data.length) {
      const emptyState = document.createElement("p")
      emptyState.className = "catalog-empty"
      emptyState.textContent = "Không tìm thấy sản phẩm phù hợp."
      container.append(emptyState)
      return
    }

    data.forEach((el) => {

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
        img.loading = "lazy"
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
        container.append(box)
    });

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
  image.loading = "lazy"
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
const detailPage = document.getElementById("product-detail")
const productPage = document.querySelector(".product-page")
const detailQuantity = document.getElementById("detail-quantity")
const detailQuantityError = document.getElementById("detail-quantity-error")
let selectedProduct = null
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
  mixed: "Hoa tổng hợp"
}

function getAdminCategories() {
  try {
    const categories = JSON.parse(localStorage.getItem("flowerCategories") || "[]")
    return Array.isArray(categories)
      ? categories.map((category) => String(category || "").trim()).filter(Boolean)
      : []
  } catch (error) {
    console.error("Không thể tải danh sách phân loại:", error)
    return []
  }
}

function populateFlowerCategoryFilter() {
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

  if (!initialCategoryApplied) {
    const requestedCategory = initialFlowerType.startsWith("category:")
      ? initialFlowerType.slice("category:".length)
      : flowerCategoryLabels[initialFlowerType] || initialFlowerType
    const matchingOption = [...flowerTypeSelect.options].find((option) =>
      option.value.startsWith("category:")
      && normalizeSearchText(option.textContent) === normalizeSearchText(requestedCategory)
    )
    if (matchingOption) {
      flowerTypeSelect.value = matchingOption.value
      initialCategoryApplied = true
    } else if (!initialFlowerType) {
      initialCategoryApplied = true
    }
  }
}

function getProductCategory(product) {
  if (product.category) return product.category
  return flowerCategoryLabels[getFlowerTypes(product)[0]] || flowerCategoryLabels.mixed
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
  const productName = getVietnameseProductName(product.title || "Sản phẩm hoa")
  const images = getProductImages(product)
  const thumbnails = document.getElementById("detail-thumbnails")
  const stock = Math.max(0, Number(product.quantity) || 0)
  let quantityInCart = 0
  try {
    cart = FlowerShoppingStore.readCart()
    quantityInCart = cart
      .filter((item) => String(item.id) === String(product.id))
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
  document.getElementById("detail-stock").textContent = stock > 0 ? `Còn hàng · ${stock} sản phẩm` : "Hiện đã hết hàng"
  document.getElementById("detail-stock").classList.toggle("out-of-stock", stock === 0)
  document.getElementById("detail-description").textContent = product.description || "Sản phẩm hoa tươi được tuyển chọn và sắp xếp chỉn chu để gửi trao những lời yêu thương."

  detailQuantity.min = "1"
  detailQuantity.max = String(Math.max(0, stock - quantityInCart))
  detailQuantity.value = stock > 0 ? "1" : "0"
  detailQuantity.disabled = stock === 0 || quantityInCart >= stock
  detailQuantityError.textContent = ""
  thumbnails.replaceChildren()
  mainImage.hidden = images.length === 0
  mainImage.alt = productName
  mainImage.onerror = () => {
    mainImage.hidden = true
    mainImage.parentElement.classList.add("image-unavailable")
  }
  mainImage.parentElement.classList.toggle("image-unavailable", images.length === 0)
  mainImage.src = images[selectedImageIndex] || ""

  images.forEach((imageUrl, index) => {
    const thumbnail = document.createElement("button")
    const image = document.createElement("img")
    thumbnail.type = "button"
    thumbnail.className = `gallery-thumbnail${index === selectedImageIndex ? " is-active" : ""}`
    thumbnail.setAttribute("aria-label", `Xem ảnh ${index + 1} của ${productName}`)
    thumbnail.setAttribute("aria-pressed", String(index === selectedImageIndex))
    image.src = imageUrl
    image.alt = ""
    image.loading = "lazy"
    image.addEventListener("error", () => thumbnail.remove(), { once: true })
    thumbnail.append(image)
    thumbnail.addEventListener("click", () => {
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

  const outOfStock = stock === 0
  document.getElementById("detail-add-to-cart").disabled = outOfStock || quantityInCart >= stock
  document.getElementById("detail-buy-now").disabled = outOfStock || quantityInCart >= stock
  updateWishlistButton(document.getElementById("detail-wishlist"), product)
  document.title = `${productName} | Flowerflow`
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
})

document.getElementById("detail-add-to-cart").addEventListener("click", () => {
  if (!selectedProduct) return
  const quantity = getRequestedQuantity()
  if (quantity === null) return
  if (addProductToCart(selectedProduct, quantity)) renderProductDetail(selectedProduct)
})

document.getElementById("detail-wishlist").addEventListener("click", () => {
  if (selectedProduct) toggleProductWishlist(selectedProduct)
})

document.getElementById("detail-buy-now").addEventListener("click", () => {
  if (!selectedProduct) return
  const quantity = getRequestedQuantity()
  if (quantity === null) return
  if (addProductToCart(selectedProduct, quantity)) window.location.assign("./checkout.html")
})

function normalizeSearchText(value) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
}

function getFlowerTypes(product) {
  const productDetails = `${product.title} ${product.description}`.toLocaleLowerCase("en")
  const types = []
  const typeKeywords = {
    rose: /\broses?\b/,
    orchid: /\borchids?\b/,
    lily: /\blilies?\b|\blily\b/,
    lavender: /\blavender\b/,
    gerber: /\bgerbers?\b|\bdais(?:y|ies)\b/
  }

  Object.entries(typeKeywords).forEach(([type, keyword]) => {
    if (keyword.test(productDetails)) types.push(type)
  })

  return types.length ? types : ["mixed"]
}

function renderProducts() {
  const searchTerm = normalizeSearchText(searchInput.value.trim())
  const flowerType = flowerTypeSelect.value
  const priceFilter = priceFilterSelect.value
  const collator = new Intl.Collator("vi", { sensitivity: "base" })
  let visibleProducts = products.filter((product) => {
    const englishName = normalizeSearchText(product.title)
    const vietnameseName = normalizeSearchText(getVietnameseProductName(product.title))
    const matchesSearch = !searchTerm
      || englishName.includes(searchTerm)
      || vietnameseName.includes(searchTerm)
      || String(product.id).includes(searchTerm)
    const matchesFlowerType = !flowerType
      || normalizeSearchText(String(product.category || "")) === normalizeSearchText(flowerType.slice("category:".length))
    const matchesCategory = FlowerProductCategories.matchesCategory(product, initialCategoryKey)
    const priceInVnd = toVndAmount(product.price)
    let matchesPrice = true

    if (priceFilter === "price-under-1500000") {
      matchesPrice = priceInVnd < 1500000
    } else if (priceFilter === "price-1500000-2000000") {
      matchesPrice = priceInVnd >= 1500000 && priceInVnd < 2000000
    } else if (priceFilter === "price-over-2000000") {
      matchesPrice = priceInVnd >= 2000000
    }

    return matchesSearch && matchesFlowerType && matchesCategory && matchesPrice
  })

  switch (sortSelect.value) {
    case "asc-p":
      visibleProducts.sort((first, second) => first.price - second.price)
      break
    case "dsc-p":
      visibleProducts.sort((first, second) => second.price - first.price)
      break
    case "str-i":
      visibleProducts.sort((first, second) => collator.compare(
        getVietnameseProductName(first.title),
        getVietnameseProductName(second.title)
      ))
      break
    case "str-d":
      visibleProducts.sort((first, second) => collator.compare(
        getVietnameseProductName(second.title),
        getVietnameseProductName(first.title)
      ))
      break
  }

  if (!visibleProducts.length) {
    const emptyMessage = document.createElement("p")
    emptyMessage.className = "catalog-empty"
    emptyMessage.textContent = initialCategory
      ? `${initialCategory.title}: hiện chưa có sản phẩm phù hợp trong cửa hàng.`
      : "Không tìm thấy sản phẩm phù hợp."
    container.replaceChildren(emptyMessage)
    if (initialCategoryKey) {
      const allProductsLink = document.createElement("a")
      allProductsLink.className = "catalog-empty-link"
      allProductsLink.href = "./product.html"
      allProductsLink.textContent = "Xem tất cả sản phẩm"
      container.append(allProductsLink)
    }
    return
  }

  display(visibleProducts)
  navigateToProductDetail()
}

sortSelect.addEventListener("change", renderProducts)
flowerTypeSelect.addEventListener("change", renderProducts)
priceFilterSelect.addEventListener("change", renderProducts)
searchButton.addEventListener("click", renderProducts)
searchInput.addEventListener("input", renderProducts)
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") renderProducts()
})

window.addEventListener("storage", (event) => {
  if (event.key === "flowerInventory") {
    products = FlowerInventory.readProducts()
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
  products = event.detail || FlowerInventory.readProducts()
  populateFlowerCategoryFilter()
  renderProducts()
  navigateToProductDetail()
})

async function fetchAndRenderProducts() {
  const requestedProductId = new URLSearchParams(window.location.search).get("id")
  if (requestedProductId) {
    relatedFlowersSection.hidden = false
    setRelatedFlowersStatus("Đang tìm những bó hoa phù hợp...", "loading")
  }
  try {
    products = await FlowerInventory.initialize()
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
