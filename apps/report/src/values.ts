/*
 * Small checks for values whose shape isn't known yet: a parsed JSON body,
 * an answer from Linear, a binding from the environment. Each narrows
 * `unknown` by looking, never by assuming.
 */

/** A plain object whose fields are still to be checked one by one. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What kind of error something thrown was, without its message, which may carry what it was about. */
export const nameOf = (error: unknown): string => (error instanceof Error ? error.name : typeof error)
