import type { Role } from './state'

/*
 * The team's world over the board: storefront's features, each on its way
 * through the stages (whole-team-flow's flow.yaml, as its default), the
 * handoffs waiting on a role, and what each role's panels would read from
 * their connectors. All made up.
 */

export const STAGES = ['Intent', 'Spec', 'Design', 'Build', 'Ship', 'Operate'] as const
export type Stage = (typeof STAGES)[number]

/** Whose each stage is: the role that does it and passes its gate. */
export const OWNER: Record<Stage, Role> = {
  Intent: 'product',
  Spec: 'product',
  Design: 'design',
  Build: 'engineering',
  Ship: 'devops',
  Operate: 'devops',
}

export interface StageRecord {
  readonly stage: Stage
  /** What it put in the repository, by its path or its pull requests. */
  readonly artifact?: string
  /** Who passed its gate, and when: "Réka approved · 3d". */
  readonly gate?: string
  /** What is under way in it: tasks, at work. */
  readonly work?: string
}

export interface Handoff {
  readonly feature: string
  readonly from: Stage
  readonly to: Stage
  /** Waits on this role. */
  readonly role: Role
  readonly ago: string
  /** What came across, in a few facts. */
  readonly facts: ReadonlyArray<string>
  /** What the coordinator proposes to start, read from the artifact. */
  readonly proposed: ReadonlyArray<string>
  /** A question sent back to an earlier stage, rather than the work moving on. */
  readonly question?: string
}

export interface Feature {
  readonly slug: string
  readonly name: string
  /** The stage it is on. */
  readonly at: number
  readonly tracker: string
  readonly stages: ReadonlyArray<StageRecord>
  /** Something wrong in Operate: an alert on what it shipped. */
  readonly alert?: string
}

export const FEATURES: ReadonlyArray<Feature> = [
  {
    slug: 'saved-carts',
    name: 'Saved carts',
    at: 4,
    tracker: 'SHOP-212',
    stages: [
      { stage: 'Intent', artifact: 'SHOP-212', gate: 'Réka · 12d' },
      { stage: 'Spec', artifact: 'specs/saved-carts/spec.md', gate: 'Réka approved · 9d' },
      { stage: 'Design', artifact: 'specs/saved-carts/design/', gate: 'Balázs approved · 6d' },
      { stage: 'Build', artifact: '#412 · #415 · #418', gate: 'Reviewed, merged, main green · 1h' },
      { stage: 'Ship', artifact: 'specs/saved-carts/ops.md', work: 'Rollout drafted, not started' },
      { stage: 'Operate' },
    ],
  },
  {
    slug: 'guest-checkout',
    name: 'Guest checkout',
    at: 3,
    tracker: 'SHOP-198',
    stages: [
      { stage: 'Intent', artifact: 'SHOP-198', gate: 'Réka · 20d' },
      { stage: 'Spec', artifact: 'specs/guest-checkout/spec.md', gate: 'Réka approved · 15d' },
      { stage: 'Design', artifact: 'specs/guest-checkout/design/', gate: 'Balázs approved · 14m' },
      { stage: 'Build', work: '2 tasks proposed' },
      { stage: 'Ship' },
      { stage: 'Operate' },
    ],
  },
  {
    slug: 'apple-pay',
    name: 'Apple Pay',
    at: 3,
    tracker: 'SHOP-176',
    stages: [
      { stage: 'Intent', artifact: 'SHOP-176', gate: 'Réka · 1mo' },
      { stage: 'Spec', artifact: 'specs/apple-pay/spec.md', gate: 'Réka approved · 3w' },
      { stage: 'Design', artifact: 'specs/apple-pay/design/', gate: 'Balázs approved · 2w' },
      { stage: 'Build', artifact: '#409', work: '1 task at work' },
      { stage: 'Ship' },
      { stage: 'Operate' },
    ],
  },
  {
    slug: 'gift-cards',
    name: 'Gift cards',
    at: 1,
    tracker: 'SHOP-221',
    stages: [
      { stage: 'Intent', artifact: 'SHOP-221', gate: 'Réka · 2d' },
      { stage: 'Spec', artifact: 'specs/gift-cards/spec.md', work: 'Spec draft at work' },
      { stage: 'Design' },
      { stage: 'Build' },
      { stage: 'Ship' },
      { stage: 'Operate' },
    ],
  },
  {
    slug: 'refund-webhooks',
    name: 'Refund webhooks',
    at: 5,
    tracker: 'SHOP-150',
    alert: '503s on /refunds/webhook, 3.1% for 20m',
    stages: [
      { stage: 'Intent', artifact: 'SHOP-150', gate: 'Réka · 2mo' },
      { stage: 'Spec', artifact: 'specs/refund-webhooks/spec.md', gate: 'Réka approved · 7w' },
      { stage: 'Design', gate: 'Skipped: no interface' },
      { stage: 'Build', artifact: '#371 · #380', gate: 'Merged · 5w' },
      { stage: 'Ship', artifact: 'specs/refund-webhooks/ops.md', gate: 'Rolled out · 4w' },
      { stage: 'Operate', work: '1 incident at work' },
    ],
  },
]

export const featureOf = (slug: string | null) => FEATURES.find((one) => one.slug === slug) ?? null

export const HANDOFFS: ReadonlyArray<Handoff> = [
  {
    feature: 'saved-carts',
    from: 'Build',
    to: 'Ship',
    role: 'devops',
    ago: '1h',
    facts: ['#412, #415 and #418 merged', 'Review passed, main green', 'ops.md: staging, then 10% of production'],
    proposed: ['Roll saved carts out to staging', 'Add the saved_carts flag to production at 10%'],
  },
  {
    feature: 'guest-checkout',
    from: 'Design',
    to: 'Build',
    role: 'engineering',
    ago: '14m',
    facts: ['design/ merged: 3 screens, tokens', 'Balázs approved'],
    proposed: ['Guest checkout: the email-only step', 'Guest checkout: link the order on sign-up'],
  },
  {
    feature: 'saved-carts',
    from: 'Ship',
    to: 'Build',
    role: 'engineering',
    ago: '20m',
    facts: ['From DevOps, on the rollout'],
    proposed: [],
    question: 'Does the carts migration run before the deploy, or with it?',
  },
  {
    feature: 'gift-cards',
    from: 'Design',
    to: 'Spec',
    role: 'product',
    ago: '35m',
    facts: ['From Design, on the balance screen'],
    proposed: [],
    question: 'Can a gift card pay for shipping, or only for items?',
  },
  {
    feature: 'gift-cards',
    from: 'Spec',
    to: 'Design',
    role: 'design',
    ago: '—',
    facts: ['Spec draft at work'],
    proposed: [],
  },
]

export const handoffsOf = (role: Role) => HANDOFFS.filter((one) => one.role === role && one.ago !== '—')

/* ---- Panels: one connector and one view each ---------------------------- */

export type Tone = 'ok' | 'warm' | 'danger' | 'live' | 'quiet'

export interface PanelRow {
  readonly name: string
  readonly value: string
  readonly tone?: Tone
  /** A feature it opens, by its slug. */
  readonly feature?: string
}

export interface PanelDef {
  readonly key: string
  readonly title: string
  /** Where it reads from: a connector's name. */
  readonly source: string
  readonly rows: ReadonlyArray<PanelRow>
}

export const PANELS: Record<string, PanelDef> = {
  handoffs: { key: 'handoffs', title: 'Handoffs', source: 'Althar', rows: [] },
  cluster: {
    key: 'cluster',
    title: 'Cluster health',
    source: 'Kubernetes · prod-eu-1, staging',
    rows: [
      { name: 'prod-eu-1', value: '42 of 42 pods ready', tone: 'ok' },
      { name: 'staging', value: 'checkout-api restarting', tone: 'danger' },
      { name: 'Nodes', value: '9 · CPU 61%', tone: 'quiet' },
    ],
  },
  alerts: {
    key: 'alerts',
    title: 'Alerts',
    source: 'Prometheus',
    rows: [
      { name: 'RefundWebhook5xx', value: '3.1% · 20m', tone: 'danger', feature: 'refund-webhooks' },
      { name: 'CheckoutLatencyP95', value: '840 ms · 6m', tone: 'warm' },
    ],
  },
  deploys: {
    key: 'deploys',
    title: 'Deploys',
    source: 'Argo CD',
    rows: [
      { name: 'checkout-api → staging', value: 'v2.14.0 · syncing', tone: 'live' },
      { name: 'checkout-api → prod', value: 'v2.13.2 · 2d', tone: 'ok' },
      { name: 'web → prod', value: 'v5.8.1 · 4h', tone: 'ok' },
    ],
  },
  ci: {
    key: 'ci',
    title: 'CI on main',
    source: 'GitHub Actions',
    rows: [
      { name: 'main', value: 'Passing · 14m', tone: 'ok' },
      { name: 'e2e (checkout)', value: 'Flaky 3 of 20', tone: 'warm' },
    ],
  },
  prs: {
    key: 'prs',
    title: 'Pull requests',
    source: 'GitHub',
    rows: [
      { name: '#418 Saved carts API', value: 'Ready to merge', tone: 'ok', feature: 'saved-carts' },
      { name: '#421 Address form', value: 'Changes asked', tone: 'warm' },
      { name: '#409 Apple Pay sheet', value: 'Checks running', tone: 'live', feature: 'apple-pay' },
    ],
  },
  stages: {
    key: 'stages',
    title: 'Features by stage',
    source: 'Althar',
    rows: [
      { name: 'Gift cards', value: 'Spec', tone: 'live', feature: 'gift-cards' },
      { name: 'Guest checkout', value: 'Build', tone: 'quiet', feature: 'guest-checkout' },
      { name: 'Apple Pay', value: 'Build', tone: 'live', feature: 'apple-pay' },
      { name: 'Saved carts', value: 'Ship', tone: 'quiet', feature: 'saved-carts' },
      { name: 'Refund webhooks', value: 'Operate', tone: 'danger', feature: 'refund-webhooks' },
    ],
  },
  cycle: {
    key: 'cycle',
    title: 'Cycle 31',
    source: 'Linear',
    rows: [
      { name: 'Done', value: '14 of 22', tone: 'ok' },
      { name: 'Ends', value: 'In 3 days', tone: 'quiet' },
      { name: 'At risk', value: 'SHOP-176 Apple Pay', tone: 'warm', feature: 'apple-pay' },
    ],
  },
  canvases: {
    key: 'canvases',
    title: 'Canvases',
    source: 'Althar',
    rows: [
      { name: 'guest-checkout-directions', value: '3 directions · 1h', tone: 'quiet', feature: 'guest-checkout' },
      { name: 'gift-card-balance', value: 'v2 · 2 comments', tone: 'warm' },
    ],
  },
  storybook: {
    key: 'storybook',
    title: 'Storybook',
    source: 'Storybook · localhost:6006',
    rows: [
      { name: 'Running', value: '214 stories', tone: 'ok' },
      { name: 'Checkout/PaymentSheet', value: 'Changed today', tone: 'quiet' },
    ],
  },
  diffs: {
    key: 'diffs',
    title: 'Screenshot diffs',
    source: 'Althar',
    rows: [
      { name: '#409 Apple Pay sheet', value: '4 changed', tone: 'warm', feature: 'apple-pay' },
      { name: '#418 Saved carts', value: 'No change', tone: 'ok' },
    ],
  },
}

/** The panels each lens pins, in order. */
export const PINNED: Record<Role, ReadonlyArray<string>> = {
  product: ['handoffs', 'stages', 'cycle'],
  design: ['handoffs', 'canvases', 'storybook', 'diffs'],
  engineering: ['handoffs', 'ci', 'prs'],
  devops: ['handoffs', 'cluster', 'alerts', 'deploys'],
}

/** What each lens lands on and how its board groups (direction A, and the defaults of B and C). */
export const LANDING: Record<Role, { grouping: string; lands: string }> = {
  product: { grouping: 'By feature', lands: 'The board, by feature' },
  design: { grouping: 'By feature', lands: 'The board, by feature' },
  engineering: { grouping: 'By status', lands: 'The board, as today' },
  devops: { grouping: 'By environment', lands: 'The board, by environment' },
}
