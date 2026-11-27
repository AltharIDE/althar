---
feature: saved-carts
title: Saved carts
stage: ship
owners:
  spec: product
  design: [design, "@a-designer"]
  build: engineering
  ship: devops
  operate: devops
repositories: [shop, shop-api]
tracker: https://linear.app/example/issue/SHOP-212
pullRequests:
  build: [shop#412, shop#415, shop-api#418]
skip: []
---

# Saved carts

## Problem

A signed-in shopper who leaves with items in their cart finds it empty on
another device, and a guest finds it empty after a day. Support hears
about it weekly, and a third of abandoned carts are never seen again.

## Goal

A signed-in shopper's cart is the same on every device, and stays for 30
days. A guest's cart stays on its device for 7 days and joins their
account's cart when they sign in.

## Acceptance criteria

- [ ] An item added on one device shows in the cart on another within 5
      seconds of opening it.
- [ ] A signed-in shopper's cart is kept for 30 days after its last
      change; a guest's for 7 days, on its device only.
- [ ] Signing in merges the guest cart into the account's: the same item
      adds its quantities, up to the item's limit.
- [ ] An item that went out of stock or changed price while saved shows
      that in the cart before checkout, and is never bought at the old
      price.
- [ ] Clearing the cart clears it on every device.
- [ ] The cart loads within 300 ms at the 95th percentile.

## Out of scope

- Several named carts or wish lists.
- Sharing a cart with someone else.
