import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { Effect, Option, Schema } from 'effect'

import { fixedReason } from './rules'

/*
 * The agents' own permission settings, as the first draft of a project's
 * rules (DEV-41, ADR-034). Teams tune them for months: Claude Code's
 * `permissions` in `.claude/settings.json`, Codex's rules, OpenCode's
 * `permission` in `opencode.json`. Althar reads them, says what each rule
 * would be in the project's rules, or why it can't be one, and the person
 * takes all of it, some or none. Nothing is kept until they do, and what
 * they take is a copy: Althar never writes the agents' files, nor reads them
 * again on its own.
 *
 * A refusal becomes a never, an ask an always ask, an allow an allow rule.
 * A command matched whole stays whole; one matched by how it starts
 * (`Bash(npm test:*)`, `npm test *`) is a rule by how it starts. Rules on
 * paths, the web, MCP tools or the agents' other tools aren't commands, and
 * Althar's rules don't hold them yet: they are said as skipped, with why.
 */

/** The agents whose own settings are read. */
export type RulesAgent = 'claude' | 'codex' | 'opencode'

/** Where a rule came from: the agent, and its file as the person would find it (`.claude/settings.json`, `~/.codex/rules/default.rules`). */
export interface RuleSource {
  readonly agent: RulesAgent
  readonly file: string
}

/** What a rule decides, in the project's words: never allowed, always asks, or let through. */
export type Decision = 'never' | 'ask' | 'allow'

/** Why one of an agent's rules isn't one of the project's. */
export type Skip =
  /** It is on files or folders, which the rules don't hold yet. */
  | 'paths'
  /** It is on the web: fetches, searches, domains. */
  | 'network'
  /** It is on an MCP server's tools. */
  | 'mcp'
  /** It is on another of the agent's tools, or on how a command runs rather than what it says. */
  | 'tool'
  /** It is for every command, or everything: what the rest does says that, in the project's rules. */
  | 'every-command'
  /** Its wildcard can't be said the same way: one first, a `?`, or, for an allow, one before the end, which would let more through. */
  | 'wildcard'
  /** Althar's rules can't say it the same way: a word Codex matches whole that has a space in it, a decision the agent doesn't know. */
  | 'unsayable'
  /** It is for one of OpenCode's agents; a project's rules hold for every agent. */
  | 'one-agent'
  /** What no project can change says it already: reading credentials, or changing the code host. */
  | 'fixed'
  /** The project's rules have it already. */
  | 'already'
  /** The same words are never allowed, here or in the agents' settings, which comes first. */
  | 'under-never'
  /** The same words always ask, here or in the agents' settings, which comes first. */
  | 'under-ask'

/** A command as a rule names it: by how it starts, or the whole line. */
export interface CommandPattern {
  readonly pattern: string
  readonly match: 'prefix' | 'exact'
}

/** One of an agent's rules as its file says it, read but not yet weighed against the project's. */
export interface Found {
  readonly from: RuleSource
  /** The rule as the file has it: `Bash(rm -rf:*)`, `prefix_rule(pattern = ["git", "push"], decision = "forbidden")`. */
  readonly said: string
  readonly decision: Decision
  /** The command it becomes, or why it doesn't become one. */
  readonly becomes: CommandPattern | { readonly skip: Skip }
}

/** A rule of the agents' as the project is offered it: the command rule it becomes, or why it isn't one. */
export type Offered = {
  /** The same for the same rule from the same file, so a choice made from what was read names it again. */
  readonly id: string
  readonly from: RuleSource
  readonly said: string
  readonly decision: Decision
} & ({ readonly rule: CommandPattern; readonly skipped?: undefined } | { readonly skipped: Skip; readonly rule?: undefined })

/** A file read: what it is, and whether Althar could read it as the agent does. */
export interface FileRead {
  readonly from: RuleSource
  readonly readable: boolean
}

/** A command rule as the project keeps it, with where it came from, where it was copied from an agent's settings. */
export interface KeptCommand {
  readonly pattern: string
  readonly decision: Decision
  readonly match?: 'prefix' | 'exact' | undefined
  readonly from?: RuleSource | undefined
}

// ---- Commands as Claude Code and OpenCode write them ---------------------------

/**
 * A command pattern as Claude Code's and OpenCode's rules write it, matched
 * against the whole line, `*` for any text: as Althar's rules say it.
 * Without a wildcard, the line itself. With one only at its end, how a
 * command starts: `npm test *` (and Claude Code's `npm test:*`) is `npm
 * test`, which matches `npm test` alone too, as theirs does; `ls*` keeps
 * its `*`, as `lsof` starts with `ls`. A wildcard before the end is kept
 * for a never or an ask, where Althar's reading, by how a command starts,
 * catches a little more; an allow would let more through, so it is skipped.
 * One at the start can't be said: Althar's rules go by a command's program.
 */
export const commandPattern = (raw: string, decision: Decision, agent: 'claude' | 'opencode'): CommandPattern | { readonly skip: Skip } => {
  let text = raw.trim().replace(/\s+/g, ' ')
  // Claude Code's older spelling of a trailing wildcard, only at the end.
  if (agent === 'claude' && text.endsWith(':*')) text = `${text.slice(0, -2).trimEnd()} *`.trim()
  if (text === '' || text === '*') return { skip: 'every-command' }
  if (agent === 'opencode' && text.includes('?')) return { skip: 'wildcard' }
  if (!text.includes('*')) return { pattern: raw.trim(), match: 'exact' }
  if (text.startsWith('*')) return { skip: 'wildcard' }
  const head = text.endsWith(' *') ? text.slice(0, -2).trimEnd() : text
  const inner = head.slice(0, -1).includes('*')
  if (inner && decision === 'allow') return { skip: 'wildcard' }
  return { pattern: head, match: 'prefix' }
}

// ---- Claude Code ---------------------------------------------------------------

const Strings = Schema.Array(Schema.Unknown)
const ClaudeSettings = Schema.Struct({
  permissions: Schema.optional(
    Schema.Struct({ allow: Schema.optional(Strings), ask: Schema.optional(Strings), deny: Schema.optional(Strings) }),
  ),
})

/** Claude Code's tools that work on files, whose rules are paths. */
const CLAUDE_PATHS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS']
/** Claude Code's tools on the web, whose rules are domains or nothing. */
const CLAUDE_WEB = ['WebFetch', 'WebSearch']
/** What a Bash rule names when it is on how a command runs, not what it says: `Bash(run_in_background:true)`. */
const BASH_PARAMETER = /^(command|run_in_background|timeout|description|dangerouslyDisableSandbox):/

/** One of Claude Code's permission rules: `Tool` or `Tool(what)`. */
const claudeRule = (said: string, decision: Decision): Found['becomes'] => {
  const [, tool = '', inside] = /^([^(]*)(?:\((.*)\))?$/s.exec(said.trim()) ?? []
  const name = tool.trim()
  if (name === 'Bash') {
    if (inside === undefined) return { skip: 'every-command' }
    if (BASH_PARAMETER.test(inside.trim())) return { skip: 'tool' }
    return commandPattern(inside, decision, 'claude')
  }
  if (name.startsWith('mcp__')) return { skip: 'mcp' }
  if (CLAUDE_PATHS.includes(name)) return { skip: 'paths' }
  if (CLAUDE_WEB.includes(name)) return { skip: 'network' }
  // A glob for every tool, `*`, is everything.
  if (name === '*') return { skip: 'every-command' }
  return { skip: 'tool' }
}

/** Claude Code's permission rules in a settings file: its deny, ask and allow lists, in that order, as Claude Code weighs them. */
export const fromClaude = (text: string, from: RuleSource): ReadonlyArray<Found> | null => {
  const settings = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(ClaudeSettings))(text))
  if (settings === undefined) return null
  const lists: ReadonlyArray<readonly [Decision, ReadonlyArray<unknown> | undefined]> = [
    ['never', settings.permissions?.deny],
    ['ask', settings.permissions?.ask],
    ['allow', settings.permissions?.allow],
  ]
  return lists.flatMap(([decision, said = []]) =>
    said.flatMap((rule) =>
      typeof rule === 'string' && rule.trim() !== '' ? [{ from, said: rule.trim(), decision, becomes: claudeRule(rule, decision) }] : [],
    ),
  )
}

// ---- OpenCode ------------------------------------------------------------------

/** OpenCode's permissions on files and folders. */
const OPENCODE_PATHS = ['read', 'edit', 'write', 'patch', 'glob', 'grep', 'list', 'external_directory']
/** Its permissions on the web. */
const OPENCODE_WEB = ['webfetch', 'websearch', 'codesearch']
/** OpenCode's actions, as the project's decisions. */
const OPENCODE_ACTIONS: Readonly<Record<string, Decision>> = { deny: 'never', ask: 'ask', allow: 'allow' }

/**
 * JSON with comments and trailing commas, as OpenCode reads its config, as
 * plain JSON: what is in strings stays as it is.
 */
export const plainJson = (text: string): string => {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === '"') {
      // A string, to its closing quote, escapes and all.
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The rules of one `permission` block: each tool's, by its patterns where it has them; `agent` where it is one of OpenCode's agents'. */
const openCodePermissions = (permission: unknown, from: RuleSource, agent: string | null): ReadonlyArray<Found> => {
  const found = (said: string, action: unknown, becomes: (decision: Decision) => Found['becomes']): ReadonlyArray<Found> => {
    const decision = typeof action === 'string' ? OPENCODE_ACTIONS[action] : undefined
    if (decision === undefined) return []
    return [
      {
        from,
        said: agent === null ? said : `agent.${agent}: ${said}`,
        decision,
        becomes: agent === null ? becomes(decision) : { skip: 'one-agent' },
      },
    ]
  }
  if (typeof permission === 'string') return found(`permission: "${permission}"`, permission, () => ({ skip: 'every-command' }))
  if (!isRecord(permission)) return []
  return Object.entries(permission).flatMap(([tool, value]) => {
    const skipOf = (): Skip =>
      tool === '*' || tool === 'bash'
        ? 'every-command'
        : OPENCODE_PATHS.includes(tool)
          ? 'paths'
          : OPENCODE_WEB.includes(tool)
            ? 'network'
            : 'tool'
    if (!isRecord(value)) return found(`${tool}: ${JSON.stringify(value)}`, value, () => ({ skip: skipOf() }))
    return Object.entries(value).flatMap(([pattern, action]) =>
      found(`${tool}: ${JSON.stringify(pattern)}: ${JSON.stringify(action)}`, action, (decision) =>
        tool === 'bash' ? commandPattern(pattern, decision, 'opencode') : { skip: skipOf() },
      ),
    )
  })
}

/** OpenCode's permissions in its config: the `permission` block, then each of its agents'. */
export const fromOpenCode = (text: string, from: RuleSource): ReadonlyArray<Found> | null => {
  let config: unknown
  try {
    config = JSON.parse(plainJson(text))
  } catch {
    return null
  }
  if (!isRecord(config)) return null
  const agents = isRecord(config['agent']) ? Object.entries(config['agent']) : []
  return [
    ...openCodePermissions(config['permission'], from, null),
    ...agents.flatMap(([name, agent]) => (isRecord(agent) ? openCodePermissions(agent['permission'], from, name) : [])),
  ]
}

// ---- Codex ---------------------------------------------------------------------

/*
 * Codex's rules are Starlark: calls such as
 * `prefix_rule(pattern = ["git", "push"], decision = "forbidden")`. They are
 * read as far as rules go (strings, lists, keyword arguments and comments)
 * without running anything. A pattern's place can offer alternatives,
 * `["view", "list"]`, which make a rule for each.
 */

type Token =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'mark'; readonly value: string }

/** A value as a rule's arguments have it: a string, a list, or something else (a number, a name, a call). */
type Value =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<Value> }
  | { readonly kind: 'other' }

/** How many rules alternatives may make of one: more is not a rule a person wrote by hand. */
const MOST_ALTERNATIVES = 64

class Unreadable extends Error {}

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', '0': '\0' }

const tokensOf = (text: string): ReadonlyArray<Token> => {
  const tokens: Array<Token> = []
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (/\s/.test(char)) index += 1
    else if (char === '#') while (index < text.length && text[index] !== '\n') index += 1
    else if (char === '"' || char === "'" || ((char === 'r' || char === 'R') && /["']/.test(text[index + 1] ?? ''))) {
      const raw = char === 'r' || char === 'R'
      const start = raw ? index + 1 : index
      const quote = text[start] ?? ''
      const triple = text.slice(start, start + 3) === quote.repeat(3)
      const close = triple ? quote.repeat(3) : quote
      let at = start + close.length
      let value = ''
      for (;;) {
        if (at >= text.length || (!triple && text[at] === '\n')) throw new Unreadable('A string never closes.')
        if (text.startsWith(close, at)) break
        const each = text[at] ?? ''
        if (each === '\\' && !raw) {
          const next = text[at + 1] ?? ''
          value += ESCAPES[next] ?? next
          at += 2
        } else {
          value += each
          at += 1
        }
      }
      tokens.push({ kind: 'string', value })
      index = at + close.length
    } else if (/[A-Za-z0-9_.]/.test(char)) {
      let end = index
      while (end < text.length && /[A-Za-z0-9_.]/.test(text[end] ?? '')) end += 1
      tokens.push({ kind: 'name', value: text.slice(index, end) })
      index = end
    } else {
      tokens.push({ kind: 'mark', value: char })
      index += 1
    }
  }
  return tokens
}

const isMark = (token: Token | undefined, mark: string) => token?.kind === 'mark' && token.value === mark

/** A call's arguments, as written: keyword arguments by name, the rest in order. */
interface Call {
  readonly name: string
  readonly positional: ReadonlyArray<Value>
  readonly named: ReadonlyMap<string, Value>
}

/** The calls a rules file makes at its top level; anything else in it is passed over. */
const callsOf = (text: string): ReadonlyArray<Call> => {
  const tokens = tokensOf(text)
  let index = 0
  /** Where a value ends: at a comma, or the bracket that closes what it is in. */
  const ends = () => isMark(tokens[index], ',') || isMark(tokens[index], ')') || isMark(tokens[index], ']')
  const primary = (): Value => {
    const token = tokens[index]
    if (token === undefined) throw new Unreadable('A value is missing.')
    if (token.kind === 'string') {
      index += 1
      // Strings side by side are one, as in Python.
      let joined = token.value
      for (let next = tokens[index]; next?.kind === 'string'; next = tokens[index]) {
        joined += next.value
        index += 1
      }
      return { kind: 'string', value: joined }
    }
    if (isMark(token, '[')) {
      index += 1
      const items: Array<Value> = []
      while (!isMark(tokens[index], ']')) {
        items.push(value())
        if (isMark(tokens[index], ',')) index += 1
        else if (!isMark(tokens[index], ']')) throw new Unreadable('A list never closes.')
      }
      index += 1
      return { kind: 'list', items }
    }
    return { kind: 'other' }
  }
  const value = (): Value => {
    const first = primary()
    if (first.kind !== 'other' && ends()) return first
    // Anything else, a number, a name, a call, a sum: to where the value ends.
    while (!ends()) {
      const token = tokens[index]
      if (token === undefined) throw new Unreadable('A value never ends.')
      if (token.kind === 'mark' && ['(', '[', '{'].includes(token.value)) skipGroup()
      else index += 1
    }
    return { kind: 'other' }
  }
  const skipGroup = () => {
    const closing: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' }
    const open: Array<string> = []
    do {
      const token = tokens[index]
      if (token === undefined) throw new Unreadable('A bracket never closes.')
      if (token.kind === 'mark' && closing[token.value] !== undefined) open.push(closing[token.value] ?? '')
      else if (token.kind === 'mark' && token.value === open.at(-1)) open.pop()
      index += 1
    } while (open.length > 0)
  }
  const calls: Array<Call> = []
  while (index < tokens.length) {
    const token = tokens[index]
    if (token?.kind !== 'name' || !isMark(tokens[index + 1], '(')) {
      if (token !== undefined && token.kind === 'mark' && ['(', '[', '{'].includes(token.value)) skipGroup()
      else index += 1
      continue
    }
    index += 2
    const positional: Array<Value> = []
    const named = new Map<string, Value>()
    while (!isMark(tokens[index], ')')) {
      const name = tokens[index]
      if (name?.kind === 'name' && isMark(tokens[index + 1], '=')) {
        index += 2
        named.set(name.value, value())
      } else positional.push(value())
      if (isMark(tokens[index], ',')) index += 1
      else if (!isMark(tokens[index], ')')) throw new Unreadable('A call never closes.')
    }
    index += 1
    calls.push({ name: token.value, positional, named })
  }
  return calls
}

/** A value as the file would spell it, for saying a rule as it was written. */
const spelled = (value: Value): string =>
  value.kind === 'string' ? JSON.stringify(value.value) : value.kind === 'list' ? `[${value.items.map(spelled).join(', ')}]` : '…'

/** Codex's decisions, as the project's. */
const CODEX_DECISIONS: Readonly<Record<string, Decision>> = { forbidden: 'never', prompt: 'ask', allow: 'allow' }

/**
 * Each command a pattern's alternatives make, word by word; null where it
 * isn't a list of words and lists of words, and `too-many` where they would
 * make more than a person writes by hand, counted before any is made.
 */
const prefixesOf = (pattern: Value): ReadonlyArray<ReadonlyArray<string>> | null | 'too-many' => {
  if (pattern.kind !== 'list' || pattern.items.length === 0) return null
  const places: Array<ReadonlyArray<string>> = []
  for (const item of pattern.items) {
    const words =
      item.kind === 'string'
        ? [item.value]
        : item.kind === 'list' && item.items.every((each) => each.kind === 'string')
          ? item.items.map((each) => (each.kind === 'string' ? each.value : ''))
          : null
    if (words === null || words.length === 0) return null
    places.push(words)
  }
  if (places.reduce((count, words) => count * words.length, 1) > MOST_ALTERNATIVES) return 'too-many'
  return places.reduce<ReadonlyArray<ReadonlyArray<string>>>(
    (prefixes, words) => prefixes.flatMap((prefix) => words.map((word) => [...prefix, word])),
    [[]],
  )
}

/** Codex's rules in a rules file: each `prefix_rule`, a rule for each command its alternatives make. */
export const fromCodex = (text: string, from: RuleSource): ReadonlyArray<Found> | null => {
  let calls: ReadonlyArray<Call>
  try {
    calls = callsOf(text)
  } catch (error) {
    if (error instanceof Unreadable) return null
    throw error
  }
  // Rules only: `load(…)` and the like are how a file is put together.
  return calls
    .filter((call) => call.name.endsWith('_rule'))
    .flatMap((call): ReadonlyArray<Found> => {
      const pattern = call.named.get('pattern') ?? call.positional[0]
      const given = call.named.get('decision')
      // Without one, Codex allows.
      const named = given === undefined ? 'allow' : given.kind === 'string' ? given.value : ''
      const decision = CODEX_DECISIONS[named]
      const said = `${call.name}(${[
        ...(pattern === undefined ? [] : [`pattern = ${spelled(pattern)}`]),
        ...(given === undefined ? [] : [`decision = ${spelled(given)}`]),
      ].join(', ')})`
      // Another kind of rule: on the network, or something the project's rules don't hold.
      if (call.name !== 'prefix_rule')
        return [{ from, said, decision: decision ?? 'ask', becomes: { skip: call.name.includes('network') ? 'network' : 'tool' } }]
      if (decision === undefined) return [{ from, said, decision: 'ask', becomes: { skip: 'unsayable' } }]
      const prefixes = pattern === undefined ? null : prefixesOf(pattern)
      if (prefixes === null) return [{ from, said, decision, becomes: { skip: 'unsayable' } }]
      if (prefixes === 'too-many') return [{ from, said, decision, becomes: { skip: 'wildcard' } }]
      return prefixes.map((words) => {
        // Codex matches each word whole: one with a space or a `*` in it isn't a word Althar's rules can say.
        if (words.some((word) => word === '' || /\s/.test(word))) return { from, said, decision, becomes: { skip: 'unsayable' } }
        if (words.some((word) => word.includes('*'))) return { from, said, decision, becomes: { skip: 'wildcard' } }
        return { from, said, decision, becomes: { pattern: words.join(' '), match: 'prefix' } }
      })
    })
}

// ---- Weighing them against the project's rules --------------------------------

const RANK: Readonly<Record<Decision, number>> = { allow: 1, ask: 2, never: 3 }

/** What is above a decision for the same words, as a reason to skip it. */
const under = (decision: Decision): Skip => (decision === 'never' ? 'under-never' : decision === 'ask' ? 'under-ask' : 'already')

const sameWords = (a: CommandPattern, b: { readonly pattern: string; readonly match?: 'prefix' | 'exact' | undefined }) =>
  a.pattern === b.pattern && a.match === (b.match ?? 'prefix')

const idOf = (found: Found) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        found.from.agent,
        found.from.file,
        found.said,
        found.decision,
        'skip' in found.becomes ? found.becomes.skip : [found.becomes.pattern, found.becomes.match],
      ]),
    )
    .digest('hex')
    .slice(0, 20)

/**
 * The agents' rules as the project is offered them, in the order read: each
 * the command rule it becomes, or why it isn't one. What no project can
 * change says some already. A rule is offered once, from the first file
 * that has it. For the same words, what comes first in the project's rules,
 * a never, then an ask, then an allow, is the one offered, as every agent
 * weighs its own; one the project has already, or has above it, isn't.
 */
export const offerOf = (found: ReadonlyArray<Found>, commands: ReadonlyArray<KeptCommand>): ReadonlyArray<Offered> => {
  const weighed = found.map((each): Found => {
    if ('skip' in each.becomes) return each
    // A command line no project can let through, or that every project refuses already.
    return !each.becomes.pattern.includes('*') && fixedReason(each.becomes.pattern) !== undefined
      ? { ...each, becomes: { skip: 'fixed' } }
      : each
  })
  const strongest = (pattern: CommandPattern) =>
    weighed.reduce<Decision | null>(
      (most, each) =>
        'skip' in each.becomes || !sameWords(pattern, each.becomes) || (most !== null && RANK[most] >= RANK[each.decision])
          ? most
          : each.decision,
      null,
    )
  const offered: Array<Offered> = []
  const seen = new Set<string>()
  for (const each of weighed) {
    const id = idOf(each)
    if (seen.has(id)) continue
    seen.add(id)
    const base = { id, from: each.from, said: each.said, decision: each.decision }
    if ('skip' in each.becomes) {
      offered.push({ ...base, skipped: each.becomes.skip })
      continue
    }
    const pattern = each.becomes
    const kept = commands.find((command) => sameWords(pattern, command))
    const most = strongest(pattern) ?? each.decision
    if (kept !== undefined && RANK[kept.decision] >= RANK[each.decision]) {
      offered.push({ ...base, skipped: RANK[kept.decision] === RANK[each.decision] ? 'already' : under(kept.decision) })
    } else if (RANK[most] > RANK[each.decision]) {
      offered.push({ ...base, skipped: under(most) })
    } else if (offered.some((other) => other.rule !== undefined && sameWords(pattern, other.rule) && other.decision === each.decision)) {
      // From another file too: offered once, from the first.
      continue
    } else {
      offered.push({ ...base, rule: pattern })
    }
  }
  return offered
}

/**
 * The project's command rules with those chosen of what was offered: each
 * in place of what it outranks for the same words, kept with where it came
 * from. Only a rule offered can be chosen; one chosen twice is kept once.
 */
export const withImported = (
  commands: ReadonlyArray<KeptCommand>,
  offered: ReadonlyArray<Offered>,
  chosen: ReadonlySet<string>,
): ReadonlyArray<KeptCommand> =>
  offered.reduce<ReadonlyArray<KeptCommand>>((now, each) => {
    if (each.rule === undefined || !chosen.has(each.id)) return now
    const rule = each.rule
    if (now.some((command) => sameWords(rule, command) && RANK[command.decision] >= RANK[each.decision])) return now
    return [
      ...now.filter((command) => !sameWords(rule, command)),
      { pattern: rule.pattern, decision: each.decision, ...(rule.match === 'exact' ? { match: 'exact' as const } : {}), from: each.from },
    ]
  }, commands)

// ---- Reading the files ---------------------------------------------------------

/** How much of a settings file is read: more than any hand-kept file. */
const MOST_BYTES = 1_000_000

/** A file as read: its text, nothing where there is none, or unreadable, as one too big or that can't be read is. */
type FileText = { readonly text: string } | 'none' | 'unreadable'

const textOf = (path: string): Effect.Effect<FileText> =>
  Effect.tryPromise(async (): Promise<FileText> => {
    const info = await stat(path).catch(() => null)
    if (info === null || !info.isFile()) return 'none'
    if (info.size > MOST_BYTES) return 'unreadable'
    return { text: await readFile(path, 'utf8') }
  }).pipe(Effect.orElseSucceed((): FileText => 'unreadable'))

/** The `.rules` files in a folder, by name. */
const rulesFiles = (folder: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.tryPromise(() => readdir(folder)).pipe(
    Effect.map((names) => names.filter((name) => name.endsWith('.rules')).sort()),
    Effect.orElseSucceed(() => []),
  )

/** A repository of the project's, where this computer has it. */
export interface RulesRepository {
  readonly name: string
  readonly path: string
}

/** A file an agent may keep rules in: where it is, how it is said, and how it is read. */
interface Place {
  readonly path: string
  readonly from: RuleSource
  readonly read: (text: string, from: RuleSource) => ReadonlyArray<Found> | null
}

/**
 * The agents' rules for a project, from the files they keep them in: each
 * repository's own (`.claude/settings.json`, the person's own
 * `.claude/settings.local.json`, Codex's `.codex/rules`, OpenCode's
 * `opencode.json`), then the person's, in their home folder. A repository's
 * file is said by its path in it, after the repository's name where the
 * project has several. A file that isn't there isn't said; one that can't
 * be read as the agent reads it is, with nothing from it.
 */
export const readAgentRules = (
  repositories: ReadonlyArray<RulesRepository>,
  home: string,
): Effect.Effect<{ readonly files: ReadonlyArray<FileRead>; readonly found: ReadonlyArray<Found> }> =>
  Effect.gen(function* () {
    const several = repositories.length > 1
    const inRepository = (repository: RulesRepository, file: string) => (several ? `${repository.name}/${file}` : file)
    const places: Array<Place> = []
    for (const repository of repositories) {
      for (const file of ['.claude/settings.json', '.claude/settings.local.json'])
        places.push({
          path: join(repository.path, file),
          from: { agent: 'claude', file: inRepository(repository, file) },
          read: fromClaude,
        })
      for (const name of yield* rulesFiles(join(repository.path, '.codex', 'rules')))
        places.push({
          path: join(repository.path, '.codex', 'rules', name),
          from: { agent: 'codex', file: inRepository(repository, `.codex/rules/${name}`) },
          read: fromCodex,
        })
      for (const file of ['opencode.json', 'opencode.jsonc'])
        places.push({
          path: join(repository.path, file),
          from: { agent: 'opencode', file: inRepository(repository, file) },
          read: fromOpenCode,
        })
    }
    places.push({
      path: join(home, '.claude', 'settings.json'),
      from: { agent: 'claude', file: '~/.claude/settings.json' },
      read: fromClaude,
    })
    for (const name of yield* rulesFiles(join(home, '.codex', 'rules')))
      places.push({ path: join(home, '.codex', 'rules', name), from: { agent: 'codex', file: `~/.codex/rules/${name}` }, read: fromCodex })
    for (const file of ['opencode.json', 'opencode.jsonc'])
      places.push({
        path: join(home, '.config', 'opencode', file),
        from: { agent: 'opencode', file: `~/.config/opencode/${file}` },
        read: fromOpenCode,
      })

    const read = yield* Effect.forEach(places, (place) => Effect.map(textOf(place.path), (text) => ({ place, text })), { concurrency: 8 })
    const files: Array<FileRead> = []
    const found: Array<Found> = []
    for (const { place, text } of read) {
      if (text === 'none') continue
      const rules = text === 'unreadable' ? null : place.read(text.text, place.from)
      files.push({ from: place.from, readable: rules !== null })
      found.push(...(rules ?? []))
    }
    return { files, found }
  })
