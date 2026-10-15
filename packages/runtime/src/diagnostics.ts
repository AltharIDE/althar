/*
 * What a failed command printed, kept short on its item with its status
 * (docs/architecture/07), so an agent that takes the task over after a
 * restart or a switch reads in its brief what failed, not only that it did.
 * It is what the tool reported, not why it failed. The whole output is the
 * item's artifact; this is a bounded excerpt, with what looks like a
 * credential taken out first.
 */

export interface Diagnostic {
  readonly text: string
  /** Its middle was left out, to keep it within DIAGNOSTIC_KEPT. */
  readonly truncated: boolean
  /** Something that looked like a credential was taken out. */
  readonly redacted: boolean
}

/** How much of what a failed command printed is kept: its start and its end, where the failure usually is. */
export const DIAGNOSTIC_KEPT = 4_000
const HEAD = 1_000
const LEFT_OUT = '\n[…]\n'

const recordIn = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}

/** The output fields of what came back, by name: never a whole object, which may hold a file's contents. */
const printedFields = (rawOutput: unknown): ReadonlyArray<string> => {
  if (typeof rawOutput === 'string') return [rawOutput]
  const fields = recordIn(rawOutput)
  return ['stdout', 'stderr', 'output', 'error', 'message'].flatMap((key) => {
    const value = fields[key]
    return typeof value === 'string' ? [value] : []
  })
}

const exitFields = (rawOutput: unknown): number | null => {
  const fields = recordIn(rawOutput)
  const exit = fields.exitCode ?? fields.exit_code
  return typeof exit === 'number' ? exit : null
}

/**
 * A command that reads files or the environment: what it prints is what it
 * read, not a failure's output. At the start of a command, or after `;`,
 * `&&`, `||` or `xargs`; one a pipe feeds reads what came before it, as
 * `bun test | tail -50` does, and is kept. `env` reads the environment only
 * on its own: `env CI=1 bun test` runs a command.
 */
const READS =
  /(?:^|[;&(`]|\|\||\bxargs)\s*(?:sudo\s+)?(?:(?:cat|head|tail|less|more|sed|awk|grep|rg|base64|xxd|od|strings|printenv)(?:\s|$)|env\s*(?:$|[|;&>]))|\.env\b|PRIVATE KEY/i

/**
 * A name and its value, `API_KEY=…` or `"token": "…"`: the name read whole
 * from where it starts, once (`(?=(…))\1` takes no part of it back), so a long
 * run of letters costs its length, not its square.
 */
const NAMED = /(?<![\w.-])(?=([\w.-]+))\1(\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/g
const SECRET_NAME = /api[_-]?key|token|secret|passw(?:or)?d|credential|^authorization$/i

/** Best-effort: a credential it doesn't recognise stays. */
const redact = (text: string) =>
  text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}\b)/g, '[REDACTED]')
    .replace(NAMED, (pair, name: string, between: string) => (SECRET_NAME.test(name) ? `${name}${between}[REDACTED]` : pair))
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')

/** How much of a long output is read for credentials: far more than is kept, from its start and its end. */
const READ_HEAD = 16 * 1024
const READ_TAIL = 48 * 1024

/**
 * A failed command's diagnostic: what it printed (or, where the agent sent
 * none of it as output, the output fields of what came back), what the tool
 * said of the failure, and its exit code. None for a command that reads
 * files, or one that said nothing.
 */
export const diagnosticOf = (failed: {
  readonly command: string | undefined
  /** What it printed, as the terminal or the tool's own words gave it. */
  readonly printed: string
  /** What the tool said of how it failed, beside its output. */
  readonly error: string | null
  readonly exit: number | null
  readonly rawOutput: unknown
}): Diagnostic | undefined => {
  if (failed.command !== undefined && READS.test(failed.command)) return undefined
  const said = [...(failed.printed === '' ? printedFields(failed.rawOutput) : [failed.printed]), failed.error ?? '']
    // Terminal styling isn't text.
    // eslint-disable-next-line no-control-regex
    .map((part) => part.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').trim())
    .filter((part) => part !== '')
  // What one part says again of another is said once.
  const parts = said.filter((part, at) => !said.some((other, by) => by !== at && other.includes(part) && (other !== part || by < at)))
  const exit = failed.exit ?? exitFields(failed.rawOutput)
  const whole = [...parts, ...(exit === null ? [] : [`exit code: ${exit}`])].join('\n')
  if (whole === '') return undefined
  // Credentials are taken out before it is cut to size, so none is left half there at a cut.
  const read = whole.length > READ_HEAD + READ_TAIL ? `${whole.slice(0, READ_HEAD)}${LEFT_OUT}${whole.slice(-READ_TAIL)}` : whole
  const text = redact(read)
  const truncated = read !== whole || text.length > DIAGNOSTIC_KEPT
  return {
    text: text.length > DIAGNOSTIC_KEPT ? `${text.slice(0, HEAD)}${LEFT_OUT}${text.slice(-(DIAGNOSTIC_KEPT - HEAD))}` : text,
    truncated,
    redacted: text !== read,
  }
}

/** A diagnostic as an item keeps it, or null where it keeps none. */
export const diagnosticIn = (value: unknown): Diagnostic | null => {
  const kept = recordIn(value)
  return typeof kept.text === 'string' && kept.text !== ''
    ? { text: kept.text, truncated: kept.truncated === true, redacted: kept.redacted === true }
    : null
}
