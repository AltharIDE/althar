import { Duration } from 'effect'

/*
 * When an agent's sign-in ends, as its own status command says it (DEV-196),
 * and the one warning Althar raises about it. The end shows quietly on the
 * account's row all along; the warning only within its last days, at most
 * once at each of its stages: soon, any day now (from the earliest it can
 * end), and ended. Put aside, it stays aside until the next stage, so a ✕
 * six days out still leaves a line for the last days and one for the end;
 * a new sign-in, with an end of its own, starts again. Althar only reads and
 * says: it never renews or holds a sign-in.
 */

/**
 * How long before the end an agent says the warning is raised: three days to
 * sign in again, before a night's unattended work stops, counted from the
 * earliest the sign-in can end. Claude Code, the one agent that says (its
 * `loginExpiresAt`), says the real end can come up to three days before the
 * date it gives, so six days before that date.
 */
export const WARN_WITHIN = Duration.days(6)

/** How early the real end can come before the date Claude Code gives: from then on, it can end any day. */
export const EARLIEST_BY = Duration.days(3)

/** Where a sign-in's end stands: far off, within the warning's days, any day now, or past. */
export type Ending = 'later' | 'soon' | 'last' | 'ended'

/** The stages a warning is raised at, in order: put aside at one, it is raised again at a later one. */
export type Stage = Exclude<Ending, 'later'>
const STAGES: readonly Stage[] = ['soon', 'last', 'ended']
const isStage = (value: unknown): value is Stage => STAGES.includes(value as Stage)

/** What Althar keeps of a warning put aside, by account: the end it was about, and the stage it was at. */
export interface Warned {
  readonly endsAt: string
  readonly dismissed: Stage
}

/**
 * Where a sign-in's end stands at `now`. One whose check already says signed
 * out within the warning's days has ended, whatever the date: the real end can
 * come before it, and the bar never says "ends by" while the row says signed
 * out. Undefined for no end, or one that isn't a time.
 */
export const endingOf = (endsAt: string | undefined, now: number, signedOut = false): Ending | undefined => {
  if (endsAt === undefined) return undefined
  const at = Date.parse(endsAt)
  if (Number.isNaN(at)) return undefined
  const left = at - now
  if (left > Duration.toMillis(WARN_WITHIN)) return 'later'
  if (left <= 0 || signedOut) return 'ended'
  return left <= Duration.toMillis(EARLIEST_BY) ? 'last' : 'soon'
}

/**
 * The stage the warning about a sign-in ending at `endsAt` shows at, at
 * `now`, given what was put aside of it: within its last days or past, and
 * not put aside at this stage or a later one for this same sign-in. A sign-in
 * that ended shows it still, until the person signs in again or puts it
 * aside. Undefined where nothing shows.
 */
export const warning = (endsAt: string | undefined, warned: Warned | undefined, now: number, signedOut = false): Stage | undefined => {
  const ending = endingOf(endsAt, now, signedOut)
  if (ending === undefined || ending === 'later') return undefined
  if (warned !== undefined && warned.endsAt === endsAt && STAGES.indexOf(warned.dismissed) >= STAGES.indexOf(ending)) return undefined
  return ending
}

/** The settings key a warning is kept under, for an account. */
export const warnedKey = (accountId: string) => `sign_in_ending:${accountId}`

/** What was kept, read back; undefined for nothing, or something that isn't a warning. One kept before stages were is taken as put aside at the first. */
export const warnedOf = (value: string | undefined): Warned | undefined => {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { endsAt, dismissed } = parsed as Record<string, unknown>
    if (typeof endsAt !== 'string') return undefined
    if (isStage(dismissed)) return { endsAt, dismissed }
    return dismissed === true ? { endsAt, dismissed: 'soon' } : undefined
  } catch {
    return undefined
  }
}
