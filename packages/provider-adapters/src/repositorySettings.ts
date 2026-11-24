import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { jsonc } from './ownTools'

/*
 * A repository's own agent settings that run something on the computer (DEV-280, "Trusting a repository's agent
 * settings" in docs/decisions/what-agents-may-do.md): Claude Code's hooks and helpers in `.claude/settings.json` and
 * `.claude/settings.local.json`, Codex's hooks in `.codex/hooks.json` and its project config's hooks and `notify`, and
 * OpenCode's plugins, named in `opencode.json` or kept in `.opencode/plugin`. Each file is read as the agent reads it,
 * and kept by a hash of what in it runs, and of the scripts in the repository its commands name, so a branch that
 * changes one is seen; a change elsewhere in the file (a permission, a model) changes nothing. What they run isn't
 * judged: the person reads it.
 */

/** The agents whose repository settings Althar reads. */
export type SettingsAgent = 'claude-code' | 'codex' | 'opencode'

/** One thing a repository's settings run: where it is declared, by which agent, when, and the command itself. */
export interface RepositoryRun {
  readonly agent: SettingsAgent
  /** The file, from the repository's root, with `/` between folders. */
  readonly file: string
  /** Where in the file: `hooks.PreToolUse[0].hooks[1]`, `apiKeyHelper`, `plugin[0]`. */
  readonly key: string
  /** When the agent runs it, as the event it is declared for says it. */
  readonly when: string
  /** The command, a hook's address, or the plugin, as written. */
  readonly command: string
}

/** One of a repository's agent settings files that runs something, and the hash it is trusted by. */
export interface RepositorySettingsFile {
  readonly agent: SettingsAgent
  readonly file: string
  readonly hash: string
  readonly runs: ReadonlyArray<RepositoryRun>
}

/** What a Claude Code or Codex hook event means, said as when it runs. */
const EVENTS: Readonly<Record<string, string>> = {
  PreToolUse: 'Before a tool',
  PostToolUse: 'After a tool',
  PostToolUseFailure: 'After a tool fails',
  PermissionRequest: 'When it asks for permission',
  PermissionDenied: 'When a permission is denied',
  UserPromptSubmit: 'When a message is sent',
  SessionStart: 'At session start',
  SessionEnd: 'At session end',
  Stop: 'When it finishes a turn',
  StopFailure: 'When a turn fails',
  SubagentStart: 'When a subagent starts',
  SubagentStop: 'When a subagent finishes',
  PreCompact: 'Before it compacts',
  PostCompact: 'After it compacts',
  Notification: 'When it notifies',
  InstructionsLoaded: 'When instructions load',
  ConfigChange: 'When settings change',
  CwdChanged: 'When its folder changes',
  FileChanged: 'When a file changes',
  WorktreeCreate: 'When a worktree is made',
  WorktreeRemove: 'When a worktree is removed',
  TaskCreated: 'When a task is made',
  TaskCompleted: 'When a task is done',
  TeammateIdle: 'When a teammate is idle',
  Elicitation: 'When a server asks',
  ElicitationResult: 'After a server is answered',
}

/** Claude Code's settings that run a command of their own, besides hooks, and when. */
const CLAUDE_HELPERS: ReadonlyArray<readonly [string, string]> = [
  ['apiKeyHelper', 'When it needs an API key'],
  ['awsAuthRefresh', 'When it signs in to AWS'],
  ['awsCredentialExport', 'When it signs in to AWS'],
  ['otelHeadersHelper', 'When it sends telemetry'],
]

interface Found {
  readonly key: string
  readonly when: string
  readonly command: string
  /** What the hash reads beside the command: a hook's event and matcher, as written. */
  readonly raw: string
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const words = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : Array.isArray(value) && value.length > 0 && value.every((word) => typeof word === 'string')
      ? value.join(' ')
      : null

/**
 * The hooks in Claude Code's shape, which Codex's `hooks.json` and its config's `[hooks]` share: each event's groups,
 * by matcher, each with hooks that run a command or post to an address. A prompt or agent hook asks the model and
 * runs nothing itself, so it isn't listed.
 */
const hooksIn = (hooks: unknown, at: string): ReadonlyArray<Found> => {
  if (!isObject(hooks)) return []
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group: unknown, index) => {
      if (!isObject(group)) return []
      const matcher = typeof group.matcher === 'string' && group.matcher !== '' && group.matcher !== '*' ? group.matcher : null
      const when = `${EVENTS[event] ?? event}${matcher === null ? '' : ` (${matcher})`}`
      return (Array.isArray(group.hooks) ? group.hooks : []).flatMap((hook: unknown, place): ReadonlyArray<Found> => {
        if (!isObject(hook)) return []
        const key = `${at}.${event}[${index}].hooks[${place}]`
        const raw = `${event}\0${matcher ?? ''}\0${String(hook.type ?? 'command')}`
        const command = words(hook.command)
        if (command !== null && (hook.type === undefined || hook.type === 'command')) return [{ key, when, command, raw }]
        if (hook.type === 'http' && typeof hook.url === 'string') return [{ key, when, command: `POST ${hook.url}`, raw }]
        return []
      })
    }),
  )
}

const claudeSettings = (text: string): ReadonlyArray<Found> => {
  const settings = jsonc(text)
  if (!isObject(settings)) return []
  return [
    ...hooksIn(settings.hooks, 'hooks'),
    ...CLAUDE_HELPERS.flatMap(([key, when]) => {
      const command = words(settings[key])
      return command === null ? [] : [{ key, when, command, raw: key }]
    }),
  ]
}

const codexHooks = (text: string): ReadonlyArray<Found> => {
  const file = jsonc(text)
  return isObject(file) ? hooksIn(file.hooks, 'hooks') : []
}

const codexConfig = (text: string): ReadonlyArray<Found> => {
  let config: unknown
  try {
    config = parseToml(text)
  } catch {
    return []
  }
  if (!isObject(config)) return []
  const notify = words(config.notify)
  return [
    ...hooksIn(config.hooks, 'hooks'),
    ...(notify === null ? [] : [{ key: 'notify', when: 'When it finishes a turn', command: notify, raw: 'notify' }]),
  ]
}

/** OpenCode's config: the plugins it loads as it starts, and the commands of its older `experimental.hook`. */
const openCodeConfig = (text: string): ReadonlyArray<Found> => {
  const config = jsonc(text)
  if (!isObject(config)) return []
  const plugins = (Array.isArray(config.plugin) ? config.plugin : []).flatMap((plugin: unknown, index): ReadonlyArray<Found> => {
    const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) && typeof plugin[0] === 'string' ? plugin[0] : null
    return name === null ? [] : [{ key: `plugin[${index}]`, when: 'As it starts', command: name, raw: 'plugin' }]
  })
  const experimental = isObject(config.experimental) && isObject(config.experimental.hook) ? config.experimental.hook : {}
  const edited = isObject(experimental.file_edited)
    ? Object.entries(experimental.file_edited).flatMap(([pattern, hooks]) =>
        (Array.isArray(hooks) ? hooks : []).flatMap((hook: unknown, index): ReadonlyArray<Found> => {
          const command = isObject(hook) ? words(hook.command) : null
          return command === null
            ? []
            : [{ key: `experimental.hook.file_edited["${pattern}"][${index}]`, when: `After an edit (${pattern})`, command, raw: pattern }]
        }),
      )
    : []
  const completed = (Array.isArray(experimental.session_completed) ? experimental.session_completed : []).flatMap(
    (hook: unknown, index): ReadonlyArray<Found> => {
      const command = isObject(hook) ? words(hook.command) : null
      return command === null
        ? []
        : [{ key: `experimental.hook.session_completed[${index}]`, when: 'When it finishes a turn', command, raw: 'completed' }]
    },
  )
  return [...plugins, ...edited, ...completed]
}

/** The files each agent reads, from the repository's root, and how what runs is read from each. */
const FILES: ReadonlyArray<{
  readonly agent: SettingsAgent
  readonly file: string
  readonly read: (text: string) => ReadonlyArray<Found>
}> = [
  { agent: 'claude-code', file: '.claude/settings.json', read: claudeSettings },
  { agent: 'claude-code', file: '.claude/settings.local.json', read: claudeSettings },
  { agent: 'codex', file: '.codex/hooks.json', read: codexHooks },
  { agent: 'codex', file: '.codex/config.toml', read: codexConfig },
  { agent: 'opencode', file: 'opencode.json', read: openCodeConfig },
  { agent: 'opencode', file: 'opencode.jsonc', read: openCodeConfig },
  { agent: 'opencode', file: '.opencode/opencode.json', read: openCodeConfig },
  { agent: 'opencode', file: '.opencode/opencode.jsonc', read: openCodeConfig },
]

/** OpenCode's plugin folders, each of whose files it loads as code as it starts. */
const PLUGIN_FOLDERS = ['.opencode/plugin', '.opencode/plugins']
const PLUGIN_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/

/** Larger than a settings file or a hook's script would be: read no further. */
const MOST = 1_000_000

const text = async (path: string): Promise<string | null> => {
  try {
    const found = await stat(path)
    return found.isFile() && found.size <= MOST ? await readFile(path, 'utf8') : null
  } catch {
    return null
  }
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex')

/** Within the repository: a path from its root, with `/` between folders, or nothing where it leads outside. */
const within = (folder: string, path: string): string | null => {
  const inside = relative(folder, path)
  return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? null : inside.split(sep).join('/')
}

/**
 * The repository's files a command names, such as `"$CLAUDE_PROJECT_DIR"/.claude/hooks/check.sh` or
 * `node scripts/hook.js`: their content counts with the command, so a branch that changes a hook's script asks again.
 */
const namedScripts = async (folder: string, command: string): Promise<ReadonlyArray<readonly [string, string]>> => {
  const tokens = command
    .replace(/\$\{?(?:CLAUDE_PROJECT_DIR|CODEX_PROJECT_DIR|PWD)\}?/g, folder)
    .split(/[\s;&|()<>]+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, '').replace(/["']/g, ''))
    .filter((token) => token !== '' && (token.includes('/') || /\.[a-z0-9]+$/i.test(token)) && !token.includes('://'))
  const found = await Promise.all(
    [...new Set(tokens)].map(async (token) => {
      const path = normalize(isAbsolute(token) ? token : join(folder, token))
      const inside = within(folder, path)
      if (inside === null) return null
      const content = await text(path)
      return content === null ? null : ([inside, sha(content)] as const)
    }),
  )
  return found.filter((one) => one !== null)
}

/** A file's entry: what in it runs, and the hash of that and of each script it names. */
const entryOf = async (
  folder: string,
  agent: SettingsAgent,
  file: string,
  found: ReadonlyArray<Found>,
  own?: string,
): Promise<RepositorySettingsFile | null> => {
  if (found.length === 0) return null
  const scripts = (await Promise.all(found.map((one) => namedScripts(folder, one.command)))).flat()
  const hash = sha(
    JSON.stringify({
      runs: found.map(({ key, command, raw }) => [key, raw, command]),
      scripts: [...new Map(scripts)].toSorted(([a], [b]) => a.localeCompare(b)),
      ...(own === undefined ? {} : { own: sha(own) }),
    }),
  )
  return { agent, file, hash, runs: found.map(({ key, when, command }) => ({ agent, file, key, when, command })) }
}

/**
 * What a repository's agent settings run, file by file, as they stand in `folder` (its checkout, or a task's
 * worktree of it): only the files that run something. Reads off the thread; a file it can't read counts as none.
 */
export const readRepositorySettings = async (folder: string): Promise<ReadonlyArray<RepositorySettingsFile>> => {
  const files = await Promise.all(
    FILES.map(async ({ agent, file, read }) => {
      const content = await text(join(folder, ...file.split('/')))
      return content === null ? null : entryOf(folder, agent, file, read(content))
    }),
  )
  const plugins = await Promise.all(
    PLUGIN_FOLDERS.map(async (plugins) => {
      const names = await readdir(join(folder, ...plugins.split('/'))).catch(() => [])
      return Promise.all(
        names
          .filter((name) => PLUGIN_FILE.test(name))
          .toSorted()
          .map(async (name) => {
            const file = `${plugins}/${name}`
            const content = await text(join(folder, ...file.split('/')))
            return content === null
              ? null
              : entryOf(folder, 'opencode', file, [{ key: 'plugin', when: 'As it starts', command: file, raw: 'plugin' }], content)
          }),
      )
    }),
  )
  return [...files, ...plugins.flat()].filter((entry) => entry !== null)
}

/** Which of `files` aren't trusted: those whose hash `trusted` doesn't hold for their file, never seen or changed since. */
export const untrustedOf = (
  files: ReadonlyArray<RepositorySettingsFile>,
  trusted: ReadonlyArray<{ readonly file: string; readonly hash: string }>,
): ReadonlyArray<RepositorySettingsFile> =>
  files.filter((entry) => !trusted.some((one) => one.file === entry.file && one.hash === entry.hash))
