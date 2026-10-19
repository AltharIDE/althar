import { DiffLineKind } from '../foundations/vocabulary'
import type { CodeRead, FoundCode, FoundFile } from '../thread/Code/code'
import type { DiffLine } from '../thread/Diff/Diff'

/* The code Meridian's agents name: the refunds limiter a lead changed, and a decision about it. */

const LIMITS = `import { Effect } from 'effect'

import { RefundsStore } from './store'
import type { Merchant } from '../merchants/model'

/**
 * How many refunds a merchant may ask for in a window, and how long it waits
 * once it has asked for them all. Read from the merchant's plan, never from
 * the request: a client can't raise its own limit.
 */
export interface RefundLimit {
  readonly perWindow: number
  readonly windowSeconds: number
}

/* A plan without its own limit gets the default: twenty a minute. */
const DEFAULT_LIMIT: RefundLimit = { perWindow: 20, windowSeconds: 60 }

export const limitOf = (merchant: Merchant): RefundLimit => merchant.plan.refunds ?? DEFAULT_LIMIT

/** Whether a merchant may ask for another refund now, and if not, when it may. */
export const checkRefundLimit = (merchant: Merchant, now: Date) =>
  Effect.gen(function* () {
    const store = yield* RefundsStore
    const limit = limitOf(merchant)
    const since = new Date(now.getTime() - limit.windowSeconds * 1000)
    const asked = yield* store.countSince(merchant.id, since)
    if (asked < limit.perWindow) return { allowed: true } as const
    // The oldest refund in the window says when one more is allowed.
    const oldest = yield* store.oldestSince(merchant.id, since)
    const retryAfter = Math.ceil((oldest.getTime() + limit.windowSeconds * 1000 - now.getTime()) / 1000)
    return { allowed: false, retryAfter } as const
  })

/** The 429 a refund over the limit is answered with, and when to try again. */
export const tooManyRefunds = (retryAfter: number) => ({
  status: 429,
  headers: { 'Retry-After': String(retryAfter) },
  body: { error: 'refund_rate_limited', retryAfter },
})
`

export const LIMITS_PATH = 'src/refunds/limits.ts'

/** The limiter, as the lead's worktree has it now. */
export const limitsRead: CodeRead = { text: LIMITS, from: 1, total: LIMITS.split('\n').length - 1, cut: false }

/** The limiter as a name gives it: a lead's, as its worktree has it, changed by its task. */
const limits = (more: Omit<Partial<FoundFile>, 'kind'> & { readonly name: string }): FoundFile => ({
  kind: 'file',
  path: LIMITS_PATH,
  byName: false,
  bytes: LIMITS.length,
  lines: limitsRead.total,
  content: 'text',
  changed: { add: 41, del: 3 },
  since: null,
  ...more,
})

/** The lead's message names the check, at its lines. */
export const limitsFound = limits({ name: 'src/refunds/limits.ts:22-33', line: 22, end: 33 })

/** The coordinator named the default limit yesterday, on main; lines were put in above it since. */
export const limitsMoved = limits({
  name: 'src/refunds/limits.ts:13',
  line: 13,
  changed: null,
  since: { commit: '8c1f2ad', now: { line: 17 } },
})

/** It named lines that were rewritten since: they show as they were. */
export const limitsRewritten = limits({
  name: 'src/refunds/limits.ts:30',
  line: 30,
  changed: null,
  since: { commit: '8c1f2ad', now: null },
})

/** A name in code, at the line that declares it. */
export const limitFn = limits({ name: 'checkRefundLimit', line: 22, symbol: 'checkRefundLimit', changed: null })

/** A path the agent got wrong, and files of nearly its name. */
export const limitsMissing: FoundCode = {
  kind: 'missing',
  name: 'src/refund/limit.ts',
  path: 'src/refund/limit.ts',
  near: ['src/refunds/limits.ts', 'test/refunds/limits.test.ts'],
}

/** A file's name that two files have, which the message doesn't tell apart. */
export const modelSeveral: FoundCode = {
  kind: 'several',
  name: 'model.ts',
  paths: ['src/merchants/model.ts', 'src/refunds/model.ts', 'src/disputes/model.ts'],
}

/** What isn't text: the merchant dashboard's icon set. */
export const iconsFound: FoundCode = {
  kind: 'file',
  name: 'web/public/icons.woff2',
  path: 'web/public/icons.woff2',
  byName: false,
  bytes: 48_211,
  lines: 0,
  content: 'binary',
  changed: null,
  since: null,
}

const DECISION = `# 012 · Refunds are limited per merchant, by plan

The limit is read from the merchant's plan. A request never carries its own limit, so a client can't raise it.

## Decision

- Twenty refunds a minute unless the plan says otherwise.
- Over the limit, the API answers 429 with \`Retry-After\`, counted from the oldest refund in the window.
- The dashboard shows when the next refund is allowed, rather than an error.

## Why not a global limit

A global limit punishes the merchants who refund most for the ones who refund least, and they are our largest.
`

/** A decision the lead wrote: prose, which wraps. */
export const decisionRead: CodeRead = { text: DECISION, from: 1, total: DECISION.split('\n').length - 1, cut: false }

export const decisionFound: FoundFile = {
  kind: 'file',
  name: 'docs/decisions/012-refund-limits.md',
  path: 'docs/decisions/012-refund-limits.md',
  byName: false,
  bytes: DECISION.length,
  lines: decisionRead.total,
  content: 'text',
  changed: { add: 14, del: 0 },
  since: null,
}

/** What the lead changed in the limiter: the check's window, and the 429. */
export const limitsChange: readonly DiffLine[] = [
  { kind: DiffLineKind.Hunk, text: '@@ -20,10 +20,14 @@ export const limitOf' },
  { kind: DiffLineKind.Context, old: 20, new: 20, text: '' },
  {
    kind: DiffLineKind.Context,
    old: 21,
    new: 21,
    text: '/** Whether a merchant may ask for another refund now, and if not, when it may. */',
  },
  { kind: DiffLineKind.Removed, old: 22, text: 'export const checkRefundLimit = (merchant: Merchant) =>' },
  { kind: DiffLineKind.Added, new: 22, text: 'export const checkRefundLimit = (merchant: Merchant, now: Date) =>' },
  { kind: DiffLineKind.Context, old: 23, new: 23, text: '  Effect.gen(function* () {' },
  { kind: DiffLineKind.Context, old: 24, new: 24, text: '    const store = yield* RefundsStore' },
  { kind: DiffLineKind.Removed, old: 25, text: '    const asked = yield* store.countToday(merchant.id)' },
  { kind: DiffLineKind.Removed, old: 26, text: '    return asked < 20' },
  { kind: DiffLineKind.Added, new: 25, text: '    const limit = limitOf(merchant)' },
  { kind: DiffLineKind.Added, new: 26, text: '    const since = new Date(now.getTime() - limit.windowSeconds * 1000)' },
  { kind: DiffLineKind.Added, new: 27, text: '    const asked = yield* store.countSince(merchant.id, since)' },
  { kind: DiffLineKind.Added, new: 28, text: '    if (asked < limit.perWindow) return { allowed: true } as const' },
]
