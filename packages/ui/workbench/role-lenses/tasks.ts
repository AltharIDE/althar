/*
 * storefront's work on the board: every role's, a spec draft, a design
 * prototype, builds, a rollout and an incident. Made up.
 */

export interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: 'running' | 'ready' | 'planned'
  readonly ago: number
  readonly plain?: boolean
  readonly branch?: string
  readonly pr?: number
  /** The feature it is part of, by its slug. */
  readonly feature?: string
}

export const TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'saved-carts-api', title: 'Saved carts: keep the cart on the server', phase: 'ready', ago: 40, pr: 418, feature: 'saved-carts' },
  {
    slug: 'apple-pay-sheet',
    title: 'Apple Pay in the payment sheet',
    phase: 'running',
    ago: 18,
    branch: 'althar/apple-pay-sheet',
    feature: 'apple-pay',
  },
  {
    slug: 'checkout-e2e-flake',
    title: 'Fix the flaky checkout end-to-end test',
    phase: 'running',
    ago: 9,
    branch: 'althar/checkout-e2e-flake',
  },
  {
    slug: 'guest-checkout-directions',
    title: 'Guest checkout: three directions',
    phase: 'ready',
    ago: 70,
    plain: true,
    feature: 'guest-checkout',
  },
  { slug: 'gift-cards-spec', title: 'Gift cards: draft the spec', phase: 'running', ago: 25, plain: true, feature: 'gift-cards' },
  {
    slug: 'refund-webhook-5xx',
    title: 'Why refund webhooks return 503',
    phase: 'running',
    ago: 6,
    plain: true,
    feature: 'refund-webhooks',
  },
  { slug: 'saved-carts-rollout', title: 'Roll saved carts out to staging', phase: 'planned', ago: 3, feature: 'saved-carts' },
]

export const taskOf = (slug: string) => TASKS.find((one) => one.slug === slug)
