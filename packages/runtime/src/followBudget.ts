import type { Allowance, Product } from '@althar/connectors'

/*
 * What following every open pull request may ask of a code host (ADR-081):
 * at most a fifth of what the host allows an hour, and less as what is left
 * falls. Measured by the host's own headers where it sends them, and by what
 * Althar itself asked in the last hour where it sends none. Pure: the clock
 * and the host's answers come in as arguments, so the rule can be tested.
 */

export const HOUR = 3_600_000

/** The share of a host's hourly allowance that following may use: one in this many. */
export const SHARE = 5

/**
 * What a host allows an account an hour where it doesn't say. GitHub's is
 * 5,000; Bitbucket Cloud's at least 1,000, and a Data Center's is its
 * administrator's, taken as that too. GitLab's is set by its administrator,
 * and by the minute on gitlab.com: one request a second stands in.
 */
const ALLOWED: Readonly<Partial<Record<Product, number>>> = {
  github: 5_000,
  gitlab: 3_600,
  bitbucket_cloud: 1_000,
  bitbucket_dc: 1_000,
}
const FALLBACK = 1_000

/** What the host allows an hour: by its headers where it sends them, else by what is usual for it. */
export const allowedAnHour = (product: Product, allowance: Allowance | undefined): number => {
  const limit = allowance?.limit
  if (limit === undefined || limit <= 0) return ALLOWED[product] ?? FALLBACK
  // GitLab counts by the minute.
  return product === 'gitlab' ? limit * 60 : limit
}

/** How many requests following may spend an hour on this host. */
export const capOf = (product: Product, allowance: Allowance | undefined): number => Math.floor(allowedAnHour(product, allowance) / SHARE)

/**
 * How many times slower following goes as the host's allowance falls, by
 * the share it says is left: 1 while half is, then 2, 4 and 8, and none at
 * all (`Infinity`) in the last 5%, until it renews. Without headers there is
 * nothing to back off from, and the cap alone holds.
 */
export const easing = (allowance: Allowance | undefined): number => {
  if (allowance?.limit === undefined || allowance.remaining === undefined || allowance.limit <= 0) return 1
  const left = allowance.remaining / allowance.limit
  return left >= 0.5 ? 1 : left >= 0.3 ? 2 : left >= 0.15 ? 4 : left >= 0.05 ? 8 : Infinity
}

/** What was spent on each connection, hour by hour. */
export interface Spending {
  /** Notes that `cost` requests were asked of the connection's host at `now`. */
  readonly spend: (connectionId: string, cost: number, now: number) => void
  /** How many were asked in the hour up to `now`. */
  readonly spentIn: (connectionId: string, now: number) => number
  /** How many more following may ask of the connection's host now; 0 or less, none. */
  readonly room: (connectionId: string, product: Product, allowance: Allowance | undefined, now: number) => number
}

export const makeSpending = (): Spending => {
  const spent = new Map<string, Array<{ readonly at: number; readonly cost: number }>>()
  const within = (connectionId: string, now: number) => {
    const kept = (spent.get(connectionId) ?? []).filter((one) => now - one.at < HOUR)
    spent.set(connectionId, kept)
    return kept
  }
  const spentIn = (connectionId: string, now: number) => within(connectionId, now).reduce((sum, one) => sum + one.cost, 0)
  return {
    spend: (connectionId, cost, now) => {
      if (cost > 0) within(connectionId, now).push({ at: now, cost })
    },
    spentIn,
    room: (connectionId, product, allowance, now) => capOf(product, allowance) - spentIn(connectionId, now),
  }
}

/** How long the list of a project's open pull requests waits between reads, at the least. */
export const LIST_EVERY = 5 * 60_000

/**
 * How long a repository's list waits before it is read again: five minutes,
 * grown to fit the cap when reading it and the checks it leads to cost more
 * than the cap lets in an hour at that pace, and by how much the host's
 * allowance has fallen. `cost` is what the last round of reading the
 * repository took, `shared` how many repositories share the connection's cap.
 */
export const listEvery = (input: {
  readonly product: Product
  readonly allowance: Allowance | undefined
  readonly cost: number
  readonly shared: number
}): number => {
  const cap = Math.max(capOf(input.product, input.allowance), 1)
  // A round at this pace uses `cost` of the cap's share for this repository; the pace is slow enough that all of them fit.
  const fitted = (HOUR * Math.max(input.cost, 1) * Math.max(input.shared, 1)) / cap
  return Math.max(LIST_EVERY, fitted) * easing(input.allowance)
}

/** How long a failed run's checks are read again at its unchanged head: a day. */
export const FAILED_READ_FOR = 24 * HOUR
