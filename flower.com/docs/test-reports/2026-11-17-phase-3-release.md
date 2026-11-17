# Test Report & Release Checklist — Phase 3

Date: 2026-11-17
Environment: Windows 11, Node.js v24.22.2, npm dependencies installed (firebase-admin, @grpc/grpc-js), project root `flower.com/flower.com/flower.com`.

## Scope completed

- Revenue chart upgrade in Admin: independent period filter and grouping filter (day/week/month/year), Vietnam timezone, Monday week start, zero-filled buckets, total revenue consistency, sqrt-scaled chart bars, tooltips, responsive layout.
- Empty cart wording and indentation fix in `js/order/cart.js`.
- Backup CLI exit behavior fix in `scripts/backup-firestore.js`.

## Verification

- `npm test` (`node --test "tests/UnitTests/*.test.js"`): 249 tests, 249 pass, 0 fail.
- `tests/UnitTests/admin-analytics.test.js`: 6/6 pass.
- `tests/UnitTests/backup-validation.test.js`: 11/11 pass.
- Node syntax checks: `admin-analytics.js`, `admin-report-view.js`, `admin-dashboard.js`, `admin.js`, `cart.js` pass.

## Changed files (latest)

- `flower.com/js/admin/admin-analytics.js`
- `flower.com/js/admin/admin-report-view.js`
- `flower.com/js/admin/admin-dashboard.js`
- `flower.com/js/admin/admin-state.js`
- `flower.com/js/admin/admin-data.js`
- `flower.com/js/admin/admin-orders.js`
- `flower.com/js/admin/admin.js`
- `flower.com/admin.html`
- `flower.com/css/admin/admin.css`
- `flower.com/tests/UnitTests/admin-analytics.test.js`
- `flower.com/js/order/cart.js`
- `flower.com/cart.html`
- `flower.com/scripts/backup-firestore.js`

## Release checklist

- [x] Unit tests pass locally.
- [x] Revenue chart filters and grouping verified.
- [x] Timezone and week-start logic verified.
- [x] Backup CLI failure exits correctly.
- [ ] E2E/Playwright not run in this session.
- [ ] Firebase rules/indexes and deployment smoke not run in this session.
- [ ] Production env vars and CSP reviewed separately.

## Known limitations

- E2E tests and deployment checks are not included in this report.
- Node modules are environment-specific and should be installed in CI before tests.
- Legacy Node backend remains alongside ASP.NET backend; migration is not completed.
- Chart uses sqrt scaling for readability; exact proportional bar heights are not linear.
