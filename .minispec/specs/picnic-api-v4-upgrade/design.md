---
feature: picnic-api-v4-upgrade
status: planned
created: 2026-03-06
decisions: [001, 002, 003]
---

# Picnic-API v3 to v4 Upgrade Design

## Overview

Upgrade the `picnic-api` dependency from 3.2.0 to 4.0.0. The new version
replaces the monolithic `PicnicClient` with a domain-based service
architecture (`client.domain.method()`). This is a migration-only change
with no new features.

## Affected Files

- `src/utils/picnic-client.ts` — client init, session management
- `src/tools/picnic-tools.ts` — all MCP tool handlers
- `test/unit/utils/picnic-client.test.ts` — client unit tests
- `package.json` — dependency version bump

## Method Migration Map

### Straightforward moves (25 methods)

| v3 call | v4 call |
|---------|---------|
| `client.login()` | `client.auth.login()` |
| `client.search()` | `client.catalog.search()` |
| `client.getSuggestions()` | `client.catalog.getSuggestions()` |
| `client.getImage()` | `client.catalog.getImage()` |
| `client.getShoppingCart()` | `client.cart.getCart()` |
| `client.addProductToShoppingCart()` | `client.cart.addProductToCart()` |
| `client.removeProductFromShoppingCart()` | `client.cart.removeProductFromCart()` |
| `client.clearShoppingCart()` | `client.cart.clearCart()` |
| `client.getDeliverySlots()` | `client.cart.getDeliverySlots()` |
| `client.setDeliverySlot()` | `client.cart.setDeliverySlot()` |
| `client.getOrderStatus()` | `client.cart.getOrderStatus()` |
| `client.getDeliveries()` | `client.delivery.getDeliveries()` |
| `client.getDelivery()` | `client.delivery.getDelivery()` |
| `client.getDeliveryPosition()` | `client.delivery.getDeliveryPosition()` |
| `client.getDeliveryScenario()` | `client.delivery.getDeliveryScenario()` |
| `client.cancelDelivery()` | `client.delivery.cancelDelivery()` |
| `client.setDeliveryRating()` | `client.delivery.setDeliveryRating()` |
| `client.sendDeliveryInvoiceEmail()` | `client.delivery.sendDeliveryInvoiceEmail()` |
| `client.getUserDetails()` | `client.user.getUserDetails()` |
| `client.getUserInfo()` | `client.user.getUserInfo()` |
| `client.getPaymentProfile()` | `client.payment.getPaymentProfile()` |
| `client.getWalletTransactions()` | `client.payment.getWalletTransactions()` |
| `client.getWalletTransactionDetails()` | `client.payment.getWalletTransactionDetails()` |
| `client.generate2FACode()` | `client.auth.generate2FACode()` |
| `client.verify2FACode()` | `client.auth.verify2FACode()` |

### Removed (no v4 equivalent)

| v3 method | MCP tool to remove |
|-----------|-------------------|
| `client.getCategories()` | `picnic_get_categories`, `picnic_get_category_details` |
| `client.getLists()` | `picnic_get_lists` |
| `client.getList()` | `picnic_get_list` |
| `client.getMgmDetails()` | `picnic_get_mgm_details` |

### Diagnostic tool to remove

`picnic_analyze_response_size` — references removed methods, not core.

## Internal Property Access

v4 `HttpClient` exposes `authKey` and `url` as public properties.
Remove `as any` casts in `picnic-client.ts` and the 2FA verify handler.

## 2FA Verify Bypass

Keep the raw `fetch()` bypass in `picnic_verify_2fa_code` — it captures
response headers that `sendRequest` does not expose. A GitHub issue will
be created to revisit this after upgrade.

## Open Questions

None — all decisions made.
