# Saved carts: design

Design's artefact. It merges as one pull request, and when it does the
Design stage is done and engineering's lens hears the handoff.

## Screens

| Screen | Figma | Screenshot |
|---|---|---|
| Cart, items saved from another device | [Frame](https://www.figma.com/design/EXAMPLE/Shop?node-id=12-40) | `cart-synced.png` |
| Cart, an item out of stock or repriced | [Frame](https://www.figma.com/design/EXAMPLE/Shop?node-id=12-88) | `cart-changed.png` |
| Sign-in, the guest cart joining the account's | [Frame](https://www.figma.com/design/EXAMPLE/Shop?node-id=14-2) | `cart-merged.png` |

The screenshots are committed beside this file, so a reviewer or an agent
reads them in the diff without Figma (the plan's open question 1). They
are left out of this example.

## Decisions

- **A repriced item shows both prices,** the old one struck through, with
  a line saying when it changed. It isn't removed: the shopper decides.
- **An out-of-stock item stays in the cart, dimmed,** below the rest, and
  doesn't count toward the total.
- **Merging on sign-in says what it did** in one line above the cart ("2
  items from this device joined your cart") and needs no confirmation.
- **No new tokens.** The changed-item line uses `--warn-soft` and
  `--text-subtle`, both in the shop's design system already.

## Questions back to product

None open. Whether a gift card's balance shows in the cart went to the
spec's pull request and was answered there (no, at checkout only).
