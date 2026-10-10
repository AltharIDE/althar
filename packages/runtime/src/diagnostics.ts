/** Execution evidence is an observation, never a causal diagnosis or instruction. */
export interface ToolDiagnostic {
  readonly text: string
  readonly source: 'tool-output'
  readonly truncated: boolean
  readonly redacted: boolean
}

const LIMIT = 8_000
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** Do not ingest arbitrary objects/file bodies. Providers use these explicit execution-output fields. */
const outputText = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  const fields = record(value)
  return [
    ...['stdout', 'stderr', 'output', 'error', 'message'].flatMap((key) =>
      typeof fields[key] === 'string' ? [fields[key] as string] : [],
    ),
    ...['exitCode', 'exit_code'].flatMap((key) => (typeof fields[key] === 'number' ? [`exit code: ${fields[key]}`] : [])),
  ]
}

/** Best-effort credential filtering; unrecognized secrets cannot be guaranteed removable. */
const redact = (text: string) =>
  text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(
      /((?:[\w.-]*(?:api[_-]?key|token|secret|password|passwd|credential)[\w.-]*|authorization)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')

export const diagnosticOf = (input: {
  readonly kind: unknown
  readonly rawInput: unknown
  readonly rawOutput?: unknown
  readonly outputText?: ReadonlyArray<string> | undefined
  readonly previous?: unknown
}): ToolDiagnostic | undefined => {
  if (input.kind !== 'execute') return undefined
  const command = record(input.rawInput).command ?? record(input.rawInput).cmd
  // Shell file/credential reads are not a diagnostics channel, even if labelled execute.
  if (
    typeof command === 'string' &&
    /(?:^|[\s;|&])(cat|head|tail|less|more|sed|awk|printenv|env|base64)(?:\s|$)|\.env\b|PRIVATE KEY/i.test(command)
  )
    return undefined
  const parts = [...outputText(input.rawOutput), ...(input.outputText ?? [])]
  // Strip terminal ANSI styling from durable plain-text evidence.
  // eslint-disable-next-line no-control-regex
  const original = [...new Set(parts)].join('\n').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
  if (original.length === 0) return undefined
  const filtered = redact(original)
  const previous = record(input.previous)
  const prior = typeof previous.text === 'string' ? previous.text : ''
  // Accept both cumulative snapshots and output chunks without duplicating snapshots.
  const safe = prior.length === 0 || filtered.startsWith(prior) ? filtered : prior.includes(filtered) ? prior : `${prior}\n${filtered}`
  const truncated = safe.length > LIMIT || previous.truncated === true
  // Keep setup and final assertion/stack evidence, rather than only verbose startup logs.
  const text = truncated ? `${safe.slice(0, LIMIT / 2)}\n[diagnostic excerpt truncated]\n${safe.slice(-LIMIT / 2)}` : safe
  return { text, source: 'tool-output', truncated, redacted: filtered !== original || previous.redacted === true }
}
