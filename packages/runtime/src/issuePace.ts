import { ConnectorFailed } from '@althar/connectors'
import { Cause, Clock, Context, Effect, Exit, Option } from 'effect'

import { makeKeyedLock } from './keyedLock'

/*
 * Issues filed on a tracker, paced by the account whose limits they count
 * against (IssueDrafts.ts). Trackers count calls per account, and some ask
 * outright for writes to be spaced: GitHub a second between them, Trello a
 * hundred calls in ten seconds a token, Linear's and GitLab's by the hour or
 * the minute. So on one account one issue is filed at a time, the next at
 * least `gap` after the last was asked, and a tracker's "too many calls" is
 * kept: every filing on that account waits for its reset, rather than each
 * being refused in turn. Accounts apart are paced apart.
 *
 * A filing refused for too many calls reached the tracker as a refusal,
 * nothing filed (each tracker's adapter files with its last call, and what
 * it reads after can't fail it), so it is asked again once the tracker says,
 * or after a wait that doubles where it doesn't, up to `tries` times and
 * never for longer than `longest` at once. A wait longer than that is said
 * and not waited: the tracker's refusal, with when to try again, and nothing
 * asked of it. Any other end of the filing, an answer lost among them, is
 * its own to say, never asked again here.
 */

export interface PaceOptions {
  /** The least time between two filings on one account, in milliseconds. */
  readonly gap: number
  /** The longest one wait may be, in milliseconds; a tracker that asks for longer is said to, and not waited for. */
  readonly longest: number
  /** How many times one filing is asked of its tracker while it is refused for too many calls. */
  readonly tries: number
  /** The first wait after a refusal that says no time, in milliseconds: each next one doubles it. */
  readonly backoff: number
}

export const issuePace: PaceOptions = { gap: 1_000, longest: 60_000, tries: 3, backoff: 5_000 }

/** How issues are paced: as above, unless a test says. */
export const IssuePacing = Context.Reference<PaceOptions>('@althar/runtime/IssuePacing', { defaultValue: () => issuePace })

/** What a filing does on its account's turn. */
export interface PacedFiling<A, E, R> {
  /** Said each time it is to wait for the tracker's limit: until when, in milliseconds since the epoch. */
  readonly waiting: (until: number) => Effect.Effect<void, E, R>
  /** Said just before each time the tracker is asked: false, and it stops without asking, as for a draft discarded meanwhile. */
  readonly start: Effect.Effect<boolean, E, R>
  /** Asks the tracker. */
  readonly attempt: Effect.Effect<A, E | ConnectorFailed, R>
}

export interface IssuePace {
  /**
   * Runs `filing` on `account`'s turn: its value, or `stopped` where its
   * `start` said not to go on; fails as it did, or with the tracker's
   * refusal for too many calls once it won't wait more.
   */
  readonly run: <A, E, R>(
    account: string,
    filing: PacedFiling<A, E, R>,
  ) => Effect.Effect<{ readonly stopped: false; readonly value: A } | { readonly stopped: true }, E | ConnectorFailed, R>
  /** How many accounts' times are kept: those with a filing on them, or a wait still ahead. */
  readonly size: () => number
}

/** The tracker's refusal for too many calls, kept with when it lets the account in again. */
interface Held {
  /** How many filings on the account are under way or waiting their turn: it is kept while any are. */
  filings: number
  /** When the next filing may be asked, after the last: its gap. */
  next: number
  /** Until when the tracker said no more, and its refusal. */
  closed: { readonly until: number; readonly refusal: ConnectorFailed } | null
}

const limited = (error: unknown): error is ConnectorFailed => error instanceof ConnectorFailed && error.reason === 'rate_limited'

/** A refusal for too many calls that says when, in the tracker's words. */
const refusalUntil = (refusal: ConnectorFailed, until: number) =>
  new ConnectorFailed({
    product: refusal.product,
    reason: 'rate_limited',
    message: refusal.message,
    ...(refusal.status === undefined ? {} : { status: refusal.status }),
    retryAt: new Date(until).toISOString(),
  })

export const makeIssuePace = (options: PaceOptions = issuePace): IssuePace => {
  const lock = makeKeyedLock()
  const held = new Map<string, Held>()

  const run: IssuePace['run'] = (account, filing) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        // Times past say nothing more: an account is kept only while a filing is on it, or it has a wait ahead.
        for (const [key, kept] of held)
          if (kept.filings === 0 && kept.next <= now && (kept.closed === null || kept.closed.until <= now)) held.delete(key)
        const times = held.get(account) ?? { filings: 0, next: 0, closed: null }
        times.filings++
        held.set(account, times)
        return yield* restore(lock.withLock(account, turn(times, filing))).pipe(Effect.ensuring(Effect.sync(() => void times.filings--)))
      }),
    )

  /** One filing on its account's turn: waited for, asked, and asked again while the tracker says to wait a while. */
  const turn = <A, E, R>(times: Held, filing: PacedFiling<A, E, R>) =>
    Effect.gen(function* () {
      for (let tried = 0; ; tried++) {
        const at = yield* Clock.currentTimeMillis
        const closed = times.closed !== null && times.closed.until > at ? times.closed : null
        if (closed !== null && closed.until - at > options.longest) return yield* refusalUntil(closed.refusal, closed.until)
        if (closed !== null) yield* filing.waiting(closed.until)
        const until = Math.max(times.next, closed?.until ?? 0)
        if (until > at) yield* Effect.sleep(until - at)
        if (!(yield* filing.start)) return { stopped: true as const }
        const exit = yield* Effect.exit(filing.attempt)
        const asked = yield* Clock.currentTimeMillis
        times.next = asked + options.gap
        if (Exit.isSuccess(exit)) return { stopped: false as const, value: exit.value }
        const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
        if (!limited(error)) return yield* Effect.failCause(exit.cause)
        const said = error.retryAt === undefined ? Number.NaN : Date.parse(error.retryAt)
        const reopens = Number.isFinite(said) ? Math.max(said, asked) : asked + options.backoff * 2 ** tried
        times.closed = { until: Math.max(reopens, times.closed?.until ?? 0), refusal: error }
        if (tried + 1 >= options.tries || times.closed.until - asked > options.longest)
          return yield* refusalUntil(error, times.closed.until)
      }
    })

  return { run, size: () => held.size }
}
