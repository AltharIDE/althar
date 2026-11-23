import { CheckState, type ChangeCheck } from '../../src'

/*
 * Made-up data for the handoff stories: storefront's feature Saved carts,
 * as docs/plans/whole-team/example has it, from its spec being written to
 * its design going into a pull request. Nothing here is read from anywhere.
 */

export const ROLES = [
  { key: 'product', label: 'Product', lands: 'Features by stage', kbd: '1' },
  { key: 'design', label: 'Design', lands: 'Canvases, beside the feature', kbd: '2' },
  { key: 'engineering', label: 'Engineering', lands: 'Conversation and board, as today', kbd: '3' },
  { key: 'devops', label: 'DevOps', lands: 'Environments, with the panels', kbd: '4' },
] as const
export type Role = (typeof ROLES)[number]['key']
export const roleName = (role: Role) => ROLES.find((one) => one.key === role)?.label ?? role

/** The default stages (ADR-109): the intent is spec.md's first section, so Spec is the first. */
export const STAGES = ['Spec', 'Design', 'Build', 'Ship', 'Operate'] as const
export type Stage = (typeof STAGES)[number]

export const PEOPLE = {
  product: { name: 'Réka Szabó', handle: 'reka' },
  design: { name: 'Dani Kovács', handle: 'dani-k' },
  designLead: { name: 'Noor Haddad', handle: 'noor' },
  engineering: { name: 'Balázs Tóth', handle: 'balazs' },
} as const

export const SPEC_PATH = 'specs/saved-carts/spec.md'
export const TRACKER = 'SHOP-212'

/** spec.md's frontmatter, drawn as the page's header in the product lens. */
export const FRONTMATTER = {
  feature: 'saved-carts',
  stage: 'spec' as const,
  owners: [
    ['Spec', 'Product', '@reka'],
    ['Design', 'Design', '@dani-k'],
    ['Build', 'Engineering', '—'],
    ['Ship', 'DevOps', '—'],
    ['Operate', 'DevOps', '—'],
  ] as const,
  repositories: ['shop', 'shop-api'],
}

/** spec.md's body under its frontmatter, as the coordinator drafted it from SHOP-212. */
export const SPEC_BODY = `## Problem

A signed-in shopper who leaves with items in their cart finds it empty on another device, and a guest finds it empty after a day. Support hears about it weekly, and a third of abandoned carts are never seen again.

## Goal

A signed-in shopper's cart is the same on every device, and stays for 30 days. A guest's cart stays on its device for 7 days and joins their account's cart when they sign in.

## Acceptance criteria

- [ ] An item added on one device shows in the cart on another within 5 seconds of opening it.
- [ ] A signed-in shopper's cart is kept for 30 days after its last change; a guest's for 7 days, on its device only.
- [ ] Signing in merges the guest cart into the account's: the same item adds its quantities, up to the item's limit.
- [ ] An item that went out of stock or changed price while saved shows that in the cart before checkout.
- [ ] Clearing the cart clears it on every device.

## Out of scope

- Several named carts or wish lists.
- Sharing a cart with someone else.`

/** What the code host reports for the spec's pull request: Althar reads it, and adds nothing (ADR-111). */
export const SPEC_GATES_OPEN: ChangeCheck[] = [
  { id: 'owners', name: 'Code owners · specs/ → @storefront/product', state: CheckState.Held, detail: 'Waits on @storefront/product' },
  { id: 'reviews', name: 'Required reviews · 0 of 1', state: CheckState.Held, detail: 'Waits on a reviewer' },
  { id: 'lint', name: 'markdown-lint', state: CheckState.Passed, detail: '12s' },
]

export const DESIGN_GATES: ChangeCheck[] = [
  { id: 'owners', name: 'Code owners · specs/*/design/ → @storefront/design', state: CheckState.Held, detail: 'Waits on Noor Haddad' },
  { id: 'reviews', name: 'Required reviews · 1 of 2', state: CheckState.Running, detail: 'Réka Szabó approved' },
  { id: 'chromatic', name: 'Screenshot diff · 6 changed', state: CheckState.Passed, detail: 'accepted by Dani Kovács' },
]

/** The design tasks the designer's coordinator proposed from the merged spec, held for them (ADR-110). */
export const PROPOSED = [
  {
    id: 'p1',
    task: '512',
    title: 'Saved carts: the cart across devices, three directions',
    plan: 'Prototype · 3 directions on the desktop page · its branch at the end',
    from: 'Acceptance 1, 5',
  },
  {
    id: 'p2',
    task: '513',
    title: 'Saved carts: signing in merges the guest cart',
    plan: 'Prototype · the merge moment, two directions',
    from: 'Acceptance 3',
  },
  {
    id: 'p3',
    task: '514',
    title: 'Saved carts: an item that changed while saved',
    plan: 'Prototype · out of stock and new price, in the cart',
    from: 'Acceptance 4',
  },
] as const

/** The feature's record, stage by stage, as the timeline reads it from the repository and the host. */
export interface StageRecord {
  readonly stage: Stage
  readonly owner: Role
  readonly artefact: string
  readonly prs: readonly { readonly repo: string; readonly number: number; readonly state: 'merged' | 'open' | 'draft' }[]
  readonly gate?: string
  readonly waits?: string
  readonly note?: string
}

export const RECORD: readonly StageRecord[] = [
  {
    stage: 'Spec',
    owner: 'product',
    artefact: 'specs/saved-carts/spec.md',
    prs: [{ repo: 'shop', number: 431, state: 'merged' }],
    gate: 'Code owners and 1 review, on GitHub',
    note: 'Merged 2 days ago by Réka Szabó',
  },
  {
    stage: 'Design',
    owner: 'design',
    artefact: 'specs/saved-carts/design/',
    prs: [{ repo: 'shop', number: 436, state: 'open' }],
    gate: 'Code owners: 0 of 1 · reviews: 1 of 2',
    waits: 'Noor Haddad, code owner of design/',
  },
  { stage: 'Build', owner: 'engineering', artefact: 'specs/saved-carts/build.md', prs: [] },
  { stage: 'Ship', owner: 'devops', artefact: 'specs/saved-carts/ops.md', prs: [] },
  { stage: 'Operate', owner: 'devops', artefact: 'Panels: cart-sync errors, p95', prs: [] },
]

/** The design files going into #436. */
export const DESIGN_FILES = [
  { path: 'specs/saved-carts/design/README.md', add: 64, del: 0 },
  { path: 'specs/saved-carts/design/decisions.md', add: 38, del: 0 },
  { path: 'specs/saved-carts/design/cart-sync-b.canvas.html', add: 412, del: 0 },
  { path: 'specs/saved-carts/design/shots/cart-light.png', add: 1, del: 0 },
  { path: 'specs/saved-carts/design/shots/cart-dark.png', add: 1, del: 0 },
  { path: 'specs/saved-carts/design/tokens.json', add: 9, del: 2 },
]
