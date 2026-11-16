import { dateKey as reportDateKey } from "./admin-analytics.js?v=2";

const state = {
  productPage: document.getElementById("product_page"),
  categoriesPage: document.getElementById("categories_page"),
  offersPage: document.getElementById("offers_page"),
  deliveryPage: document.getElementById("delivery_page"),
  ordersPage: document.getElementById("orders_page"),
  designRequestsPage: document.getElementById("design_requests_page"),
  reviewsPage: document.getElementById("reviews_page"),
  messagesPage: document.getElementById("messages_page"),
  revenuePage: document.getElementById("revenue_page"),
  usersPage: document.getElementById("users_page"),
  logOutPage: document.getElementById("logout_page"),
  flowerPricesPage: null,
  main: document.querySelector("main"),
  currentUser: undefined,
  currentUserRole: "admin",
  editingProductId: null,
  productSearchTerm: "",
  productFilterCategory: "",
  productFilterStatus: "",
  productFilterMinPrice: "",
  productFilterMaxPrice: "",
  productPriceSort: "",
  isSavingProductForm: false,
  ordersCache: [],
  orderStoreError: null,
  stopOrderSubscription: null,
  stopPromotionSubscription: null,
  reviewsCache: [],
  reviewModerationFilter: "pending",
  stopReviewSubscription: null,
  categoriesCache: [],
  stopCategorySubscription: null,
  deliveryZonesCache: [],
  deliveryZonesLoaded: false,
  deliveryZonesLoading: false,
  deliveryZonesLoadError: "",
  bouquetWrappingTiers: [],
  bouquetWrappingLoaded: false,
  bouquetWrappingLoading: false,
  bouquetWrappingLoadError: "",
  designRequestsCache: [],
  designRequestsLoading: false,
  designRequestsLoaded: false,
  designRequestsLoadError: "",
  messagesCache: [],
  stopMessageSubscription: null,
  flowerPrices: [],
  flowerPricesLoaded: false,
  flowerPricesLoading: false,
  flowerPricesMessage: "",
  editingFlowerPriceId: null,
  flowerPriceHistory: null,
  reportFilters: { period: "month", month: reportDateKey(new Date()).slice(0, 7), start: "", end: "", lowStock: 5 },
  STORAGE_KEYS: { categories: "flowerCategories", offers: "flowerPromotions" }
};

// Admin modules share one page-scoped state surface. Keep state and registered
// operations centralized here so feature files can be extracted independently.
for (const [name, value] of Object.entries(state)) {
  Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, writable: true, value });
}
export function registerAdminFunctions(functions) {
  for (const [name, value] of Object.entries(functions)) {
    if (typeof value !== "function") throw new TypeError("Admin module export " + name + " must be a function.");
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, writable: true, value });
  }
}
