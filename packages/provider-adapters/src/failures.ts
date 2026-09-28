import { Predicate } from 'effect'

/*
 * What went wrong with a request to an agent, in the classes of
 * docs/architecture/03's failure table. ACP has no usage-limit message, so a
 * limit is recognised from the error the agent returns (layer 1 of "Usage
 * limits"): every agent's error is classified here, with the reset time when
 * the error carries one.
 */

export type FailureClass = 'usage_limit' | 'auth_required' | 'invalid_request' | 'transient' | 'unknown'

export interface Classified {
  readonly failure: FailureClass
  readonly message: string
  /** When a usage limit resets, as ISO 8601 in UTC, if the error said. */
  readonly resetsAt?: string
}

/** JSON-RPC and ACP error codes. */
const AUTH_REQUIRED = -32000
const INVALID_PARAMS = -32602
const METHOD_NOT_FOUND = -32601

const usageLimit = /usage limit|rate.?limit|quota|too many requests|\b429\b|limit reached/i
const authRequired = /auth(entication)? required|not (logged|signed) in|log ?in|sign ?in|unauthori[sz]ed|\b401\b/i
const transient = /timed? ?out|econnreset|econnrefused|temporar|overloaded|\b50[234]\b|network/i

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

export const classify = (error: unknown, now: Date): Classified => {
  const { code, message, data } = messageOf(error)
  const text = `${message} ${Predicate.isString(data) ? data : data === undefined ? '' : JSON.stringify(data)}`
  if (usageLimit.test(text)) {
    const resetsAt = resetTime(text, now)
    return { failure: 'usage_limit', message, ...(resetsAt === undefined ? {} : { resetsAt }) }
  }
  if (code === AUTH_REQUIRED || authRequired.test(text)) return { failure: 'auth_required', message }
  if (code === INVALID_PARAMS || code === METHOD_NOT_FOUND) return { failure: 'invalid_request', message }
  if (transient.test(text)) return { failure: 'transient', message }
  return { failure: 'unknown', message }
}
