/*
 * A change to a setting, said in plain words (ADR-097). Lists and objects are
 * diffed, never printed: what a line says is what moved, `Added force-push to
 * Never` or `Turned on Kimi K3.1 Pro in OpenCode`, with real names. A setting
 * may say its own words (the agents' models do); every other is said by the
 * generic diff here. The same words go on the thread's line, in the answer to
 * the agent that made the change and, through the card, in Settings.
 */

/** The names a setting's ids go by on screen. */
export interface Names {
  /** An agent, by its id: Codex, OpenCode. */
  readonly agent: (agentId: string) => string
  /** A model of an agent, by its id: GPT-6 Luna, Kimi K3.1 Pro. */
  readonly model: (agentId: string, model: string) => string
}

export const plainNames: Names = { agent: (id) => id, model: (_agent, model) => model }

type Plain = Readonly<Record<string, unknown>>

const isMap = (value: unknown): value is Plain => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The longest a value is let run in a line, so one long word never fills it. */
const LONGEST = 60

const clip = (text: string) => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text)

/** A value as a line says it: on or off, none, a list's items, an object's pairs, or as it is; never as JSON, and cut short. */
export const inWords = (value: unknown): string => clip(wordsOf(value))

const wordsOf = (value: unknown): string => {
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map(itemWords).join(', ')
  if (isMap(value)) {
    const pairs = Object.entries(value).map(([key, one]) => `${key}: ${wordsOf(one)}`)
    return pairs.length === 0 ? 'none' : pairs.join(', ')
  }
  // A function or a symbol is no setting's value.
  return ''
}

/** One item of a list: a name as it is, a rule as its pattern and what it decides, any other object by its values. */
const itemWords = (item: unknown): string => {
  if (isMap(item) && typeof item['pattern'] === 'string' && typeof item['decision'] === 'string')
    return `${item['pattern']} (${item['decision']})`
  if (isMap(item)) return Object.values(item).map(wordsOf).join(' ')
  return wordsOf(item)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * What changed between two values of one setting, in words, a line for each thing: an item added to or taken out of a
 * list, a key of an object that moved (down to what it holds), or a plain value's before and after.
 */
export const changesOf = (label: string, before: unknown, after: unknown): ReadonlyArray<string> => {
  if (same(before, after)) return []
  if (Array.isArray(after) && (Array.isArray(before) || before === null || before === undefined)) {
    const was = (before ?? []) as ReadonlyArray<unknown>
    const kept = (items: ReadonlyArray<unknown>) => new Set(items.map(itemWords))
    const wasWords = kept(was)
    const nowWords = kept(after)
    return [
      ...after.filter((one) => !wasWords.has(itemWords(one))).map((one) => `Added ${clip(itemWords(one))} to ${label}`),
      ...was.filter((one) => !nowWords.has(itemWords(one))).map((one) => `Removed ${clip(itemWords(one))} from ${label}`),
    ]
  }
  if (Array.isArray(before) && after === null) return before.map((one) => `Removed ${clip(itemWords(one))} from ${label}`)
  if (isMap(after) && isMap(before)) return Object.keys(after).flatMap((key) => changesOf(`${label} › ${key}`, before[key], after[key]))
  return [`${label}: ${inWords(before)} → ${inWords(after)}`]
}

/** The words an agent's models are told in: Turned on GPT-6 Luna in Codex. */
export const modelsTurnedOff = (before: unknown, after: unknown, names: Names): ReadonlyArray<string> => {
  const agentsAfter = isMap(after) ? after : {}
  const agentsBefore = isMap(before) ? before : {}
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])
  return Object.entries(agentsAfter).flatMap(([agentId, now]) => {
    const was = new Set(list(agentsBefore[agentId]))
    const off = new Set(list(now))
    return [
      ...[...off].filter((model) => !was.has(model)).map((model) => `Turned off ${names.model(agentId, model)} in ${names.agent(agentId)}`),
      ...[...was].filter((model) => !off.has(model)).map((model) => `Turned on ${names.model(agentId, model)} in ${names.agent(agentId)}`),
    ]
  })
}

/** Default efforts, by "agent/model": Default effort for Claude Opus 5.5: high → xhigh. */
export const defaultEfforts = (before: unknown, after: unknown, names: Names): ReadonlyArray<string> => {
  const was = isMap(before) ? before : {}
  return Object.entries(isMap(after) ? after : {}).flatMap(([key, effort]) => {
    if (was[key] === effort) return []
    const at = key.indexOf('/')
    const model = at > 0 ? names.model(key.slice(0, at), key.slice(at + 1)) : key
    return [`Default effort for ${model}: ${inWords(was[key])} → ${inWords(effort)}`]
  })
}

/** A change's lines for the agent that made it: the first few, then how many more, so a hundred models never run on. */
export const said = (lines: ReadonlyArray<string>, most = 8): string =>
  lines.length <= most ? lines.join('; ') : `${lines.slice(0, most).join('; ')}; and ${lines.length - most} more`
