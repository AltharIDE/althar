# Saved carts: operations

Devops's artefact. The Ship stage is done when this file merges. A
rollout's progress is shown beside the stage from the panels and moves
nothing (ADR-112).

## Rollout

| Step | Environment | What | Done when |
|---|---|---|---|
| 1 | staging | Run `0042_carts`, deploy `shop-api` and `shop`, flag on for everyone | The cart's checks pass on staging for a day |
| 2 | production | Run `0042_carts`, deploy both, flag on for 10% | Error rate and p95 within the alerts below for 2 days |
| 3 | production | Flag on for 50%, then 100% | The same, a day each |

**Back out:** turn the `saved_carts` flag off. The migration stays; it
is backward compatible.

## Environments

- **staging:** `shop-staging` cluster, namespace `shop`.
- **production:** `shop-prod` cluster, namespace `shop`; changes go
  through the plan/apply gate (Ops B).

## Alerts

| Alert | When | Severity |
|---|---|---|
| `CartApiErrors` | 5xx above 1% of `/cart` requests for 5 minutes | page |
| `CartApiSlow` | p95 of `GET /cart` above 300 ms for 10 minutes | ticket |
| `CartMergeFailures` | Sign-in merges failing above 0.5% for 15 minutes | ticket |

## Runbook

- **`/cart` errors after a deploy:** check the `shop-api` rollout on the
  Kubernetes panel; if pods restart, turn the flag off, then roll back.
- **Carts missing for some shoppers:** check `CartMergeFailures` and the
  `carts` table's expiry job; the guest cart is still on the shopper's
  device for 7 days, so nothing is lost meanwhile.
