import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { jsonc } from './ownTools'

/*
 * A repository's own agent settings that run something on the computer (DEV-280, "Trusting a repository's agent
 * settings" in docs/decisions/what-agents-may-do.md): Claude Code's hooks, helpers, status line, plugins and the
 * `.mcp.json` servers its settings start, in `.claude/settings.json` and `.claude/settings.local.json`; Codex's hooks,
 * `notify` and MCP servers in `.codex/`; and OpenCode's plugins, formatters, language servers and MCP servers in
 * `opencode.json`, and the plugins and tools it loads as code in `.opencode/`. Each file is read as the agent reads
 * it, at the repository's root and each folder down to where its agent starts, and kept by a hash of the whole of what
 * in it runs, and of the scripts in the repository its commands name, so a branch that changes one is seen; a change
 * elsewhere in the file (a permission, a model) changes nothing. A file there that can't be read is never trusted.
 * What they run isn't judged: the person reads it.
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
  /** There, but not read as its agent would read it, and why: never trusted, since it may run anything. */
  readonly unread?: string
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

/** Claude Code's settings that run a command given as `{ type: 'command', command }`, and when. */
const CLAUDE_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['statusLine', 'As it draws its status line'],
  ['fileSuggestion', 'As it suggests files'],
]

interface Found {
  readonly key: string
  readonly when: string
  /** What the person reads: the command, a hook's address, or the plugin, as written. */
  readonly command: string
  /**
   * What the agent is given, whole: a hook with its event, matcher, headers and options, a plugin with its options, a
   * server with its arguments and environment. The hash reads this, in a canonical form, never what is shown.
   */
  readonly definition: unknown
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const words = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : Array.isArray(value) && value.length > 0 && value.every((word) => typeof word === 'string')
      ? value.join(' ')
      : null

/** A command and its arguments as one line to read, where they are kept apart (`command` and `args`). */
const commandLine = (command: unknown, args: unknown): string | null => {
  const head = words(command)
  if (head === null) return null
  const rest = Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === 'string') : []
  return [head, ...rest].join(' ')
}

/** A file's text as JSON with comments and trailing commas, as Claude Code, Codex and OpenCode take it; undefined where it isn't. */
const parsed = (text: string): { readonly value: unknown } | undefined => {
  const value = jsonc(text)
  // `jsonc` answers null for what it can't read, and for a file that is `null`, which runs nothing either way.
  return value === null && text.trim() !== 'null' ? undefined : { value }
}

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
        const definition = { event, matcher: group.matcher ?? null, hook }
        const command = words(hook.command)
        if (command !== null && (hook.type === undefined || hook.type === 'command')) return [{ key, when, command, definition }]
        if (hook.type === 'http' && typeof hook.url === 'string') return [{ key, when, command: `POST ${hook.url}`, definition }]
        return []
      })
    }),
  )
}

/** MCP servers that start a command (`command` and `args`), by name: Claude Code's `.mcp.json`, Codex's `mcp_servers`. */
const serversIn = (servers: unknown, at: string, when: string, only?: (name: string) => boolean): ReadonlyArray<Found> =>
  isObject(servers)
    ? Object.entries(servers).flatMap(([name, server]): ReadonlyArray<Found> => {
        if (!isObject(server) || (only !== undefined && !only(name))) return []
        const command = commandLine(server.command, server.args)
        return command === null ? [] : [{ key: `${at}.${name}`, when, command, definition: server }]
      })
    : []

/** What a level of the repository holds beside a settings file, which some settings bring in: Claude Code's `.mcp.json`. */
interface Beside {
  readonly mcp: unknown
}

const claudeSettings = (settings: unknown, beside: Beside): ReadonlyArray<Found> => {
  if (!isObject(settings)) return []
  const enabled = Array.isArray(settings.enabledMcpjsonServers) ? settings.enabledMcpjsonServers : []
  const plugins = isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  return [
    ...hooksIn(settings.hooks, 'hooks'),
    ...CLAUDE_HELPERS.flatMap(([key, when]) => {
      const command = words(settings[key])
      return command === null ? [] : [{ key, when, command, definition: settings[key] }]
    }),
    ...CLAUDE_COMMANDS.flatMap(([key, when]) => {
      const setting = settings[key]
      const command = isObject(setting) && (setting.type === undefined || setting.type === 'command') ? words(setting.command) : null
      return command === null ? [] : [{ key, when, command, definition: setting }]
    }),
    // A plugin brings hooks, servers and commands of its own; from a marketplace the repository may name too.
    ...Object.entries(plugins).flatMap(([name, on]) =>
      on === true
        ? [
            {
              key: `enabledPlugins["${name}"]`,
              when: 'As it starts',
              command: `Plugin ${name}`,
              definition: { name, marketplaces: settings.extraKnownMarketplaces ?? null },
            },
          ]
        : [],
    ),
    // The repository's `.mcp.json` servers, where these settings start them without asking.
    ...(settings.enableAllProjectMcpServers === true || enabled.length > 0
      ? serversIn(
          isObject(beside.mcp) ? beside.mcp.mcpServers : undefined,
          '.mcp.json mcpServers',
          'As it starts (MCP server)',
          settings.enableAllProjectMcpServers === true ? undefined : (name) => enabled.includes(name),
        )
      : []),
  ]
}

const codexHooks = (file: unknown): ReadonlyArray<Found> => (isObject(file) ? hooksIn(file.hooks, 'hooks') : [])

const codexConfig = (config: unknown): ReadonlyArray<Found> => {
  if (!isObject(config)) return []
  const notify = words(config.notify)
  return [
    ...hooksIn(config.hooks, 'hooks'),
    ...(notify === null ? [] : [{ key: 'notify', when: 'When it finishes a turn', command: notify, definition: config.notify }]),
    ...serversIn(config.mcp_servers, 'mcp_servers', 'As it starts (MCP server)'),
  ]
}

/** OpenCode's `formatter` and `lsp`: each named one that runs a command of the repository's, unless turned off. */
const openCodeCommands = (section: unknown, at: string, when: (name: string, entry: Readonly<Record<string, unknown>>) => string) =>
  isObject(section)
    ? Object.entries(section).flatMap(([name, entry]): ReadonlyArray<Found> => {
        if (!isObject(entry) || entry.disabled === true) return []
        const command = words(entry.command)
        return command === null ? [] : [{ key: `${at}.${name}`, when: when(name, entry), command, definition: entry }]
      })
    : []

const extensions = (entry: Readonly<Record<string, unknown>>) =>
  Array.isArray(entry.extensions) && entry.extensions.length > 0 ? ` (${entry.extensions.join(', ')})` : ''

/**
 * OpenCode's config, as 1.18 takes it: the plugins it loads as it starts, the formatters it runs after an edit, the
 * language servers it starts as it reads a file, its local MCP servers, and the commands of its older `experimental.hook`.
 */
const openCodeConfig = (config: unknown): ReadonlyArray<Found> => {
  if (!isObject(config)) return []
  const plugins = (Array.isArray(config.plugin) ? config.plugin : []).flatMap((plugin: unknown, index): ReadonlyArray<Found> => {
    const name = typeof plugin === 'string' ? plugin : Array.isArray(plugin) && typeof plugin[0] === 'string' ? plugin[0] : null
    return name === null ? [] : [{ key: `plugin[${index}]`, when: 'As it starts', command: name, definition: plugin }]
  })
  const servers = isObject(config.mcp)
    ? Object.entries(config.mcp).flatMap(([name, server]): ReadonlyArray<Found> => {
        if (!isObject(server) || server.type !== 'local' || server.enabled === false) return []
        const command = words(server.command)
        return command === null ? [] : [{ key: `mcp.${name}`, when: 'As it starts (MCP server)', command, definition: server }]
      })
    : []
  const experimental = isObject(config.experimental) && isObject(config.experimental.hook) ? config.experimental.hook : {}
  const edited = isObject(experimental.file_edited)
    ? Object.entries(experimental.file_edited).flatMap(([pattern, hooks]) =>
        (Array.isArray(hooks) ? hooks : []).flatMap((hook: unknown, index): ReadonlyArray<Found> => {
          const command = isObject(hook) ? words(hook.command) : null
          return command === null
            ? []
            : [
                {
                  key: `experimental.hook.file_edited["${pattern}"][${index}]`,
                  when: `After an edit (${pattern})`,
                  command,
                  definition: { pattern, hook },
                },
              ]
        }),
      )
    : []
  const completed = (Array.isArray(experimental.session_completed) ? experimental.session_completed : []).flatMap(
    (hook: unknown, index): ReadonlyArray<Found> => {
      const command = isObject(hook) ? words(hook.command) : null
      return command === null
        ? []
        : [{ key: `experimental.hook.session_completed[${index}]`, when: 'When it finishes a turn', command, definition: hook }]
    },
  )
  return [
    ...plugins,
    ...openCodeCommands(config.formatter, 'formatter', (_, entry) => `After an edit${extensions(entry)}`),
    ...openCodeCommands(config.lsp, 'lsp', (_, entry) => `As it reads a file${extensions(entry)}`),
    ...servers,
    ...edited,
    ...completed,
  ]
}

/** The files each agent reads, from a folder it starts in or above it, how each is parsed, and how what runs is read from it. */
const FILES: ReadonlyArray<{
  readonly agent: SettingsAgent
  readonly file: string
  readonly parse: (text: string) => { readonly value: unknown } | undefined
  readonly read: (value: unknown, beside: Beside) => ReadonlyArray<Found>
}> = [
  { agent: 'claude-code', file: '.claude/settings.json', parse: parsed, read: claudeSettings },
  { agent: 'claude-code', file: '.claude/settings.local.json', parse: parsed, read: claudeSettings },
  { agent: 'codex', file: '.codex/hooks.json', parse: parsed, read: codexHooks },
  { agent: 'codex', file: '.codex/config.toml', parse: toml, read: codexConfig },
  { agent: 'opencode', file: 'opencode.json', parse: parsed, read: openCodeConfig },
  { agent: 'opencode', file: 'opencode.jsonc', parse: parsed, read: openCodeConfig },
  { agent: 'opencode', file: '.opencode/opencode.json', parse: parsed, read: openCodeConfig },
  { agent: 'opencode', file: '.opencode/opencode.jsonc', parse: parsed, read: openCodeConfig },
]

function toml(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: parseToml(text) }
  } catch {
    return undefined
  }
}

/** OpenCode's folders each of whose files it loads as code as it starts: its plugins, and its own tools. */
const CODE_FOLDERS: ReadonlyArray<readonly [string, string]> = [
  ['.opencode/plugin', 'As it starts'],
  ['.opencode/plugins', 'As it starts'],
  ['.opencode/tool', 'As it starts (a tool of its own)'],
  ['.opencode/tools', 'As it starts (a tool of its own)'],
]
const CODE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/

/** Larger than a settings file or a hook's script would be: read no further. */
const MOST = 1_000_000

/** A file as read: not there, its text, or there but not read, and why. */
type Read = { readonly absent: true } | { readonly text: string } | { readonly unread: string }

const ABSENT = new Set(['ENOENT', 'ENOTDIR'])
const codeOf = (error: unknown) => (isObject(error) && typeof error.code === 'string' ? error.code : undefined)

const readText = async (path: string): Promise<Read> => {
  try {
    const found = await stat(path)
    if (!found.isFile()) return { unread: 'It isn’t a file' }
    if (found.size > MOST) return { unread: 'Larger than Althar reads (1 MB)' }
    return { text: await readFile(path, 'utf8') }
  } catch (error) {
    return ABSENT.has(codeOf(error) ?? '') ? { absent: true } : { unread: `It couldn’t be read (${codeOf(error) ?? 'unknown'})` }
  }
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex')

/**
 * A script's content hash, read through whatever its size, so a large one that changes still counts as changed: not
 * there, its hash, or there but not read, and why.
 */
const hashOfFile = async (path: string): Promise<{ readonly absent: true } | { readonly hash: string } | { readonly unread: string }> => {
  try {
    const found = await stat(path)
    if (!found.isFile()) return { unread: 'It isn’t a file' }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
    return { hash: hash.digest('hex') }
  } catch (error) {
    return ABSENT.has(codeOf(error) ?? '') ? { absent: true } : { unread: `It couldn’t be read (${codeOf(error) ?? 'unknown'})` }
  }
}

/** `value` as JSON with each object's keys in order, so the same definition always hashes the same. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : isObject(value)
      ? `{${Object.keys(value)
          .toSorted()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : (JSON.stringify(value) ?? 'null')

/** Within the repository: a path from its root, with `/` between folders, or nothing where it leads outside. */
const within = (folder: string, path: string): string | null => {
  const inside = relative(folder, path)
  return inside === '' || inside.startsWith('..') || isAbsolute(inside) ? null : inside.split(sep).join('/')
}

/**
 * The repository's files a command names, such as `"$CLAUDE_PROJECT_DIR"/.claude/hooks/check.sh` or
 * `node scripts/hook.js`, from the folder it runs in: their content counts with the command, so a branch that changes a
 * hook's script asks again. One there but not read counts by why, so it never matches a script that was.
 */
const namedScripts = async (root: string, level: string, command: string): Promise<ReadonlyArray<readonly [string, string]>> => {
  const tokens = command
    .replace(/\$\{?(?:CLAUDE_PROJECT_DIR|CODEX_PROJECT_DIR|PWD)\}?/g, level)
    .split(/[\s;&|()<>]+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, '').replace(/["']/g, ''))
    .filter((token) => token !== '' && (token.includes('/') || /\.[a-z0-9]+$/i.test(token)) && !token.includes('://'))
  const found = await Promise.all(
    [...new Set(tokens)].map(async (token) => {
      const path = normalize(isAbsolute(token) ? token : join(level, token))
      const inside = within(root, path)
      if (inside === null) return null
      const read = await hashOfFile(path)
      return 'absent' in read ? null : ([inside, 'hash' in read ? read.hash : `unread:${read.unread}`] as const)
    }),
  )
  return found.filter((one) => one !== null)
}

/** A file's entry: what in it runs, and the hash of each whole definition and of each script it names. */
const entryOf = async (
  root: string,
  level: string,
  agent: SettingsAgent,
  file: string,
  found: ReadonlyArray<Found>,
  own?: string,
): Promise<RepositorySettingsFile | null> => {
  if (found.length === 0) return null
  const scripts = (await Promise.all(found.map((one) => namedScripts(root, level, one.command)))).flat()
  const hash = sha(
    canonical({
      runs: found.map(({ key, definition }) => [key, definition]),
      scripts: [...new Map(scripts)].toSorted(([a], [b]) => a.localeCompare(b)),
      ...(own === undefined ? {} : { own: sha(own) }),
    }),
  )
  return { agent, file, hash, runs: found.map(({ key, when, command }) => ({ agent, file, key, when, command })) }
}

/**
 * A file that is there but couldn't be read as its agent would: it may run anything, so it is never trusted, and the
 * person sees why. Its hash says so, and never matches one that was read.
 */
const unreadEntry = (agent: SettingsAgent, file: string, why: string): RepositorySettingsFile => ({
  agent,
  file,
  hash: `unread:${sha(`${file}\0${why}`)}`,
  runs: [{ agent, file, key: '', when: 'Not read', command: why }],
  unread: why,
})

/** The folders from the repository's root to `within` in it, each a level its agents read settings at, root first. */
const levelsOf = (root: string, inside: string | null | undefined): ReadonlyArray<readonly [string, string]> => {
  const parts = (inside ?? '').split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  return [
    ['', root] as const,
    ...parts.map((_, index) => [`${parts.slice(0, index + 1).join('/')}/`, join(root, ...parts.slice(0, index + 1))] as const),
  ]
}

const levelSettings = async (root: string, prefix: string, level: string): Promise<ReadonlyArray<RepositorySettingsFile | null>> => {
  const mcp = await readText(join(level, '.mcp.json'))
  const beside: Beside = { mcp: 'text' in mcp ? parsed(mcp.text)?.value : undefined }
  const files = await Promise.all(
    FILES.map(async ({ agent, file, parse, read }) => {
      const at = `${prefix}${file}`
      const content = await readText(join(level, ...file.split('/')))
      if ('absent' in content) return null
      if ('unread' in content) return unreadEntry(agent, at, content.unread)
      const value = parse(content.text)
      if (value === undefined) return unreadEntry(agent, at, `It couldn’t be read as ${file.endsWith('.toml') ? 'TOML' : 'JSON'}`)
      const found = read(value.value, beside)
      // What the settings start of `.mcp.json` counts with them: a change there asks again.
      return entryOf(root, level, agent, at, found)
    }),
  )
  const code = await Promise.all(
    CODE_FOLDERS.map(async ([folder, when]) => {
      const at = `${prefix}${folder}`
      let names: ReadonlyArray<string>
      try {
        names = await readdir(join(level, ...folder.split('/')))
      } catch (error) {
        return ABSENT.has(codeOf(error) ?? '')
          ? []
          : [unreadEntry('opencode', at, `Its files couldn’t be listed (${codeOf(error) ?? 'unknown'})`)]
      }
      return Promise.all(
        names
          .filter((name) => CODE_FILE.test(name))
          .toSorted()
          .map(async (name) => {
            const file = `${at}/${name}`
            const content = await readText(join(level, ...folder.split('/'), name))
            if ('absent' in content) return null
            if ('unread' in content) return unreadEntry('opencode', file, content.unread)
            return entryOf(root, level, 'opencode', file, [{ key: 'file', when, command: file, definition: file }], content.text)
          }),
      )
    }),
  )
  return [...files, ...code.flat()]
}

/**
 * What a repository's agent settings run, file by file, as they stand in `root` (its checkout, or a task's worktree of
 * it), at its root and at each folder down to `inside`, where a project of a folder in it starts its agents: each agent
 * reads them up from where it starts. Only the files that run something, and those there that couldn't be read, which
 * are never trusted. Reads off the thread.
 */
export const readRepositorySettings = async (root: string, inside?: string | null): Promise<ReadonlyArray<RepositorySettingsFile>> => {
  const levels = await Promise.all(levelsOf(root, inside).map(([prefix, level]) => levelSettings(root, prefix, level)))
  return levels.flat().filter((entry) => entry !== null)
}

/**
 * Which of `files` aren't trusted: those whose hash `trusted` doesn't hold for their file, never seen or changed since,
 * and any that couldn't be read.
 */
export const untrustedOf = (
  files: ReadonlyArray<RepositorySettingsFile>,
  trusted: ReadonlyArray<{ readonly file: string; readonly hash: string }>,
): ReadonlyArray<RepositorySettingsFile> =>
  files.filter((entry) => entry.unread !== undefined || !trusted.some((one) => one.file === entry.file && one.hash === entry.hash))
