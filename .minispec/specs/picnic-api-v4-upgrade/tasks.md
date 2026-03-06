---
feature: picnic-api-v4-upgrade
status: planned
created: 2026-03-06
chunk_size: medium
total_tasks: 4
estimated_lines: 425
---

# Picnic-API v3 to v4 Upgrade Tasks

## Overview

Upgrade `picnic-api` from 3.2.0 to 4.0.0, migrating all method calls
to domain-based architecture, removing tools with no v4 equivalent,
and cleaning up `as any` casts.

## Task List

### Foundation

#### Task 1: Bump picnic-api to 4.0.0
- **Estimate:** ~5 lines
- **Files:** `package.json`, `package-lock.json`
- **Description:** Update picnic-api version in package.json and run
  npm install to update the lock file.
- **Depends on:** None
- **Acceptance:** `npm install` completes without errors

#### Task 2: Migrate picnic-client.ts + update tests
- **Estimate:** ~50 lines changed
- **Files:** `src/utils/picnic-client.ts`, `test/unit/utils/picnic-client.test.ts`
- **Description:**
  - `client.login()` -> `client.auth.login()`
  - `client.getShoppingCart()` -> `client.cart.getCart()`
  - `client.authKey = null` -> direct assignment (now public on HttpClient)
  - Remove `(client as any).authKey` cast in `saveSession()`
  - Update mock in test file: flat object -> domain-structured
    (`{ auth: { login }, cart: { getCart } }`)
  - Update test assertions that reference `getShoppingCart`
- **Depends on:** Task 1
- **Acceptance:** `npm test` passes for picnic-client tests

### Core Implementation

#### Task 3: Remove deprecated tools + migrate remaining handlers
- **Estimate:** ~370 lines changed (mostly deletions)
- **Files:** `src/tools/picnic-tools.ts`
- **Description:**
  - **Remove** 6 tool registrations:
    - `picnic_get_categories` (~85 lines)
    - `picnic_get_category_details` (~115 lines)
    - `picnic_get_lists` (~15 lines)
    - `picnic_get_list` (~20 lines)
    - `picnic_get_mgm_details` (~10 lines)
    - `picnic_analyze_response_size` (~55 lines)
  - **Migrate** remaining handlers to v4 domains:
    - `client.search()` -> `client.catalog.search()`
    - `client.getSuggestions()` -> `client.catalog.getSuggestions()`
    - `client.getImage()` -> `client.catalog.getImage()`
    - `client.getShoppingCart()` -> `client.cart.getCart()`
    - `client.addProductToShoppingCart()` -> `client.cart.addProductToCart()`
    - `client.removeProductFromShoppingCart()` -> `client.cart.removeProductFromCart()`
    - `client.clearShoppingCart()` -> `client.cart.clearCart()`
    - `client.getDeliverySlots()` -> `client.cart.getDeliverySlots()`
    - `client.setDeliverySlot()` -> `client.cart.setDeliverySlot()`
    - `client.getDeliveries()` -> `client.delivery.getDeliveries()`
    - `client.getDelivery()` -> `client.delivery.getDelivery()`
    - `client.getDeliveryPosition()` -> `client.delivery.getDeliveryPosition()`
    - `client.getDeliveryScenario()` -> `client.delivery.getDeliveryScenario()`
    - `client.cancelDelivery()` -> `client.delivery.cancelDelivery()`
    - `client.setDeliveryRating()` -> `client.delivery.setDeliveryRating()`
    - `client.sendDeliveryInvoiceEmail()` -> `client.delivery.sendDeliveryInvoiceEmail()`
    - `client.getOrderStatus()` -> `client.cart.getOrderStatus()`
    - `client.getUserDetails()` -> `client.user.getUserDetails()`
    - `client.getUserInfo()` -> `client.user.getUserInfo()`
    - `client.getPaymentProfile()` -> `client.payment.getPaymentProfile()`
    - `client.getWalletTransactions()` -> `client.payment.getWalletTransactions()`
    - `client.getWalletTransactionDetails()` -> `client.payment.getWalletTransactionDetails()`
    - `client.generate2FACode()` -> `client.auth.generate2FACode()`
  - **Clean up** 2FA verify bypass: remove `as any` casts for `url`
    and `authKey` (now public on HttpClient)
- **Depends on:** Task 1
- **Acceptance:** No remaining references to v3 method names in
  `picnic-tools.ts`

### Verification

#### Task 4: Verify build + lint + tests pass
- **Estimate:** ~0 lines (fix-up only)
- **Files:** Any files with type errors
- **Description:** Run full verification suite. Fix any type errors
  from v4 API changes (e.g., changed return types, new required params).
- **Depends on:** Task 2, Task 3
- **Acceptance:** `npm run typecheck && npm run lint && npm test` all pass

## Notes

- GitHub issue #26 tracks the 2FA fetch bypass cleanup (future work)
- Categories, lists, and MGM tools are removed per decision-001
- Diagnostic tool removed per decision-002
- 2FA bypass kept per decision-003
- Tasks 2 and 3 can run in parallel (different files)

## Progress

- [ ] Task 1: Bump picnic-api to 4.0.0
- [ ] Task 2: Migrate picnic-client.ts + update tests
- [ ] Task 3: Remove deprecated tools + migrate remaining handlers
- [ ] Task 4: Verify build + lint + tests pass
