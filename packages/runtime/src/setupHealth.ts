import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
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
 * runs a turn, a hook or a server, and they are asked at most every few minutes. The rest Althar reads itself, each
 * check: frontmatter as Claude Code reads it, a hook matcher against the tools Claude Code has, a plugin's
 * `plugin.json`, a `config.toml`. What an agent said of a file stands only while the file hasn't changed since. What
 * was found is kept with what they said, and Settings reads that: no folder is walked as it asks.
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

/** A part that doesn't load, with when that was known (when the agent said it, or when Althar read it), and its file as found. */
export type Part = SetupPart & { readonly at: string; readonly file: string }

export interface SetupRecord {
  /** When the agents were last asked; null before the first time. */
  readonly checkedAt: string | null
  readonly claude?: ClaudeHeard
  readonly codex?: CodexHeard
  /** Each part that didn't load when the setup was last read, by what the agents said and Althar's own reading; absent before the first time. */
  readonly parts?: ReadonlyArray<Part>
}

export const emptySetup: SetupRecord = { checkedAt: null }

/** How long what an agent last said is kept while it can't be asked. */
const KEPT_FOR = 24 * 60 * 60 * 1000
/** How often the agents are asked again, at most: the files are read each time. */
export const ASK_EVERY = 5 * 60 * 1000
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

/** Words as a list reads: a, b and c. */
const andList = (words: ReadonlyArray<string>) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const strings = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : undefined

/** A file as read: its text; missing (nothing there to load); or not opened, with why. */
type Read =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly why: string }

const readText = async (path: string): Promise<Read> => {
  try {
    return { kind: 'text', text: await readFile(path, 'utf8') }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return {
      kind: 'failed',
      why:
        code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code === 'EISDIR' ? 'it is a folder' : (code ?? 'it can’t be read'),
    }
  }
}

/** Why a file that is there can't be read, as a part says it. */
const unopened = (why: string, agent: string) => `It can’t be opened (${why}), so ${agent} can’t read it.`

const readJson = async (path: string): Promise<unknown> => {
  const read = await readText(path)
  if (read.kind !== 'text') return undefined
  try {
    return JSON.parse(read.text)
  } catch {
    return undefined
  }
}

/** The same file whichever way it is named: through a link, or not. */
const real = async (path: string) => {
  try {
    return await realpath(path)
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
const unchangedSince = async (path: string, at: string) => {
  try {
    return (await stat(path)).mtimeMs <= Date.parse(at)
  } catch {
    return false
  }
}

const fresh = (at: string, now: string, kept = KEPT_FOR) => {
  const then = Date.parse(at)
  const current = Date.parse(now)
  return Number.isFinite(then) && Number.isFinite(current) && current - then < kept
}

/** The `.md` files in a folder, and in its folders where `deep`. */
const markdownIn = async (folder: string, deep = false): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = []
  const walk = async (at: string, depth: number) => {
    let entries
    try {
      entries = (await readdir(at, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))
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
          const target = await stat(path)
          folderHere = target.isDirectory()
          file = target.isFile()
        } catch {
          continue
        }
      if (file && entry.name.endsWith('.md')) found.push(path)
      else if (folderHere && deep && depth < 4) await walk(path, depth + 1)
    }
  }
  await walk(folder, 0)
  return found
}

/** The skill folders in a folder: each with a `SKILL.md`, by its folder's name. */
const skillsIn = async (folder: string): Promise<ReadonlyArray<{ readonly name: string; readonly file: string }>> => {
  let names: ReadonlyArray<string>
  try {
    names = (await readdir(folder))
      .filter((name) => !name.startsWith('.'))
      .toSorted()
      .slice(0, FILES_AT_MOST)
  } catch {
    return []
  }
  const found: Array<{ readonly name: string; readonly file: string }> = []
  for (const name of names) {
    const file = join(folder, name, 'SKILL.md')
    try {
      await stat(file)
      found.push({ name, file })
    } catch (error) {
      // A SKILL.md that is there but can't be looked at is still one of theirs.
      if ((error as NodeJS.ErrnoException).code === 'EACCES') found.push({ name, file })
    }
  }
  return found
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

/** What is wrong with a hook's matcher: why, and whether the hook still runs for some tool. */
export interface MatcherProblem {
  readonly why: string
  readonly runs: boolean
}

/**
 * What is wrong with a hook's matcher, where Althar can tell: a tool's name that is a slip of one Claude Code has
 * (`Bashh`, `bash`), or a pattern that can't be read. A matcher of several names is read as a whole: it never runs only
 * where every name is such a slip, and otherwise still runs for the rest. A name close to none may be a tool Althar
 * doesn't know, and a pattern matches what it matches: neither is judged.
 */
export const matcherProblem = (matcher: string): MatcherProblem | undefined => {
  const trimmed = matcher.trim()
  if (trimmed === '' || trimmed === '*') return undefined
  if (/^[A-Za-z0-9_|]+$/.test(trimmed)) {
    const names = trimmed.split('|').filter((name) => name !== '')
    const slips = names.flatMap((name) => {
      if (name.startsWith('mcp__') || CLAUDE_TOOL_NAMES.includes(name)) return []
      const tool = meant(name)
      return tool === undefined ? [] : [{ name, tool }]
    })
    if (slips.length === 0) return undefined
    const calls = `Claude Code calls ${slips.length === 1 ? 'it' : 'them'} ${andList(slips.map((one) => `“${one.tool}”`))}`
    if (slips.length === names.length) return { why: `Its matcher “${trimmed}” matches no tool, so it never runs. ${calls}.`, runs: false }
    const which = andList(slips.map((one) => `“${one.name}”`))
    return {
      why: `${which} in its matcher “${trimmed}” ${slips.length === 1 ? 'matches' : 'match'} no tool: ${calls}. It still runs for the rest.`,
      runs: true,
    }
  }
  try {
    new RegExp(trimmed)
    return undefined
  } catch {
    return { why: `Its matcher “${trimmed}” can’t be read as a pattern, so it never runs.`, runs: false }
  }
}

/** The hooks of a settings file whose matchers never match, or match less than they name: one part an event, with each such matcher. */
const hookParts = (io: SetupIo, settings: unknown, file: string, at: string): ReadonlyArray<Part> => {
  const hooks = record(record(settings)?.['hooks'])
  if (hooks === undefined) return []
  return CLAUDE_TOOL_HOOK_EVENTS.flatMap((event): ReadonlyArray<Part> => {
    const entries = hooks[event]
    if (!Array.isArray(entries)) return []
    const problems = entries.flatMap((entry) => {
      const matcher = record(entry)?.['matcher']
      const problem = typeof matcher === 'string' ? matcherProblem(matcher) : undefined
      return problem === undefined ? [] : [problem]
    })
    if (problems.length === 0) return []
    return [
      {
        agent: 'claude',
        kind: 'hook',
        name: `hooks.${event}`,
        where: named(io, file),
        why: oneLine(problems.map((one) => one.why).join(' ')),
        loads: problems.every((one) => one.runs),
        by: null,
        at,
        file,
      },
    ]
  })
}

/* ---- plugins -------------------------------------------------------------------------- */

/** The plugins Claude Code has on, from its `settings.json`, each where it is installed (`plugins/installed_plugins.json`). */
const enabledPlugins = async (home: string, settings: unknown): Promise<ReadonlyArray<{ readonly name: string; readonly at: string }>> => {
  const enabled = record(record(settings)?.['enabledPlugins']) ?? {}
  const installed = record(record(await readJson(join(home, 'plugins', 'installed_plugins.json')))?.['plugins']) ?? {}
  return Object.entries(installed).flatMap(([key, entries]) => {
    if (enabled[key] !== true) return []
    const at = (Array.isArray(entries) ? entries : [entries])
      .map((entry) => record(entry)?.['installPath'])
      .find((path) => typeof path === 'string')
    return typeof at === 'string' ? [{ name: key.split('@')[0] ?? key, at }] : []
  })
}

const isText = (value: unknown) => typeof value === 'string'

/**
 * The fields of a plugin's manifest that Claude Code 2.1.326 drops where they are malformed, loading the plugin
 * without them (its `manifest-field-ignored`), each with the shape it takes.
 */
const PLUGIN_SHOWN: Readonly<Record<string, (value: unknown) => boolean>> = {
  $schema: isText,
  displayName: isText,
  description: isText,
  author: (value) => {
    const author = record(value)
    return (
      author !== undefined &&
      typeof author['name'] === 'string' &&
      author['name'] !== '' &&
      (author['email'] === undefined || isText(author['email'])) &&
      (author['url'] === undefined || isText(author['url']))
    )
  },
  homepage: (value) => typeof value === 'string' && URL.canParse(value),
  repository: isText,
  license: isText,
  keywords: (value) => Array.isArray(value) && value.every(isText),
}

/** The fields that keep the plugin from loading where they are of the wrong kind, each with what it must be. */
const PLUGIN_NEEDED: ReadonlyArray<readonly [string, (value: unknown) => boolean, string]> = [
  ['version', isText, 'isn’t text'],
  ['defaultEnabled', (value) => typeof value === 'boolean', 'isn’t true or false'],
  ['dependencies', Array.isArray, 'isn’t a list'],
]

const REFUSED = 'so Claude Code doesn’t load the plugin.'

/** What is wrong with a plugin's `plugin.json`, as Claude Code reads it: why, and whether the plugin still loads. */
export interface PluginProblem {
  readonly why: string
  readonly loads: boolean
}

/** What keeps a plugin's `plugin.json` from loading the plugin, or a field of it from counting: undefined where neither. */
export const pluginProblem = (text: string): PluginProblem | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { why: `Its plugin.json isn’t valid JSON, ${REFUSED}`, loads: false }
  }
  const manifest = record(parsed)
  if (manifest === undefined) return { why: `Its plugin.json isn’t an object, ${REFUSED}`, loads: false }
  const name = manifest['name']
  if (typeof name !== 'string' || name.trim() === '') return { why: `Its plugin.json gives no name, ${REFUSED}`, loads: false }
  if (/\s/.test(name)) return { why: `Its plugin.json’s name “${name}” has a space in it, ${REFUSED}`, loads: false }
  for (const [key, fits, isnt] of PLUGIN_NEEDED)
    if (key in manifest && !fits(manifest[key])) return { why: `Its plugin.json’s “${key}” ${isnt}, ${REFUSED}`, loads: false }
  const said: Array<string> = []
  const shown = Object.keys(PLUGIN_SHOWN).filter((key) => key in manifest && !PLUGIN_SHOWN[key]!(manifest[key]))
  if (shown.length > 0)
    said.push(
      `${andList(shown.map((key) => `“${key}”`))} in its plugin.json ${shown.length === 1 ? 'is' : 'are'} malformed, so Claude Code ignores ${shown.length === 1 ? 'it' : 'them'}.`,
    )
  // Its engines: anything but an object is passed over, and a Claude Code range that isn't text is ignored.
  if ('engines' in manifest) {
    const engines = record(manifest['engines'])
    if (engines === undefined) said.push('Its plugin.json’s “engines” isn’t an object, so Claude Code ignores it.')
    else if ('claude-code' in engines && !isText(engines['claude-code']))
      said.push('Its plugin.json’s Claude Code range (“engines”) isn’t text, so Claude Code ignores it.')
  }
  return said.length === 0 ? undefined : { why: `${said.join(' ')} The plugin still loads.`, loads: true }
}

/* ---- the parts ------------------------------------------------------------------------ */

type Add = (kind: Part['kind'], path: string, why: string, loads: boolean, by: Part['by'], at?: string, name?: string) => void

const adder =
  (io: SetupIo, agent: Part['agent'], parts: Array<Part>, now: string): Add =>
  (kind, path, why, loads, by, at = now, name = basename(path)) =>
    parts.push({ agent, kind, name, where: named(io, path), why, loads, by, at, file: path })

/** Claude Code's parts that don't load: by what it said where that still stands, else by Althar's own reading. */
const claudeParts = async (io: SetupIo, heard: ClaudeHeard | undefined, now: string): Promise<ReadonlyArray<Part>> => {
  const home = claudeHome(io)
  const parts: Array<Part> = []
  const part = adder(io, 'claude', parts, now)

  // Its settings: what it skipped, in its words, else whether Althar can open the file, and whether it is JSON.
  const settingsFile = join(home, 'settings.json')
  const settingsRead = await readText(settingsFile)
  let settings: unknown
  let skipped = false
  if (settingsRead.kind !== 'missing') {
    if (heard?.errors !== undefined && (await unchangedSince(settingsFile, heard.at))) {
      const file = await real(settingsFile)
      const errors: Array<SettingsError> = []
      for (const one of heard.errors) if ((await real(one.file)) === file) errors.push(one)
      if (errors.length > 0) {
        const words = errors.map((one) => (one.path === '' ? one.message : `${one.path}: ${one.message}`)).join(' ')
        part('settings', settingsFile, oneLine(`Claude Code skips the whole file: ${words}`), false, 'claude', heard.at)
        skipped = true
      }
    }
    if (settingsRead.kind === 'failed') {
      if (!skipped) part('settings', settingsFile, unopened(settingsRead.why, 'Claude Code'), false, null)
      skipped = true
    } else
      try {
        settings = JSON.parse(settingsRead.text)
      } catch {
        if (!skipped) part('settings', settingsFile, 'It isn’t valid JSON, so Claude Code skips the whole file.', false, null)
        skipped = true
      }
    if (!skipped) parts.push(...hookParts(io, settings, settingsFile, now))
  }

  // Its agents: those it didn't load, where it said which it did; else those whose frontmatter it can't take.
  const loaded = heard?.agents === undefined ? undefined : new Set(heard.agents)
  for (const file of await markdownIn(join(home, 'agents'))) {
    const read = await readText(file)
    if (read.kind === 'missing') continue
    if (read.kind === 'failed') {
      part('agent', file, unopened(read.why, 'Claude Code'), false, null)
      continue
    }
    const front = frontOf(read.text)
    const problem = definitionProblem(front, 'Claude Code')
    if (loaded !== undefined && heard !== undefined && (await unchangedSince(file, heard.at))) {
      const name = front.kind === 'read' ? said(front.data, 'name') : ''
      if (name === '' || !loaded.has(name))
        part('agent', file, problem ?? 'Claude Code leaves it out.', false, problem === undefined ? 'claude' : null, heard.at)
    } else if (problem !== undefined) part('agent', file, problem, false, null)
  }

  // Its commands, output styles and skills load without frontmatter they can't read: what it sets is ignored.
  const kinds = [
    ['command', await markdownIn(join(home, 'commands'), true)],
    ['output-style', await markdownIn(join(home, 'output-styles'))],
  ] as const
  for (const [kind, files] of kinds)
    for (const file of files) {
      const read = await readText(file)
      if (read.kind === 'failed') part(kind, file, unopened(read.why, 'Claude Code'), false, null)
      else if (read.kind === 'text' && frontOf(read.text).kind === 'unreadable') part(kind, file, IGNORED, true, null)
    }
  for (const skill of await skillsIn(join(home, 'skills'))) {
    const read = await readText(skill.file)
    if (read.kind === 'failed') part('skill', skill.file, unopened(read.why, 'Claude Code'), false, null, now, skill.name)
    else if (read.kind === 'text' && frontOf(read.text).kind === 'unreadable')
      part('skill', skill.file, IGNORED, true, null, now, skill.name)
  }

  // Its plugins that are on: a manifest that keeps one from loading, or a field of it from counting.
  if (!skipped)
    for (const plugin of await enabledPlugins(home, settings)) {
      const manifest = join(plugin.at, '.claude-plugin', 'plugin.json')
      const read = await readText(manifest)
      if (read.kind === 'failed')
        part('plugin', manifest, `Its plugin.json can’t be opened (${read.why}), ${REFUSED}`, false, null, now, plugin.name)
      const problem = read.kind === 'text' ? pluginProblem(read.text) : undefined
      if (problem !== undefined) part('plugin', manifest, problem.why, problem.loads, null, now, plugin.name)
    }
  return parts
}

/** Codex's parts that don't load: by what it said where that still stands, else by Althar's own reading. */
const codexParts = async (io: SetupIo, heard: CodexHeard | undefined, now: string): Promise<ReadonlyArray<Part>> => {
  const parts: Array<Part> = []
  const part = adder(io, 'codex', parts, now)
  const configFile = join(codexHome(io), 'config.toml')
  const configRead = await readText(configFile)
  if (configRead.kind !== 'missing') {
    let said = false
    if (heard !== undefined && (await unchangedSince(configFile, heard.at))) {
      const file = await real(configFile)
      const words: Array<string> = []
      for (const one of heard.config) if ((await real(one.path)) === file) words.push(one.words)
      if (words.length > 0) part('config', configFile, oneLine(words.join(' ')), false, 'codex', heard.at)
      // Codex was asked after it last changed, and warned of nothing: its word stands.
      said = true
    }
    if (!said && configRead.kind === 'failed') part('config', configFile, unopened(configRead.why, 'Codex'), false, null)
    else if (!said && configRead.kind === 'text') {
      const problem = tomlProblem(configRead.text)
      if (problem !== undefined)
        part('config', configFile, oneLine(`Codex can’t read it, so it uses its defaults: ${problem}`), false, null)
    }
  }
  const seen = new Set<string>()
  for (const folder of codexSkillFolders(io))
    for (const skill of await skillsIn(folder)) {
      const file = await real(skill.file)
      if (seen.has(file)) continue
      seen.add(file)
      if (heard?.skills !== undefined && (await unchangedSince(skill.file, heard.at))) {
        let error: { readonly path: string; readonly message: string } | undefined
        for (const one of heard.skills) if (error === undefined && (await real(one.path)) === file) error = one
        if (error !== undefined)
          part('skill', skill.file, oneLine(`Codex leaves it out: ${error.message}`), false, 'codex', heard.at, skill.name)
        continue
      }
      const read = await readText(skill.file)
      if (read.kind === 'failed') {
        part('skill', skill.file, unopened(read.why, 'Codex'), false, null, now, skill.name)
        continue
      }
      const problem = read.kind === 'text' ? definitionProblem(frontOf(read.text), 'Codex') : undefined
      if (problem !== undefined) part('skill', skill.file, problem, false, null, now, skill.name)
    }
  return parts
}

/**
 * Reads each part of the person's own setup that doesn't load, Claude Code's first: what the agents last said, where
 * it still stands, and Althar's own reading of each file, off the thread that answers (every read is the file
 * system's own work). Never runs a command; never throws.
 */
export const scanSetup = async (io: SetupIo, kept: SetupRecord = readSetup(io)): Promise<ReadonlyArray<Part>> => {
  try {
    const now = io.now()
    const claude = kept.claude !== undefined && fresh(kept.claude.at, now) ? kept.claude : undefined
    const codex = kept.codex !== undefined && fresh(kept.codex.at, now) ? kept.codex : undefined
    const [ofClaude, ofCodex] = await Promise.all([claudeParts(io, claude, now), codexParts(io, codex, now)])
    return [...ofClaude, ...ofCodex]
  } catch {
    return []
  }
}

/** What was found of the setup when it was last read, as Settings shows it: one small file, no folder walked. */
export const setupParts = (io: Pick<SetupIo, 'folder'>): ReadonlyArray<Part> => readSetup(io).parts ?? []

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
  // Both whole, or it hasn't answered: a half is never kept as what it said.
  if (started === undefined || settings === undefined) return undefined
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
  // Its skills' answer whole, or it hasn't answered: a start alone is never kept as what it said.
  if (!started || listed === undefined) return undefined
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
  // Once both answers have come whole, each on a line of its own: never on a request's id alone, which may come in a piece.
  const done = (printed: string) => parseClaudeAnswers(printed) !== undefined
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

/**
 * The Codex to ask: in a Flatpak, the one on the device, through the bridge its sessions run it by (`CODEX_PATH`,
 * flatpak/codex-host.sh), as Codex can't run in the sandbox and is mostly installed outside it; else the person's own.
 */
export const codexCommand = (env: Readonly<Record<string, string | undefined>> = {}) =>
  env['FLATPAK_ID'] !== undefined && env['CODEX_PATH'] ? env['CODEX_PATH'] : 'codex'

const askCodex = async (converse: Converse, io: Pick<SetupIo, 'homeDir' | 'env'>): Promise<Omit<CodexHeard, 'at'> | undefined> => {
  const lines = (cwd: string) => [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'althar', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'skills/list', params: { cwds: [cwd] } }),
  ]
  try {
    const printed = await converse(codexCommand(io.env), ['app-server'], lines, (text) =>
      messagesIn(text).some((message) => message['id'] === 2),
    )
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

const AGENTS: ReadonlyArray<Part['agent']> = ['claude', 'codex']
const KINDS: ReadonlyArray<Part['kind']> = ['settings', 'hook', 'agent', 'command', 'output-style', 'skill', 'plugin', 'config']
const BY: ReadonlyArray<string> = ['claude', 'codex', 'opencode']

const partOf = (value: unknown): ReadonlyArray<Part> => {
  const one = record(value)
  if (one === undefined) return []
  const { agent, kind, name, where, why, loads, by, at, file } = one
  return AGENTS.includes(agent as Part['agent']) &&
    KINDS.includes(kind as Part['kind']) &&
    typeof name === 'string' &&
    typeof where === 'string' &&
    typeof why === 'string' &&
    typeof loads === 'boolean' &&
    (by === null || BY.includes(by as string)) &&
    typeof at === 'string' &&
    typeof file === 'string'
    ? [{ agent, kind, name, where, why, loads, by, at, file } as Part]
    : []
}

/** What was last kept; empty where nothing was, or where the file is damaged. Never runs a command. */
export const readSetup = (io: Pick<SetupIo, 'folder'>): SetupRecord => {
  let kept: Readonly<Record<string, unknown>> | undefined
  try {
    kept = record(JSON.parse(readFileSync(setupPath(io), 'utf8')))
  } catch {
    return emptySetup
  }
  if (kept === undefined) return emptySetup
  const claude = claudeHeardOf(kept['claude'])
  const codex = codexHeardOf(kept['codex'])
  return {
    checkedAt: typeof kept['checkedAt'] === 'string' ? kept['checkedAt'] : null,
    ...(claude === undefined ? {} : { claude }),
    ...(codex === undefined ? {} : { codex }),
    ...(Array.isArray(kept['parts']) ? { parts: kept['parts'].flatMap(partOf) } : {}),
  }
}

/** Writes the record whole or not at all: to a file beside it, then moved over it. */
const writeSetup = async (io: Pick<SetupIo, 'folder'>, kept: SetupRecord) => {
  await mkdir(io.folder, { recursive: true })
  const path = setupPath(io)
  const next = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(next, `${JSON.stringify(kept, null, 2)}\n`)
    await rename(next, path)
  } catch (error) {
    await unlink(next).catch(() => undefined)
    throw error
  }
}

/** One check a folder at a time: a second asked while one runs gets the first one's answer. */
const running = new Map<string, Promise<SetupRecord>>()

const checkNow = async (io: SetupIo, converse: Converse): Promise<SetupRecord> => {
  try {
    const before = readSetup(io)
    // The agents at most every few minutes; the files each time, so a file the person fixed shows fixed.
    if (before.checkedAt !== null && fresh(before.checkedAt, io.now(), ASK_EVERY)) {
      const next: SetupRecord = { ...before, parts: await scanSetup(io, before) }
      await writeSetup(io, next)
      return next
    }
    const [claude, codex] = await Promise.all([askClaude(converse), askCodex(converse, io)])
    const now = io.now()
    // An agent that couldn't be asked keeps what it last said, for a day.
    const keptClaude =
      claude !== undefined
        ? { at: now, ...claude }
        : before.claude !== undefined && fresh(before.claude.at, now)
          ? before.claude
          : undefined
    const keptCodex =
      codex !== undefined ? { at: now, ...codex } : before.codex !== undefined && fresh(before.codex.at, now) ? before.codex : undefined
    const heard: SetupRecord = {
      checkedAt: now,
      ...(keptClaude === undefined ? {} : { claude: keptClaude }),
      ...(keptCodex === undefined ? {} : { codex: keptCodex }),
    }
    const next: SetupRecord = { ...heard, parts: await scanSetup(io, heard) }
    await writeSetup(io, next)
    return next
  } catch {
    return readSetup(io)
  }
}

/**
 * Asks Claude Code and Codex, through their own commands, what of the person's setup they load, where they weren't
 * asked in the last few minutes, reads the rest of it, and keeps both for Settings. Never throws: an agent that
 * couldn't be asked keeps what it last said.
 */
export const checkSetup = (io: SetupIo, converse: Converse): Promise<SetupRecord> => {
  const before = running.get(io.folder)
  if (before !== undefined) return before
  const next = checkNow(io, converse).finally(() => running.delete(io.folder))
  running.set(io.folder, next)
  return next
}
