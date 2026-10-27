import { Predicate } from 'effect'

/*
 * What went wrong with a request to an agent, in the classes of
 * docs/architecture/03's failure table. Each class leads somewhere different:
 * a usage limit pauses every session on the account and moves the work; a
 * lost connection, a short rate limit or a failing service is transient: its
 * step is waited out while the computer is offline, and retried after a
 * growing pause while it is online (ADR-060); a full context starts a new
 * session from a brief (docs/architecture/05).
 *
 * Claude Code and Codex report failures in structured form when asked (see
 * `structuredFailure`), on a `session_info_update` or on the prompt's
 * response; for every other agent, and as a fallback, the error text is read
 * here. The texts below are what the agents said, as recorded against an API
 * host that refused, dropped or failed them (tests/failures.test.ts).
 */

export type FailureClass = 'usage_limit' | 'context_full' | 'auth_required' | 'invalid_request' | 'transient' | 'unknown'

export interface Classified {
  readonly failure: FailureClass
  readonly message: string
  /** When a usage limit resets, as ISO 8601 in UTC, if the agent said. */
  readonly resetsAt?: string
}

/** JSON-RPC and ACP error codes. */
const AUTH_REQUIRED = -32000
const INVALID_PARAMS = -32602
const METHOD_NOT_FOUND = -32601
/** Junie's: the JetBrains AI balance is spent (`INSUFFICIENT_ACCOUNT_BALANCE_ERROR_CODE`, Junie 3110.7). */
const JUNIE_BALANCE = -32010
/** Mistral Vibe's rate limit, said only once its own retries, which wait as long as Mistral asks, have run out (vibe/acp/exceptions.py). */
const VIBE_RATE_LIMIT = -31001

/**
 * A plan or account allowance used up until a reset, in the words each agent
 * says it (docs/plans/plan-usage.md lists them): "usage limit" and "quota"
 * (Codex, Kimi Code, OpenCode, Qwen Code, Gemini's), "hit your session limit"
 * (Claude Code; Grok's "hit your weekly limit"; Copilot's "hit your rate
 * limit", which lasts hours), "reached your weekly rate limit" (Copilot),
 * "insufficient account balance" (Junie), "run out of … credits" (Copilot),
 * "credit limit" and "spending cap" (Grok), "spend cap" (Codex), Copilot's
 * "rate limit for this model", a 402 "Payment Required" (Mistral Vibe, Grok),
 * Gemini's RESOURCE_EXHAUSTED and "exhausted your capacity", and OpenCode's
 * `provider.quota` and `provider.free-limit`. A bare rate limit or 429 is not
 * one: it is usually per minute.
 */
const usageLimit = new RegExp(
  [
    'usage limit',
    'quota',
    'plan limit',
    'limit reached',
    'out of (?:usage )?(?:credits|usage)',
    'run out of (?:your )?[\\w ]{0,30}credits',
    'insufficient[\\w\\s]{0,20}(?:credits|balance)',
    "hit your (?:[\\w’'-]+ ){0,3}limit",
    "reached your (?:[\\w’'()-]+ ){0,3}limit",
    'credit limit',
    'spending[ -](?:cap|limit)',
    'spend[ -](?:cap|limit)',
    'rate limit for this model',
    'payment required',
    'status:? 402',
    'shared budget',
    'resource_exhausted',
    'resource has been exhausted',
    'exhausted your (?:capacity|quota)',
    'capacity exhausted',
    'provider\\.(?:quota|free-limit)',
    'membership',
  ].join('|'),
  'i',
)
/** Limits that pass in moments, whatever words they share with a plan's: Kimi Code's concurrent requests and busy engine, OpenCode's rate limit. */
const passing = /concurrent request limit|provider\.rate-limit|too many requests at the moment|engine is currently overloaded/i
/** Copilot's spend limit for one session: a new session goes on (as a full context does). */
const sessionCap = /limit for this session\. start a new session/i
/** A sign-in that no longer serves: Qwen OAuth's free tier ended on 15 April 2026, and another way to sign in is needed. */
const gone = /free tier has been discontinued/i
const contextFull =
  /context (window|length|limit)|too (many|long).{0,20}tokens|prompt is too long|context.{0,20}(exceeded|full|exhausted)|maximum context/i
const authRequired =
  /auth(entication)? required|not (logged|signed) in|please (log|sign) ?in|(log|sign) ?in to continue|unauthori[sz]ed|\b401\b|invalid api key/i
const transient =
  /rate.?limit|too many requests|\b429\b|timed? ?out|econn(reset|refused|aborted)|enotfound|eai_again|etimedout|socket hang up|fetch failed|can'?t reach|(cannot|unable to) connect|connection (refused|dropped|error|lost|reset)|temporar|overloaded|high demand|internal server error|\b50[0234]\b|\b529\b|network/i

const messageOf = (error: unknown): { readonly code?: number; readonly message: string; readonly data?: unknown } => {
  if (Predicate.isObject(error)) {
    const code = 'code' in error && Predicate.isNumber(error.code) ? error.code : undefined
    const message = 'message' in error && Predicate.isString(error.message) ? error.message : JSON.stringify(error)
    const data = 'data' in error ? error.data : undefined
    return { ...(code === undefined ? {} : { code }), message, ...(data === undefined ? {} : { data }) }
  }
  return { message: String(error) }
}

const UNITS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^ms$/i, 1],
  [/^(?:d|days?)$/i, 86_400_000],
  [/^(?:h|hours?|hrs?)$/i, 3_600_000],
  [/^(?:m|minutes?|mins?)$/i, 60_000],
  [/^(?:s|seconds?|secs?)$/i, 1000],
]

const isDigit = (text: string, at: number) => {
  const code = text.charCodeAt(at)
  return code >= 48 && code <= 57
}

/**
 * A length of time as agents write it, "3 hours 20 minutes", "19h14m47s",
 * "68940s", "34.07s", "900ms": in ms, or undefined. Read a number and the word
 * after it at a time, not by one regex over the text, which takes time on the
 * square of a long run of digits with no unit after it.
 */
const lengthOf = (text: string): number | undefined => {
  let total: number | undefined
  for (let at = 0; at < text.length;) {
    if (!isDigit(text, at)) {
      at += 1
      continue
    }
    const start = at
    while (isDigit(text, at)) at += 1
    if (text[at] === '.' && isDigit(text, at + 1)) for (at += 1; isDigit(text, at);) at += 1
    const amount = Number(text.slice(start, at))
    let from = at
    while (/\s/.test(text[from] ?? '')) from += 1
    let to = from
    while (/[a-z]/i.test(text[to] ?? '')) to += 1
    const scale = UNITS.find(([named]) => named.test(text.slice(from, to)))?.[1]
    if (scale !== undefined) {
      total = (total ?? 0) + amount * scale
      at = to
    }
  }
  return total
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** The fixed zones agents name by their letters (Gemini's "3:05 PM PDT"), in hours from UTC. */
const ZONES: Readonly<Record<string, number>> = { UTC: 0, GMT: 0, PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4 }

/** How far a zone is ahead of UTC at an instant, in ms; undefined for a zone this computer doesn't know. */
const aheadIn = (zone: string, at: number): number | undefined => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(at))
    const part = (type: string) => Number(parts.find((each) => each.type === type)?.value)
    return (
      Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.floor(at / 1000) * 1000
    )
  } catch {
    return undefined
  }
}

/** A wall clock's day and time in a zone (IANA, a fixed offset in hours, or this computer's own), as an instant. */
const instantOf = (wall: { y: number; mo: number; d: number; h: number; mi: number; s: number }, zone: string | number | undefined) => {
  const utc = Date.UTC(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s)
  if (typeof zone === 'number') return utc - zone * 3_600_000
  if (zone === undefined) return new Date(wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s).getTime()
  const ahead = aheadIn(zone, utc)
  if (ahead === undefined) return undefined
  // Once more at the guess, for a reset across a change of the clocks.
  return utc - (aheadIn(zone, utc - ahead) ?? ahead)
}

/** Today's date on the zone's wall clock. */
const todayIn = (zone: string | number | undefined, now: number) => {
  const ahead = typeof zone === 'number' ? zone * 3_600_000 : zone === undefined ? undefined : aheadIn(zone, now)
  const date = ahead === undefined ? new Date(now) : new Date(now + ahead)
  return ahead === undefined
    ? { y: date.getFullYear(), mo: date.getMonth(), d: date.getDate() }
    : { y: date.getUTCFullYear(), mo: date.getUTCMonth(), d: date.getUTCDate() }
}

/**
 * A reset said as a time on a clock: "try again at 3:05 PM" (Codex, this
 * computer's time), "resets 3pm (Europe/Budapest)" and "resets Oct 24, 3pm
 * (Europe/Budapest)" (Claude Code), "resets at 3:05 PM PDT" (Gemini's),
 * "reset on October 23, 2026 at 3:05 PM" (Copilot), "refresh on July 15,
 * 2026" (Antigravity), "reset at 07-27 09:25:00 UTC" (Qwen Code). A time with
 * no day is the next one to come.
 */
const clockTime = (text: string, now: Date): number | undefined => {
  const qwen = /reset at (\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? UTC/i.exec(text)
  if (qwen !== null) {
    const [mo, d, h, mi, s] = qwen.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number]
    const at = Date.UTC(now.getUTCFullYear(), mo - 1, d, h, mi, s)
    return at < now.getTime() ? Date.UTC(now.getUTCFullYear() + 1, mo - 1, d, h, mi, s) : at
  }
  const said =
    /(?:try again at|resets? at|resets|reset on|refresh(?:es|ed)? on)\s+(?:([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\s*(?:at\s+)?)?(?:(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?)?\s*(?:\(([a-z_]+(?:\/[a-z_+-]+)+)\)|\b(UTC|GMT|[PMCE][SD]T)\b)?/i.exec(
      text,
    )
  if (said === null) return undefined
  const [, monthName, day, year, hour, minute, half, iana, letters] = said
  const month = monthName === undefined ? -1 : MONTHS.indexOf(monthName.slice(0, 3).toLowerCase())
  if ((monthName !== undefined && month < 0) || (month < 0 && hour === undefined)) return undefined
  const zone: string | number | undefined = iana ?? (letters === undefined ? undefined : ZONES[letters.toUpperCase()])
  const h = hour === undefined ? 0 : (Number(hour) % 12) + (half?.toLowerCase() === 'p' ? 12 : 0)
  const time = { h, mi: Number(minute ?? 0), s: 0 }
  const today = todayIn(zone, now.getTime())
  const date = month < 0 ? today : { y: year === undefined ? today.y : Number(year), mo: month, d: Number(day) }
  const at = instantOf({ ...date, ...time }, zone)
  if (at === undefined || at > now.getTime()) return at
  // Past already: the same time tomorrow, or the same day next year where no year was said.
  if (month < 0) return instantOf({ ...date, d: date.d + 1, ...time }, zone)
  return year === undefined ? instantOf({ ...date, y: date.y + 1, ...time }, zone) : at
}

/**
 * When a limit resets, from the forms agents use:
 * - `…|1759075200`, Claude Code's old usage-limit message, in epoch seconds;
 * - an ISO 8601 time;
 * - a length from now: "try again in 2 hours 13 minutes", "reset in 3 hours
 *   20 minutes", "in under a minute" (Copilot), "reset after 19h14m47s",
 *   "retry in 34.07s", "Suggested retry after 68940s" (Gemini's);
 * - a time on a clock (`clockTime`).
 */
export const resetTime = (text: string, now: Date): string | undefined => {
  const epoch = /\|(\d{10})\b/.exec(text)
  if (epoch?.[1] !== undefined) return new Date(Number(epoch[1]) * 1000).toISOString()
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\b/.exec(text)
  if (iso?.[1] !== undefined) return new Date(iso[1]).toISOString()
  if (/(?:try again|resets?|retry) in under a minute/i.test(text)) return new Date(now.getTime() + 60_000).toISOString()
  const relative = /(?:try again|resets?|retry) (?:in|after)\s+((?:\d+(?:\.\d+)?\s*[a-z]+[\s,]*(?:and\s+)?)+)/i.exec(text)
  const length = relative?.[1] === undefined ? undefined : lengthOf(relative[1])
  if (length !== undefined) return new Date(now.getTime() + length).toISOString()
  const at = clockTime(text, now)
  return at === undefined || Number.isNaN(at) ? undefined : new Date(at).toISOString()
}

const withReset = (failure: FailureClass, message: string, text: string, now: Date): Classified => {
  const resetsAt = failure === 'usage_limit' ? resetTime(text, now) : undefined
  return { failure, message, ...(resetsAt === undefined ? {} : { resetsAt }) }
}

/** Classifies an error an agent returned, from its code and text. */
export const classify = (error: unknown, now: Date): Classified => {
  const { code, message, data } = messageOf(error)
  const text = `${message} ${Predicate.isString(data) ? data : data === undefined ? '' : JSON.stringify(data)}`
  if (sessionCap.test(text)) return { failure: 'context_full', message }
  if (passing.test(text)) return { failure: 'transient', message }
  if (gone.test(text)) return { failure: 'auth_required', message }
  if (/\|\d{10}\b/.test(text)) return withReset('usage_limit', message, text, now)
  // A full context first: "you've reached your context limit" is no plan's.
  if (contextFull.test(text)) return { failure: 'context_full', message }
  if (code === JUNIE_BALANCE || code === VIBE_RATE_LIMIT || usageLimit.test(text)) return withReset('usage_limit', message, text, now)
  if (code === AUTH_REQUIRED || authRequired.test(text)) return { failure: 'auth_required', message }
  if (code === INVALID_PARAMS || code === METHOD_NOT_FOUND) return { failure: 'invalid_request', message }
  if (transient.test(text)) return { failure: 'transient', message }
  return { failure: 'unknown', message }
}

/**
 * What a client puts in `clientCapabilities._meta` to have Claude Code's
 * adapter report failures in structured form (the JetBrains AIR
 * `sessionFailure` extension, version 1).
 */
export const structuredFailureCapability = { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } }

export interface StructuredFailure {
  readonly severity: 'warning' | 'error'
  readonly classified: Classified
}

const field = (record: object, key: string): unknown => (key in record ? (record as Record<string, unknown>)[key] : undefined)
const textField = (record: object, key: string): string => {
  const value = field(record, key)
  return Predicate.isString(value) ? value : ''
}

const kindOf = (category: string, actions: ReadonlyArray<string>): FailureClass => {
  switch (category) {
    case 'limit':
      if (actions.includes('retry')) return 'transient'
      return actions.includes('new_session') ? 'context_full' : 'usage_limit'
    case 'access':
      return 'auth_required'
    case 'request':
      return 'invalid_request'
    case 'service':
    case 'connection':
      return 'transient'
    default:
      return 'unknown'
  }
}

/**
 * Reads a failure Claude Code reported in a `session_info_update`'s `_meta`.
 * The payload names a category and the actions that would help, not the kind,
 * but together they tell the kinds apart: a limit you can retry is a rate
 * limit, one that needs a new session is a full context, and one with no
 * action is an exhausted quota.
 */
export const structuredFailure = (meta: unknown, now: Date): StructuredFailure | undefined => {
  const jetbrains = Predicate.isObject(meta) ? field(meta, 'jetbrains') : undefined
  const air = Predicate.isObject(jetbrains) ? field(jetbrains, 'air') : undefined
  const failure = Predicate.isObject(air) ? field(air, 'sessionFailure') : undefined
  if (!Predicate.isObject(failure)) return undefined
  const actionsField = field(failure, 'actions')
  const actions = Array.isArray(actionsField) ? actionsField.filter(Predicate.isString) : []
  const message = [textField(failure, 'title'), textField(failure, 'details'), textField(failure, 'reason')]
    .filter((part) => part !== '')
    .join(' ')
  const severity = textField(failure, 'severity') === 'warning' ? 'warning' : 'error'
  const kind = kindOf(textField(failure, 'category'), actions)
  // A warning that the agent is trying again by itself is a short limit, though it names no action, as Claude Code's at a 429.
  const read = severity === 'warning' && kind === 'usage_limit' && /\b(retrying|reconnecting)\b/i.test(message) ? 'transient' : kind
  return { severity, classified: withReset(read, message, message, now) }
}
