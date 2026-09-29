import { Predicate } from 'effect'

/*
 * What went wrong with a request to an agent, in the classes of
 * docs/architecture/03's failure table. Each class leads somewhere different:
 * a usage limit pauses every session on the account and moves the work; a
 * short rate limit or an overloaded service is retried after a pause; a full
 * context starts a new session from a brief (docs/architecture/05).
 *
 * Claude Code reports failures in structured form when asked (see
 * `structuredFailure`); for every other agent, and as a fallback, the error
 * text is read here.
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

/** A plan or account allowance used up until a reset. A bare rate limit or 429 is not one: it is usually per minute. */
const usageLimit = /usage limit|quota|plan limit|limit reached|out of (credits|usage)|insufficient.?(credits|balance)/i
const contextFull =
  /context (window|length)|too (many|long).{0,20}tokens|prompt is too long|context.{0,20}(exceeded|full|exhausted)|maximum context/i
const authRequired =
  /auth(entication)? required|not (logged|signed) in|please (log|sign) ?in|(log|sign) ?in to continue|unauthori[sz]ed|\b401\b|invalid api key/i
const transient = /rate.?limit|too many requests|\b429\b|timed? ?out|econnreset|econnrefused|temporar|overloaded|\b50[234]\b|network/i

const messageOf = (error: unknown): { readonly code?: number; readonly message: string; readonly data?: unknown } => {
  if (Predicate.isObject(error)) {
    const code = 'code' in error && Predicate.isNumber(error.code) ? error.code : undefined
    const message = 'message' in error && Predicate.isString(error.message) ? error.message : JSON.stringify(error)
    const data = 'data' in error ? error.data : undefined
    return { ...(code === undefined ? {} : { code }), message, ...(data === undefined ? {} : { data }) }
  }
  return { message: String(error) }
}

/**
 * When a limit resets, from the forms agents use:
 * - `…|1759075200`, Claude Code's usage-limit message, in epoch seconds;
 * - an ISO 8601 time;
 * - "try again in 2 hours 13 minutes", relative to `now`.
 */
export const resetTime = (text: string, now: Date): string | undefined => {
  const epoch = /\|(\d{10})\b/.exec(text)
  if (epoch?.[1] !== undefined) return new Date(Number(epoch[1]) * 1000).toISOString()
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\b/.exec(text)
  if (iso?.[1] !== undefined) return new Date(iso[1]).toISOString()
  const relative = /(?:try again|resets?) in\s+(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(
    text,
  )
  if (relative !== null && (relative[1] ?? relative[2] ?? relative[3]) !== undefined) {
    const minutes = Number(relative[1] ?? 0) * 1440 + Number(relative[2] ?? 0) * 60 + Number(relative[3] ?? 0)
    return new Date(now.getTime() + minutes * 60_000).toISOString()
  }
  return undefined
}

const withReset = (failure: FailureClass, message: string, text: string, now: Date): Classified => {
  const resetsAt = failure === 'usage_limit' ? resetTime(text, now) : undefined
  return { failure, message, ...(resetsAt === undefined ? {} : { resetsAt }) }
}

/** Classifies an error an agent returned, from its code and text. */
export const classify = (error: unknown, now: Date): Classified => {
  const { code, message, data } = messageOf(error)
  const text = `${message} ${Predicate.isString(data) ? data : data === undefined ? '' : JSON.stringify(data)}`
  if (usageLimit.test(text) || /\|\d{10}\b/.test(text)) return withReset('usage_limit', message, text, now)
  if (contextFull.test(text)) return { failure: 'context_full', message }
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
  return { severity, classified: withReset(kindOf(textField(failure, 'category'), actions), message, message, now) }
}
