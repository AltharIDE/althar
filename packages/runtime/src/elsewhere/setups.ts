import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { OtherTool } from '@althar/domain'
import { parse as parseJsonc } from 'jsonc-parser'

/*
 * The setup other tools keep for a repository's new worktrees, read from
 * the person's checkout (docs/decisions/workspaces-and-runs.md, "Bringing in
 * other tools' work"), as each tool's own code reads it:
 *
 * - Conductor: `conductor.json`'s `scripts.setup`, or `.conductor/settings.toml`'s
 *   `[scripts] setup`; its files to copy in, `.worktreeinclude`.
 * - Orca: `orca.yaml`'s `scripts.setup`, a string, usually a `|` block.
 * - T3 Code: `t3.json`'s `scripts`, those with `runOnWorktreeCreate`.
 * - Paradev: `.paradev/config.toml` (or `.superset/`), `[install]` then
 *   `[setup]`, each `run` a string or a list, in `cwd` where it says; the
 *   older `config.json`'s `setup` list.
 * - Cursor: `.cursor/worktrees.json`'s `setup-worktree-unix` or
 *   `setup-worktree`, a list of commands or a script's path.
 *
 * Each becomes what Althar records for a repository: the commands it runs in
 * a new worktree, one after another, and the files it copies in from the
 * checkout. A tool's scripts read where the checkout is from variables it
 * sets (`$CONDUCTOR_ROOT_PATH` and the like): a command that uses one has it
 * set first, to the checkout, or the worktree it runs in, so it runs as it
 * did there. Only the setup's own files are read, never run.
 */

export interface FoundSetup {
  readonly tool: OtherTool
  /** The file it came from, inside the repository. */
  readonly file: string
  readonly commands: ReadonlyArray<string>
  readonly copy: ReadonlyArray<string>
}

/** A setup file longer than this isn't a setup. */
const LONGEST = 256 * 1024

const read = (path: string) =>
  readFile(path, 'utf8').then(
    (body) => (body.length > LONGEST ? null : body),
    () => null,
  )
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const commandsOf = (value: unknown): ReadonlyArray<string> =>
  typeof value === 'string'
    ? value.trim() === ''
      ? []
      : [value.trim()]
    : Array.isArray(value)
      ? value.flatMap((one) => (typeof one === 'string' && one.trim() !== '' ? [one.trim()] : []))
      : []

/** A string as a shell reads it once, in single quotes. */
export const quoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/**
 * Each tool's variables for where the checkout and the worktree are, as its scripts read them. The worktree is the folder the
 * command runs in, so it is `$PWD` when it runs.
 */
const VARIABLES: Partial<Record<OtherTool, Record<string, 'root' | 'worktree' | 'name' | 'branch'>>> = {
  conductor: {
    CONDUCTOR_ROOT_PATH: 'root',
    CONDUCTOR_WORKSPACE_PATH: 'worktree',
    CONDUCTOR_WORKSPACE_NAME: 'name',
    CONDUCTOR_DEFAULT_BRANCH: 'branch',
  },
  orca: {
    ORCA_ROOT_PATH: 'root',
    ORCA_WORKTREE_PATH: 'worktree',
    ORCA_WORKSPACE_NAME: 'name',
    CONDUCTOR_ROOT_PATH: 'root',
    CONDUCTOR_WORKSPACE_PATH: 'worktree',
    CONDUCTOR_WORKSPACE_NAME: 'name',
  },
  t_three_code: { T3CODE_PROJECT_ROOT: 'root', T3CODE_WORKTREE_PATH: 'worktree' },
  paradev: { SUPERSET_ROOT_PATH: 'root', SUPERSET_WORKSPACE_PATH: 'worktree', SUPERSET_WORKSPACE_NAME: 'name' },
  cursor: { ROOT_WORKTREE_PATH: 'root' },
}

/** A command, with the tool's variables it reads set first: the checkout's place, as it was where it ran before. */
export const withPlaces = (tool: OtherTool, command: string, root: string, defaultBranch: string) => {
  const used = Object.entries(VARIABLES[tool] ?? {}).filter(([name]) => new RegExp(`\\$\\{?${name}\\b`).test(command))
  if (used.length === 0) return command
  const value = (what: 'root' | 'worktree' | 'name' | 'branch') =>
    what === 'root' ? quoted(root) : what === 'worktree' ? '"$PWD"' : what === 'name' ? '"$(basename "$PWD")"' : quoted(defaultBranch)
  return `export ${used.map(([name, what]) => `${name}=${value(what)}`).join(' ')}\n${command}`
}

/**
 * The value of `scripts.<key>` in a YAML file such as `orca.yaml`: a plain or
 * quoted scalar, or a `|` or `>` block. Only that shape is read: anything
 * else is no setup, never a guess.
 */
export const yamlScript = (body: string, key: string): string | null => {
  const lines = body.replaceAll('\r\n', '\n').split('\n')
  const top = lines.findIndex((line) => /^scripts:\s*(#.*)?$/.test(line))
  if (top === -1) return null
  for (let at = top + 1; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    // Back at the top level: `scripts` is over.
    if (!/^\s/.test(line)) return null
    const match = /^(\s+)([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (match === null || match[2] !== key) continue
    const indent = (match[1] ?? '').length
    const rest = (match[3] ?? '').replace(/\s+#.*$/, '').trim()
    const block = /^([|>])[+-]?$/.exec(rest)
    if (block === null) {
      const single = /^'(.*)'$/.exec(rest)
      if (single !== null) return (single[1] ?? '').replaceAll("''", "'")
      const double = /^"(.*)"$/.exec(rest)
      if (double !== null) return (JSON.parse(`"${double[1] ?? ''}"`) as string).trim() || null
      return rest === '' ? null : rest
    }
    const taken: Array<string> = []
    for (let next = at + 1; next < lines.length; next++) {
      const one = lines[next] ?? ''
      if (one.trim() !== '' && one.length - one.trimStart().length <= indent) break
      taken.push(one)
    }
    const depth = Math.min(...taken.filter((one) => one.trim() !== '').map((one) => one.length - one.trimStart().length))
    const text = taken.map((one) => one.slice(Number.isFinite(depth) ? depth : 0)).join(block[1] === '>' ? ' ' : '\n')
    return text.trim() === '' ? null : text.trim()
  }
  return null
}

/** A TOML string or list of strings, as a setup's `run` is written: basic, literal and multi-line strings. */
const tomlValue = (source: string): { readonly value: unknown; readonly rest: string } | null => {
  const text = source.trimStart()
  for (const [open, raw] of [
    ['"""', false],
    ["'''", true],
  ] as const) {
    if (text.startsWith(open)) {
      const end = text.indexOf(open, 3)
      if (end === -1) return null
      const inner = text.slice(3, end).replace(/^\n/, '')
      return {
        value: raw ? inner : inner.replace(/\\\n\s*/g, '').replace(/\\(["\\nt])/g, (_, c: string) => ({ n: '\n', t: '\t' })[c] ?? c),
        rest: text.slice(end + 3),
      }
    }
  }
  if (text.startsWith('"')) {
    const match = /^"((?:[^"\\\n]|\\.)*)"/.exec(text)
    if (match === null) return null
    try {
      return { value: JSON.parse(`"${match[1] ?? ''}"`) as string, rest: text.slice(match[0].length) }
    } catch {
      return null
    }
  }
  if (text.startsWith("'")) {
    const match = /^'([^'\n]*)'/.exec(text)
    return match === null ? null : { value: match[1] ?? '', rest: text.slice(match[0].length) }
  }
  if (text.startsWith('[')) {
    const values: Array<unknown> = []
    let rest = text.slice(1)
    for (;;) {
      rest = rest.replace(/^(\s|#[^\n]*)+/, '')
      if (rest.startsWith(']')) return { value: values, rest: rest.slice(1) }
      const next = tomlValue(rest)
      if (next === null) return null
      values.push(next.value)
      rest = next.rest.replace(/^(\s|#[^\n]*)+/, '')
      if (rest.startsWith(',')) rest = rest.slice(1)
      else if (!rest.startsWith(']')) return null
    }
  }
  return null
}

/** A key's value in one table of a TOML file (`[setup]`'s `run`), where it is a string or a list of them. */
export const tomlKey = (body: string, table: string, key: string): unknown => {
  const text = body.replaceAll('\r\n', '\n')
  const header = new RegExp(`^\\[\\s*${table.replaceAll('.', '\\.')}\\s*\\]\\s*(#.*)?$`, 'm').exec(text)
  if (header === null) return undefined
  const after = text.slice(header.index + header[0].length)
  const next = /^\[/m.exec(after)
  const section = next === null ? after : after.slice(0, next.index)
  const line = new RegExp(`^\\s*${key}\\s*=\\s*`, 'm').exec(section)
  if (line === null) return undefined
  return tomlValue(section.slice(line.index + line[0].length))?.value
}

const json = (body: string | null) => (body === null ? null : record(parseJsonc(body)))

/** What lines of a `.worktreeinclude` name, as files or folders to copy in: patterns aren't followed, only plain names. */
const includes = (body: string | null) =>
  (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!') && !/[*?[]/.test(line))

/** The setups other tools keep in the repository checked out at `root`, each as Althar would record it. */
export const setupsIn = async (root: string, defaultBranch: string): Promise<ReadonlyArray<FoundSetup>> => {
  const found: Array<FoundSetup> = []
  const add = (tool: OtherTool, file: string, commands: ReadonlyArray<string>, copy: ReadonlyArray<string> = [], cwd?: unknown) => {
    const inside = typeof cwd === 'string' && cwd.trim() !== '' && cwd.trim() !== '.' ? `cd ${quoted(cwd.trim())} && ` : ''
    const all = commands.map((command) => withPlaces(tool, `${inside}${command}`, root, defaultBranch))
    if (all.length > 0) found.push({ tool, file, commands: all, copy })
  }

  const conductor = json(await read(join(root, 'conductor.json')))
  const conductorToml = await read(join(root, '.conductor', 'settings.toml'))
  const include = includes(await read(join(root, '.worktreeinclude')))
  const conductorSetup =
    record(conductor?.['scripts'])?.['setup'] ?? (conductorToml === null ? undefined : tomlKey(conductorToml, 'scripts', 'setup'))
  add('conductor', conductor !== null ? 'conductor.json' : '.conductor/settings.toml', commandsOf(conductorSetup), include)

  const orca = await read(join(root, 'orca.yaml'))
  if (orca !== null) add('orca', 'orca.yaml', commandsOf(yamlScript(orca, 'setup')))

  const t3 = json(await read(join(root, 't3.json')))
  const scripts = Array.isArray(t3?.['scripts']) ? t3['scripts'] : []
  add(
    't_three_code',
    't3.json',
    scripts.flatMap((script) => (record(script)?.['runOnWorktreeCreate'] === true ? commandsOf(record(script)?.['command']) : [])),
  )

  for (const folder of ['.paradev', '.superset']) {
    const toml = await read(join(root, folder, 'config.toml'))
    if (toml !== null) {
      const install = commandsOf(tomlKey(toml, 'install', 'run'))
      const setup = commandsOf(tomlKey(toml, 'setup', 'run'))
      const cwd = tomlKey(toml, 'setup', 'cwd') ?? tomlKey(toml, 'install', 'cwd')
      add('paradev', `${folder}/config.toml`, [...install, ...setup], [], cwd)
      break
    }
    const legacy = json(await read(join(root, folder, 'config.json')))
    if (legacy !== null) {
      add('paradev', `${folder}/config.json`, commandsOf(legacy['setup']))
      break
    }
  }

  const cursor = json(await read(join(root, '.cursor', 'worktrees.json')))
  if (cursor !== null) {
    const setup = cursor['setup-worktree-unix'] ?? cursor['setup-worktree']
    // A script's path, as Cursor takes one, runs from the checkout it is in.
    const commands =
      typeof setup === 'string' && !/\s/.test(setup.trim()) && /\.(sh|bash|zsh)$/.test(setup.trim())
        ? [`bash ${quoted(join(root, '.cursor', setup.trim()))}`]
        : commandsOf(setup)
    add('cursor', '.cursor/worktrees.json', commands)
  }
  return found
}
