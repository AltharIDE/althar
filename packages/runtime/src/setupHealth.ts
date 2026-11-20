import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { SetupPart } from '@althar/contracts'
import { bundledClaude, CLAUDE_TOOL_HOOK_EVENTS, CLAUDE_TOOL_NAMES, tomlProblem } from '@althar/provider-adapters'
import { parseFrontmatter } from '@althar/skills'

/*
 * Whether each part of the person's own setup loads in the agent it is for (docs/decisions/the-persons-setup.md, "When
 * part of it doesn't load"), as Settings marks it: Claude Code's settings, hooks, agents, commands, output styles,
 * skills and plugins, and Codex's `config.toml` and skills. One broken file is one part; Althar only reads them.
 *
 * In the agents' own words where they say it, asked as `mcpHealth.ts` asks about servers and kept beside its record
 * (`setup-health.json`): Claude Code's `initialize` and `get_settings` (which agents it loaded, and each settings file it
 * skipped, with why), and Codex's app-server (`configWarning`, and each skill `skills/list` couldn't load). Neither
 * runs a turn, a hook or a server. The rest Althar reads itself, each time: frontmatter as Claude Code reads it, a hook
 * matcher against the tools Claude Code has, a plugin's `plugin.json`, a `config.toml`. What an agent said of a file
 * stands only while the file hasn't changed since.
 */

/** Starts one of the person's agents' commands in an empty folder (`cwd`), writes it `lines`, and gives back what it printed once `done` says it has enough, or at the end of its time; undefined where it isn't on this computer. */
export type Converse = (
  command: string,
  args: ReadonlyArray<string>,
  lines: (cwd: string) => ReadonlyArray<string>,
  done: (printed: string) => boolean,
  env?: Readonly<Record<string, string>>,
) => Promise<string | undefined>

/** What a setup check reads: the person's home and the places their agents' settings are named in, Althar's own folder, and the clock. */
export interface SetupIo {
  readonly homeDir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly folder: string
  readonly now: () => string
}

/** A settings file Claude Code skipped, as `get_settings` says it. */
interface SettingsError {
  readonly file: string
  readonly path: string
  readonly message: string
}

/** What Claude Code said, when: the agents it loaded, and the settings files it skipped. */
interface ClaudeHeard {
  readonly at: string
  readonly agents?: ReadonlyArray<string>
  readonly errors?: ReadonlyArray<SettingsError>
}

/** What Codex said, when: its warnings about a settings file, and the skills it couldn't load. */
interface CodexHeard {
  readonly at: string
  readonly config: ReadonlyArray<{ readonly path: string; readonly words: string }>
  readonly skills?: ReadonlyArray<{ readonly path: string; readonly message: string }>
}

export interface SetupRecord {
  /** When the agents were last asked; null before the first time. */
  readonly checkedAt: string | null
  readonly claude?: ClaudeHeard
  readonly codex?: CodexHeard
}

export const emptySetup: SetupRecord = { checkedAt: null }

/** A part that doesn't load, with when that was known: when the agent said it, or now for Althar's own reading. */
export type Part = SetupPart & { readonly at: string }

/** How long what an agent last said is kept while it can't be asked. */
const KEPT_FOR = 24 * 60 * 60 * 1000
/** The most of the agent's words kept, in characters. */
const WORDS_LENGTH = 300
/** The most files read in one folder. */
const FILES_AT_MOST = 500

const setupPath = (io: Pick<SetupIo, 'folder'>) => join(io.folder, 'setup-health.json')

/** Words as kept: on one line, at most 300 characters. */
const oneLine = (words: string) => {
  const one = words.replace(/\s+/g, ' ').trim()
  return one.length > WORDS_LENGTH ? `${one.slice(0, WORDS_LENGTH - 1).trimEnd()}…` : one
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const strings = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : undefined

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const readJson = (path: string): unknown => {
  const text = readText(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The same file whichever way it is named: through a link, or not. */
const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/* ---- the homes ----------------------------------------------------------------------- */

const claudeHome = (io: Pick<SetupIo, 'homeDir' | 'env'>) => io.env?.['CLAUDE_CONFIG_DIR'] || join(io.homeDir, '.claude')
const codexHome = (io: Pick<SetupIo, 'homeDir' | 'env'>) => io.env?.['CODEX_HOME'] || join(io.homeDir, '.codex')
/** The folders Codex reads the person's own skills from: `~/.agents/skills` and its home's `skills`. */
const codexSkillFolders = (io: Pick<SetupIo, 'homeDir' | 'env'>) => [join(io.homeDir, '.agents', 'skills'), join(codexHome(io), 'skills')]

/** A path as the person is shown it: under their home as `~`, with forward slashes. */
const named = (io: Pick<SetupIo, 'homeDir'>, path: string) =>
  (path.startsWith(io.homeDir) ? `~${path.slice(io.homeDir.length)}` : path).replaceAll('\\', '/')

/** Whether what an agent said at `at` still stands for this file: it hasn't changed since. */
const unchangedSince = (path: string, at: string) => {
  try {
    return statSync(path).mtimeMs <= Date.parse(at)
  } catch {
    return false
  }
}

const fresh = (at: string, now: string) => {
  const then = Date.parse(at)
  const current = Date.parse(now)
  return Number.isFinite(then) && Number.isFinite(current) && current - then < KEPT_FOR
}

/** The `.md` files in a folder, and in its folders where `deep`. */
const markdownIn = (folder: string, deep = false): ReadonlyArray<string> => {
  const found: Array<string> = []
  const walk = (at: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= FILES_AT_MOST) return
      if (entry.name.startsWith('.')) continue
      const path = join(at, entry.name)
      let folderHere = entry.isDirectory()
      let file = entry.isFile()
      if (entry.isSymbolicLink())
        try {
          const target = statSync(path)
          folderHere = target.isDirectory()
          file = target.isFile()
        } catch {
          continue
        }
      if (file && entry.name.endsWith('.md')) found.push(path)
      else if (folderHere && deep && depth < 4) walk(path, depth + 1)
    }
  }
  walk(folder, 0)
  return found
}

/** The skill folders in a folder: each with a `SKILL.md`, by its folder's name. */
const skillsIn = (folder: string): ReadonlyArray<{ readonly name: string; readonly file: string }> => {
  try {
    return readdirSync(folder)
      .filter((name) => !name.startsWith('.'))
      .toSorted()
      .slice(0, FILES_AT_MOST)
      .flatMap((name) => {
        const file = join(folder, name, 'SKILL.md')
        return existsSync(file) ? [{ name, file }] : []
      })
  } catch {
    return []
  }
}

/* ---- frontmatter, as Claude Code reads it --------------------------------------------- */

export type Front =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly data: Readonly<Record<string, unknown>> }

/**
 * A file's frontmatter, read as Claude Code 2.1.326 reads it: as YAML, and where that fails, again with each top-level
 * value taken as it is written (`description: [x` is the words `[x`). What still can't be read is unreadable; a file
 * that doesn't open with `---`, or never closes it, has none.
 */
export const frontOf = (text: string): Front => {
  const lines = text.replace(/^﻿/, '').replaceAll('\r\n', '\n').split('\n')
  if (lines[0]?.trim() !== '---') return { kind: 'none' }
  const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---')
  if (end < 0) return { kind: 'none' }
  const inside = lines.slice(1, end)
  if (inside.every((line) => line.trim() === '' || line.trimStart().startsWith('#'))) return { kind: 'read', data: {} }
  const strict = parseFrontmatter(lines.join('\n'))
  if (strict !== null) return { kind: 'read', data: strict.data }
  const quoted = inside.map((line) => {
    const pair = /^([A-Za-z0-9_-]+):[ \t]+(\S.*)$/.exec(line)
    if (pair === null) return line
    const value = pair[2]!.trim()
    return /^["']/.test(value) ? line : `${pair[1]}: ${JSON.stringify(value)}`
  })
  const lenient = parseFrontmatter(['---', ...quoted, '---'].join('\n'))
  return lenient === null ? { kind: 'unreadable' } : { kind: 'read', data: lenient.data }
}

const said = (data: Readonly<Record<string, unknown>>, key: string) => (typeof data[key] === 'string' ? data[key].trim() : '')

/** Why an agent or a skill file wouldn't load where its agent wants a name and a description: undefined where it would. */
const definitionProblem = (front: Front, agent: string): string | undefined => {
  if (front.kind === 'none') return `It has no frontmatter, so ${agent} leaves it out.`
  if (front.kind === 'unreadable') return `Its frontmatter can’t be read, so ${agent} leaves it out.`
  if (said(front.data, 'name') === '') return `Its frontmatter gives no name, so ${agent} leaves it out.`
  if (said(front.data, 'description') === '') return `Its frontmatter gives no description, so ${agent} leaves it out.`
  return undefined
}

const IGNORED = 'Its frontmatter can’t be read, so Claude Code ignores what it sets.'

/* ---- hooks ---------------------------------------------------------------------------- */

/** Edits between two words, a swap of two letters side by side counted as one. */
const distance = (a: string, b: string) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
    }
  return rows[a.length]![b.length]!
}

/** The tool a name that matches none was most likely meant to be: the same in other letters, or a slip of two letters or fewer. */
const meant = (name: string): string | undefined =>
  CLAUDE_TOOL_NAMES.find((tool) => tool.toLowerCase() === name.toLowerCase()) ??
  (name.length < 4 ? undefined : CLAUDE_TOOL_NAMES.find((tool) => distance(tool, name) <= 2))

/**
 * Why a hook's matcher never matches, where Althar can tell: a tool's name that is a slip of one Claude Code has
 * (`Bashh`, `bash`), or a pattern that can't be read. A name close to none may be a tool Althar doesn't know, and a
 * pattern matches what it matches: neither is judged.
 */
export const matcherProblem = (matcher: string): string | undefined => {
  const trimmed = matcher.trim()
  if (trimmed === '' || trimmed === '*') return undefined
  if (/^[A-Za-z0-9_|]+$/.test(trimmed)) {
    for (const name of trimmed.split('|')) {
      if (name === '' || name.startsWith('mcp__') || CLAUDE_TOOL_NAMES.includes(name)) continue
      const tool = meant(name)
      if (tool !== undefined) return `Its matcher “${name}” matches no tool, so it never runs. Claude Code calls it “${tool}”.`
    }
    return undefined
  }
  try {
    new RegExp(trimmed)
    return undefined
  } catch {
    return `Its matcher “${trimmed}” can’t be read as a pattern, so it never runs.`
  }
}

/** Each hook of a settings file whose matcher never matches: by its event, once an event. */
const hookParts = (io: SetupIo, settings: unknown, file: string, at: string): ReadonlyArray<Part> => {
  const hooks = record(record(settings)?.['hooks'])
  if (hooks === undefined) return []
  return CLAUDE_TOOL_HOOK_EVENTS.flatMap((event): ReadonlyArray<Part> => {
    const entries = hooks[event]
    if (!Array.isArray(entries)) return []
    for (const entry of entries) {
      const matcher = record(entry)?.['matcher']
      const why = typeof matcher === 'string' ? matcherProblem(matcher) : undefined
      if (why !== undefined) return [{ agent: 'claude', kind: 'hook', name: `hooks.${event}`, where: named(io, file), why, by: null, at }]
    }
    return []
  })
}

/* ---- plugins -------------------------------------------------------------------------- */

/** The plugins Claude Code has on, from its `settings.json`, each where it is installed (`plugins/installed_plugins.json`). */
const enabledPlugins = (home: string, settings: unknown): ReadonlyArray<{ readonly name: string; readonly at: string }> => {
  const enabled = record(record(settings)?.['enabledPlugins']) ?? {}
  const installed = record(record(readJson(join(home, 'plugins', 'installed_plugins.json')))?.['plugins']) ?? {}
  return Object.entries(installed).flatMap(([key, entries]) => {
    if (enabled[key] !== true) return []
    const at = (Array.isArray(entries) ? entries : [entries])
      .map((entry) => record(entry)?.['installPath'])
      .find((path) => typeof path === 'string')
    return typeof at === 'string' ? [{ name: key.split('@')[0] ?? key, at }] : []
  })
}

/** The fields of a plugin's manifest that Claude Code reads as words, and those it reads as a list of them. */
const PLUGIN_WORDS = ['version', 'description', 'homepage', 'repository', 'license']
const PLUGIN_LISTS = ['keywords']

/** Why a plugin's `plugin.json` keeps it from loading, or keeps a field of it from counting: undefined where neither. */
export const pluginProblem = (text: string): string | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'Its plugin.json isn’t valid JSON, so Claude Code doesn’t load the plugin.'
  }
  const manifest = record(parsed)
  if (manifest === undefined) return 'Its plugin.json isn’t an object, so Claude Code doesn’t load the plugin.'
  if (typeof manifest['name'] !== 'string' || manifest['name'].trim() === '')
    return 'Its plugin.json gives no name, so Claude Code doesn’t load the plugin.'
  const word = PLUGIN_WORDS.find((key) => key in manifest && typeof manifest[key] !== 'string' && record(manifest[key]) === undefined)
  if (word !== undefined) return `Its plugin.json’s “${word}” isn’t text, so Claude Code ignores it.`
  const list = PLUGIN_LISTS.find(
    (key) => key in manifest && strings(manifest[key])?.length !== (manifest[key] as unknown[] | undefined)?.length,
  )
  if (list !== undefined) return `Its plugin.json’s “${list}” isn’t a list of words, so Claude Code ignores it.`
  return undefined
}

/* ---- the parts ------------------------------------------------------------------------ */

/** Claude Code's parts that don't load: by what it said where that still stands, else by Althar's own reading. */
const claudeParts = (io: SetupIo, heard: ClaudeHeard | undefined, now: string): ReadonlyArray<Part> => {
  const home = claudeHome(io)
  const parts: Array<Part> = []
  const part = (kind: Part['kind'], path: string, why: string, by: Part['by'], at = now, name = basename(path)) =>
    parts.push({ agent: 'claude', kind, name, where: named(io, path), why, by, at })

  // Its settings: what it skipped, in its words, else whether the file is JSON at all.
  const settingsFile = join(home, 'settings.json')
  const settingsText = readText(settingsFile)
  let settings: unknown
  let skipped = false
  if (settingsText !== undefined) {
    const errors = (heard?.errors ?? []).filter((one) => real(one.file) === real(settingsFile))
    if (heard?.errors !== undefined && unchangedSince(settingsFile, heard.at)) {
      if (errors.length > 0) {
        const words = errors.map((one) => (one.path === '' ? one.message : `${one.path}: ${one.message}`)).join(' ')
        part('settings', settingsFile, oneLine(`Claude Code skips the whole file: ${words}`), 'claude', heard.at)
        skipped = true
      }
    }
    try {
      settings = JSON.parse(settingsText)
    } catch {
      if (!skipped) part('settings', settingsFile, 'It isn’t valid JSON, so Claude Code skips the whole file.', null)
      skipped = true
    }
    if (!skipped) parts.push(...hookParts(io, settings, settingsFile, now))
  }

  // Its agents: those it didn't load, where it said which it did; else those whose frontmatter it can't take.
  const loaded = heard?.agents === undefined ? undefined : new Set(heard.agents)
  for (const file of markdownIn(join(home, 'agents'))) {
    const text = readText(file)
    if (text === undefined) continue
    const front = frontOf(text)
    const problem = definitionProblem(front, 'Claude Code')
    if (loaded !== undefined && heard !== undefined && unchangedSince(file, heard.at)) {
      const name = front.kind === 'read' ? said(front.data, 'name') : ''
      if (name === '' || !loaded.has(name))
        part('agent', file, problem ?? 'Claude Code leaves it out.', problem === undefined ? 'claude' : null, heard.at)
    } else if (problem !== undefined) part('agent', file, problem, null)
  }

  // Its commands, output styles and skills load without frontmatter they can't read: what it sets is ignored.
  for (const [kind, files] of [
    ['command', markdownIn(join(home, 'commands'), true)],
    ['output-style', markdownIn(join(home, 'output-styles'))],
  ] as const)
    for (const file of files) {
      const text = readText(file)
      if (text !== undefined && frontOf(text).kind === 'unreadable') part(kind, file, IGNORED, null)
    }
  for (const skill of skillsIn(join(home, 'skills'))) {
    const text = readText(skill.file)
    if (text !== undefined && frontOf(text).kind === 'unreadable') part('skill', skill.file, IGNORED, null, now, skill.name)
  }

  // Its plugins that are on: a manifest that keeps one from loading, or a field of it from counting.
  if (!skipped)
    for (const plugin of enabledPlugins(home, settings)) {
      const manifest = join(plugin.at, '.claude-plugin', 'plugin.json')
      const text = readText(manifest)
      const why = text === undefined ? undefined : pluginProblem(text)
      if (why !== undefined) part('plugin', manifest, why, null, now, plugin.name)
    }
  return parts
}

/** Codex's parts that don't load: by what it said where that still stands, else by Althar's own reading. */
const codexParts = (io: SetupIo, heard: CodexHeard | undefined, now: string): ReadonlyArray<Part> => {
  const parts: Array<Part> = []
  const configFile = join(codexHome(io), 'config.toml')
  const configText = readText(configFile)
  if (configText !== undefined) {
    if (heard !== undefined && unchangedSince(configFile, heard.at)) {
      const words = heard.config.filter((one) => real(one.path) === real(configFile)).map((one) => one.words)
      if (words.length > 0)
        parts.push({
          agent: 'codex',
          kind: 'config',
          name: 'config.toml',
          where: named(io, configFile),
          why: oneLine(words.join(' ')),
          by: 'codex',
          at: heard.at,
        })
    } else {
      const problem = tomlProblem(configText)
      if (problem !== undefined)
        parts.push({
          agent: 'codex',
          kind: 'config',
          name: 'config.toml',
          where: named(io, configFile),
          why: oneLine(`Codex can’t read it, so it uses its defaults: ${problem}`),
          by: null,
          at: now,
        })
    }
  }
  const seen = new Set<string>()
  for (const folder of codexSkillFolders(io))
    for (const skill of skillsIn(folder)) {
      const file = real(skill.file)
      if (seen.has(file)) continue
      seen.add(file)
      if (heard?.skills !== undefined && unchangedSince(skill.file, heard.at)) {
        const error = heard.skills.find((one) => real(one.path) === file)
        if (error !== undefined)
          parts.push({
            agent: 'codex',
            kind: 'skill',
            name: skill.name,
            where: named(io, skill.file),
            why: oneLine(`Codex leaves it out: ${error.message}`),
            by: 'codex',
            at: heard.at,
          })
        continue
      }
      const text = readText(skill.file)
      const problem = text === undefined ? undefined : definitionProblem(frontOf(text), 'Codex')
      if (problem !== undefined)
        parts.push({ agent: 'codex', kind: 'skill', name: skill.name, where: named(io, skill.file), why: problem, by: null, at: now })
    }
  return parts
}

/**
 * Each part of the person's own setup that doesn't load, Claude Code's first: what the agents last said, where it
 * still stands, and Althar's own reading of each file. Never runs a command; never throws.
 */
export const setupParts = (io: SetupIo): ReadonlyArray<Part> => {
  try {
    const kept = readSetup(io)
    const now = io.now()
    const claude = kept.claude !== undefined && fresh(kept.claude.at, now) ? kept.claude : undefined
    const codex = kept.codex !== undefined && fresh(kept.codex.at, now) ? kept.codex : undefined
    return [...claudeParts(io, claude, now), ...codexParts(io, codex, now)]
  } catch {
    return []
  }
}

/* ---- asking the agents ---------------------------------------------------------------- */

/** Each line of what a command printed that is a JSON object. */
const messagesIn = (printed: string): ReadonlyArray<Readonly<Record<string, unknown>>> =>
  printed.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    try {
      const value = record(JSON.parse(line))
      return value === undefined ? [] : [value]
    } catch {
      return []
    }
  })

/** Claude Code's answer to one of its control requests, by the request's id. */
const claudeAnswer = (messages: ReadonlyArray<Readonly<Record<string, unknown>>>, id: string) => {
  for (const message of messages) {
    if (message['type'] !== 'control_response') continue
    const response = record(message['response'])
    if (response?.['request_id'] === id && response['subtype'] === 'success') return record(response['response']) ?? {}
  }
  return undefined
}

/** What Claude Code's `initialize` and `get_settings` answered: the agents it loaded, and the settings files it skipped. */
export const parseClaudeAnswers = (printed: string): Omit<ClaudeHeard, 'at'> | undefined => {
  const messages = messagesIn(printed)
  const started = claudeAnswer(messages, 'althar-initialize')
  const settings = claudeAnswer(messages, 'althar-settings')
  if (started === undefined && settings === undefined) return undefined
  const agents = Array.isArray(started?.['agents'])
    ? started['agents'].flatMap((one) => {
        const name = record(one)?.['name']
        return typeof name === 'string' ? [name] : []
      })
    : undefined
  const errors = Array.isArray(settings?.['errors'])
    ? settings['errors'].flatMap((one): ReadonlyArray<SettingsError> => {
        const error = record(one)
        const file = error?.['file']
        const message = error?.['message']
        return typeof file === 'string' && typeof message === 'string'
          ? [{ file, path: typeof error?.['path'] === 'string' ? error['path'] : '', message }]
          : []
      })
    : settings === undefined
      ? undefined
      : []
  return { ...(agents === undefined ? {} : { agents }), ...(errors === undefined ? {} : { errors }) }
}

/** What Codex's app-server said as it started and of its skills: its warnings about a settings file, and the skills it couldn't load. */
export const parseCodexAnswers = (printed: string, io: Pick<SetupIo, 'homeDir'>): Omit<CodexHeard, 'at'> | undefined => {
  const messages = messagesIn(printed)
  const listed = messages.find((message) => message['id'] === 2)
  const started = messages.some((message) => message['id'] === 1 && record(message['result']) !== undefined)
  if (!started) return undefined
  const config = messages.flatMap((message) => {
    if (message['method'] !== 'configWarning') return []
    const params = record(message['params'])
    const path = params?.['path']
    if (typeof path !== 'string') return []
    const words = [params?.['summary'], params?.['details']]
      .filter((one): one is string => typeof one === 'string' && one.trim() !== '')
      .map((one) => one.replaceAll(path, named(io, path)))
      .join(' ')
    return words === '' ? [] : [{ path, words }]
  })
  const data = record(listed?.['result'])?.['data']
  const skills = Array.isArray(data)
    ? data.flatMap((entry) => {
        const errors = record(entry)?.['errors']
        return Array.isArray(errors)
          ? errors.flatMap((one) => {
              const error = record(one)
              return typeof error?.['path'] === 'string' && typeof error['message'] === 'string'
                ? [{ path: error['path'], message: error['message'] }]
                : []
            })
          : []
      })
    : undefined
  // An error that isn't a skill's file is the list failing as a whole (a `config.toml` it can't read): it said nothing of each skill.
  const whole = skills !== undefined && skills.every((one) => one.path.endsWith('SKILL.md')) ? skills : undefined
  return { config, ...(whole === undefined ? {} : { skills: whole }) }
}

/** The lines Claude Code is asked: what it loads as it starts, and its settings. No turn, so no model call. */
const CLAUDE_LINES = [
  JSON.stringify({ type: 'control_request', request_id: 'althar-initialize', request: { subtype: 'initialize' } }),
  JSON.stringify({ type: 'control_request', request_id: 'althar-settings', request: { subtype: 'get_settings' } }),
]

/**
 * Claude Code in print mode reading its requests as JSON: with no server of the person's started
 * (`--strict-mcp-config`), and none of their hooks run (`disableAllHooks`, which would otherwise run SessionStart's
 * as it starts), and nothing sent that isn't needed.
 */
const CLAUDE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--strict-mcp-config',
  '--settings',
  JSON.stringify({ disableAllHooks: true }),
]
const CLAUDE_ENV = { DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }

const askClaude = async (converse: Converse): Promise<Omit<ClaudeHeard, 'at'> | undefined> => {
  const done = (printed: string) => printed.includes('"althar-settings"') && printed.includes('"althar-initialize"')
  try {
    // The person's own Claude Code, else the copy Althar's sessions run on.
    let printed = await converse('claude', CLAUDE_ARGS, () => CLAUDE_LINES, done, CLAUDE_ENV)
    const bundled = printed === undefined ? bundledClaude() : null
    if (bundled !== null) printed = await converse(bundled, CLAUDE_ARGS, () => CLAUDE_LINES, done, CLAUDE_ENV)
    return printed === undefined ? undefined : parseClaudeAnswers(printed)
  } catch {
    return undefined
  }
}

const askCodex = async (converse: Converse, io: Pick<SetupIo, 'homeDir'>): Promise<Omit<CodexHeard, 'at'> | undefined> => {
  const lines = (cwd: string) => [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'althar', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'skills/list', params: { cwds: [cwd] } }),
  ]
  try {
    const printed = await converse('codex', ['app-server'], lines, (text) => /"id":\s*2\b/.test(text))
    return printed === undefined ? undefined : parseCodexAnswers(printed, io)
  } catch {
    return undefined
  }
}

/* ---- the record ----------------------------------------------------------------------- */

const claudeHeardOf = (value: unknown): ClaudeHeard | undefined => {
  const kept = record(value)
  if (typeof kept?.['at'] !== 'string') return undefined
  const agents = strings(kept['agents'])
  const errors = Array.isArray(kept['errors'])
    ? kept['errors'].flatMap((one): ReadonlyArray<SettingsError> => {
        const error = record(one)
        return typeof error?.['file'] === 'string' && typeof error['path'] === 'string' && typeof error['message'] === 'string'
          ? [{ file: error['file'], path: error['path'], message: error['message'] }]
          : []
      })
    : undefined
  return { at: kept['at'], ...(agents === undefined ? {} : { agents }), ...(errors === undefined ? {} : { errors }) }
}

const codexHeardOf = (value: unknown): CodexHeard | undefined => {
  const kept = record(value)
  if (typeof kept?.['at'] !== 'string') return undefined
  const pairs = <K extends string>(list: unknown, a: 'path', b: K) =>
    Array.isArray(list)
      ? list.flatMap((one) => {
          const entry = record(one)
          return typeof entry?.[a] === 'string' && typeof entry[b] === 'string'
            ? [{ path: entry[a], [b]: entry[b] } as { path: string } & Record<K, string>]
            : []
        })
      : undefined
  const skills = pairs(kept['skills'], 'path', 'message')
  return { at: kept['at'], config: pairs(kept['config'], 'path', 'words') ?? [], ...(skills === undefined ? {} : { skills }) }
}

/** What was last kept; empty where nothing was, or where the file is damaged. Never runs a command. */
export const readSetup = (io: Pick<SetupIo, 'folder'>): SetupRecord => {
  const kept = record(readJson(setupPath(io)))
  if (kept === undefined) return emptySetup
  const claude = claudeHeardOf(kept['claude'])
  const codex = codexHeardOf(kept['codex'])
  return {
    checkedAt: typeof kept['checkedAt'] === 'string' ? kept['checkedAt'] : null,
    ...(claude === undefined ? {} : { claude }),
    ...(codex === undefined ? {} : { codex }),
  }
}

/** Writes the record whole or not at all: to a file beside it, then moved over it. */
const writeSetup = (io: Pick<SetupIo, 'folder'>, kept: SetupRecord) => {
  mkdirSync(io.folder, { recursive: true })
  const path = setupPath(io)
  const next = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(next, `${JSON.stringify(kept, null, 2)}\n`)
    renameSync(next, path)
  } catch (error) {
    try {
      unlinkSync(next)
    } catch {
      // Never written, or gone already.
    }
    throw error
  }
}

/** One check a folder at a time: a second asked while one runs gets the first one's answer. */
const running = new Map<string, Promise<SetupRecord>>()

const checkNow = async (io: SetupIo, converse: Converse): Promise<SetupRecord> => {
  try {
    const [claude, codex] = await Promise.all([askClaude(converse), askCodex(converse, io)])
    const now = io.now()
    const before = readSetup(io)
    // An agent that couldn't be asked keeps what it last said, for a day.
    const keptClaude =
      claude !== undefined
        ? { at: now, ...claude }
        : before.claude !== undefined && fresh(before.claude.at, now)
          ? before.claude
          : undefined
    const keptCodex =
      codex !== undefined ? { at: now, ...codex } : before.codex !== undefined && fresh(before.codex.at, now) ? before.codex : undefined
    const next: SetupRecord = {
      checkedAt: now,
      ...(keptClaude === undefined ? {} : { claude: keptClaude }),
      ...(keptCodex === undefined ? {} : { codex: keptCodex }),
    }
    writeSetup(io, next)
    return next
  } catch {
    return readSetup(io)
  }
}

/**
 * Asks Claude Code and Codex, through their own commands, what of the person's setup they load, and keeps what they
 * said. Never throws: an agent that couldn't be asked keeps what it last said.
 */
export const checkSetup = (io: SetupIo, converse: Converse): Promise<SetupRecord> => {
  const before = running.get(io.folder)
  if (before !== undefined) return before
  const next = checkNow(io, converse).finally(() => running.delete(io.folder))
  running.set(io.folder, next)
  return next
}
