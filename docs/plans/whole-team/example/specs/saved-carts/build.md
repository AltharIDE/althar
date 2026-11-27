# Saved carts: build

Engineering's artefact. The Build stage is done when this file and every
pull request in `spec.md`'s `pullRequests.build` have merged, in both
repositories.

## Plan

1. **API** (`shop-api`): a `carts` table keyed by account, with a 30-day
   expiry; `GET` and `PUT /cart`, versioned so two devices' writes don't
   overwrite each other; a merge endpoint for sign-in.
2. **Storefront** (`shop`): the cart reads and writes through the API
   when signed in, and through local storage for a guest, with 7 days'
   expiry; it merges on sign-in.
3. **Changed items** (`shop`): price and stock are checked when the cart
   opens, and the line design asked for is shown.

## Pull requests

Each carries `Feature: saved-carts build` in its description, and Althar
fills this list from the marked ones as they open.

| Pull request | What | State |
|---|---|---|
| shop#412 | The cart reads and writes the account's cart | Merged |
| shop#415 | Repriced and out-of-stock items in the cart | Merged |
| shop-api#418 | The saved carts API and its migration | Merged |

## Rollout notes for devops

- `shop-api#418` adds a migration (`0042_carts`); it is backward
  compatible, so it runs before the deploy.
- The storefront reads the `saved_carts` flag; with it off, the cart works
  as before.
