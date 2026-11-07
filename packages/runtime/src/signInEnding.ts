import { Duration } from 'effect'

/*
 * When an agent's sign-in ends, as its own status command says it (DEV-196),
 * and the one warning Althar raises about it. The end shows quietly on the
 * account's row all along; the warning only within its last days, once for
 * each sign-in: put aside, it stays aside, and only a new sign-in, with an
 * end of its own, can raise another. Althar only reads and says: it never
 * renews or holds a sign-in.
 */

/** How long before a sign-in ends the warning is raised: long enough to sign in again before a night's unattended work. */
export const WARN_WITHIN = Duration.days(3)

/** What Althar keeps of a warning, by account: the end it was about, and whether the person put it aside. */
export interface Warned {
  readonly endsAt: string
  readonly dismissed: boolean
}

/** Where a sign-in's end stands at `now`: far off, within the warning's days, or past. Undefined for no end, or one that isn't a time. */
export const endingOf = (endsAt: string | undefined, now: number): 'later' | 'soon' | 'ended' | undefined => {
  if (endsAt === undefined) return undefined
  const at = Date.parse(endsAt)
  if (Number.isNaN(at)) return undefined
  if (at <= now) return 'ended'
  return at - now <= Duration.toMillis(WARN_WITHIN) ? 'soon' : 'later'
}

/**
 * Whether the warning about a sign-in ending at `endsAt` shows at `now`, given
 * what was kept of the last one: within its last days or just past, and not
 * put aside for this same sign-in. A sign-in that ended shows it still, until
 * the person signs in again or puts it aside: its row says it is signed out too.
 */
export const warns = (endsAt: string | undefined, warned: Warned | undefined, now: number): boolean => {
  const ending = endingOf(endsAt, now)
  if (ending !== 'soon' && ending !== 'ended') return false
  return !(warned !== undefined && warned.endsAt === endsAt && warned.dismissed)
}

/** The settings key a warning is kept under, for an account. */
export const warnedKey = (accountId: string) => `sign_in_ending:${accountId}`

/** What was kept, read back; undefined for nothing, or something that isn't a warning. */
export const warnedOf = (value: string | undefined): Warned | undefined => {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { endsAt, dismissed } = parsed as Record<string, unknown>
    return typeof endsAt === 'string' && typeof dismissed === 'boolean' ? { endsAt, dismissed } : undefined
  } catch {
    return undefined
  }
}
