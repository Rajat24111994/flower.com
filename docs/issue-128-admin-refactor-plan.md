# Issue #128: Admin module extraction plan

## Goal

Split `flower.com/js/admin/admin.js` by business area while preserving existing behavior. Keep the admin entry point focused on authentication, startup, shared subscriptions, and tab navigation. Every JavaScript file under `js/admin/` should remain below approximately 800 lines.

## Extraction order

1. Move shared mutable view state and the small cross-module function registry into `admin-state.js`.
2. Extract dashboard and revenue rendering into `admin-dashboard.js`.
3. Extract product catalog rendering, image upload, inventory editing, and product actions into `admin-products.js`.
4. Extract category and promotion rendering/actions into `admin-categories.js` and `admin-promotions.js`.
5. Extract delivery zones, bouquet wrapping, and custom design request management into `admin-delivery.js`.
6. Extract order rendering, status transitions, payment verification/refunds/audit into `admin-orders.js`.
7. Extract review and customer-message rendering/moderation/replies into `admin-reviews.js`.
8. Extract Firebase user and flower-price management into `admin-users.js`.
9. Split delegated event wiring by feature into `admin-events.js`; leave `admin.js` to load the feature modules and start the existing authenticated admin lifecycle.

Each extraction should move existing functions intact first, then make only the wiring changes needed to connect the modules. Update the module URL version in `admin.html` after the split.

## Verification

- Run `cd flower.com && npm test` after each extraction.
- Run Firebase Emulator integration tests after API, Firestore, or order behavior wiring is moved.
- Run the Playwright E2E suite against the local authenticated admin flow after each integration step.
- Check every `js/admin/*.js` file is below 800 lines and review the final diff for moved or changed behavior.

## Completion and contribution

Keep the extraction isolated from other issue work. Commit each completed business-area extraction separately, then push the finished change to `main` as requested for issue #128. The commit must be authored by the configured GitHub account and reachable from `main` to count in its Contributions activity.
