import { readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { posix, win32 } from 'node:path'

import { type PermissionRequest, SECRET_PLACES } from '@althar/provider-adapters'

/*
 * The rules for agents' requests (ADR-013). What no project can change:
 * agents reach a code host only through Althar, and never read
 * credentials. Then the kinds of request the rules keep for the person:
 * pushes to the default branch, force pushes, pushes of every branch, tags
 * or patterns, deleting branches other than the task's, deploy and publish
 * commands, and writes outside the task's worktree; and what they can't
 * tell. A project's rules (Policies) say which of those ask and which are
 * never allowed, which commands it names, and what happens to the rest.
 *
 * Commands are read as a shell would split them, into commands and words, so
 * `cd x && git -C y push origin HEAD:refs/heads/main` is understood. Where
 * the rules can't tell where a push goes or where an edit writes, they ask.
 *
 * The agents' own sandboxes are the boundary for what commands write
 * (docs/architecture/03): Codex's and Claude Code's keep a command inside the
 * worktree, and a command that has to leave reaches Althar as a request.
 * Such a request is allowed unless its words name a place outside the
 * worktree, or it is on the list above; git's own writes for the task, such
 * as `git add` and `git commit`, are allowed, since a worktree's git data
 * lives in the main repository, outside the sandbox.
 */

export type Verdict =
  /** Allowed: by the project's allow rules where `rules` names them (ADR-018), else because nothing keeps it. */
  | { readonly verdict: 'allow'; readonly rules?: ReadonlyArray<AllowRule> }
  /**
   * It waits for the person: `held` where a kind on the always-ask list, or
   * a command the project asks about, keeps it for them, which no rule or
   * judge answers; otherwise because the rules can't tell what it does, or
   * the project asks about everything.
   */
  | { readonly verdict: 'ask'; readonly reason: string; readonly held: boolean }
  /** The coordinator judges it (ADR-019): what no rule answers, in a project that has the coordinator decide. */
  | { readonly verdict: 'judge'; readonly reason: string }
  | { readonly verdict: 'deny'; readonly reason: string }

/**
 * The kinds of request the rules keep for the person (ADR-013): each one a
 * project can have ask, refuse, or let through. Where the rules can't tell
 * what a request does, it asks whatever the project says, short of
 * allowing everything.
 */
export const RULES = ['default-branch', 'force-push', 'many-branches', 'delete-branch', 'deploy', 'outside'] as const
export type RuleId = (typeof RULES)[number]

/** What each kind is, in the words a refusal says it. */
const RULE_WORDS: Readonly<Record<RuleId, string>> = {
  'default-branch': 'pushing to the default branch',
  'force-push': 'force pushes',
  'many-branches': 'pushing every branch, tags, or a pattern of branches',
  'delete-branch': "deleting branches that aren't the task's",
  deploy: 'deploying and publishing',
  outside: "writing outside the task's worktree",
}

/**
 * Why the rules keep a request for the person, and which kind it is: one a
 * project names, or one they can't tell. `floor` marks what could lose work
 * or a secret (docs/plans/safety-pass.md): what is `irreversible`, and
 * besides it git touching the stash every checkout shares or throwing away
 * what it keeps to recover lost work, and reading a `.env` outside the task's
 * worktree. The coordinator never answers it; only Never, or a kind the
 * person always allows while everything isn't allowed, settles it otherwise.
 *
 * `irreversible` marks what can't be undone from the task (ADR-067): a force
 * push, a push to or a deletion of the default branch, deleting or moving by
 * force a branch that isn't the task's, git discarding work in another
 * checkout, deleting or moving away what's outside the task's worktree,
 * changing another checkout, and a push the rules can't read. It asks the
 * person even with everything allowed, where the rules read it as one of
 * those (`lastingOf`): what they can't tell goes ahead there.
 */
interface Kept {
  readonly reason: string
  readonly rule: RuleId | 'unclear'
  readonly floor?: boolean
  readonly irreversible?: boolean
  /** Found only reading it from a folder the rules can't tell, as the worst it could be: `cd "$DIR" && git reset --hard`. */
  readonly blind?: boolean
}

/** How firmly a kind is kept: `floor` past the coordinator, `irreversible` past allowing everything too. */
type Floor = 'floor' | 'irreversible'

const kept = (reason: string, rule: RuleId | 'unclear', floor?: Floor): Kept =>
  floor === undefined
    ? { reason, rule }
    : floor === 'floor'
      ? { reason, rule, floor: true }
      : { reason, rule, floor: true, irreversible: true }

/** The firmest of what kinds are kept: what a request standing for them all is. */
const floorOf = (kinds: ReadonlyArray<Kept>): Floor | undefined =>
  kinds.some((each) => each.irreversible === true) ? 'irreversible' : kinds.some((each) => each.floor === true) ? 'floor' : undefined

/**
 * A command the person named (ADR-013, ADR-018): asked about, refused, or
 * let through. By how it starts (`npm publish`, `terraform *`), or, where
 * `match` says so, as this exact line.
 */
export interface CommandRule {
  readonly pattern: string
  readonly decision: 'ask' | 'never' | 'allow'
  readonly match?: 'prefix' | 'exact' | undefined
}

/** What let a request through without asking (ADR-018): a kind the project always allows, or a command rule. */
export type AllowRule = { readonly kind: RuleId } | { readonly pattern: string; readonly match: 'prefix' | 'exact' }

/** A project's rules, as the rules read them (ADR-013, ADR-018, Policies). */
export interface ProjectRuleSet {
  /**
   * What happens to what no rule keeps: it is allowed (`rules`), it waits
   * for the person (`ask`), or the coordinator judges (`coordinator`);
   * or everything is allowed (`allow`), the
   * always-ask list with it, and only what is never allowed is refused.
   */
  readonly mode: 'rules' | 'coordinator' | 'ask' | 'allow'
  /** The kinds that ask the person. */
  readonly ask: ReadonlyArray<RuleId>
  /** The kinds refused outright, whoever would answer. */
  readonly never: ReadonlyArray<RuleId>
  /** The kinds let through without asking, short of what always asks or is never allowed. */
  readonly allow: ReadonlyArray<RuleId>
  /** Commands the person named: asked about, refused, or let through. */
  readonly commands: ReadonlyArray<CommandRule>
}

const exactly = (rule: CommandRule) => rule.match === 'exact'

/** A command rule as it reads in a sentence. */
const commandWords = (rule: CommandRule) => (exactly(rule) ? `exactly \`${rule.pattern}\`` : `commands starting \`${rule.pattern}\``)

/** An allow rule as it reads in a sentence: a kind's words, or a command rule's. */
export const sayAllowRule = (rule: AllowRule): string =>
  'kind' in rule ? RULE_WORDS[rule.kind] : commandWords({ pattern: rule.pattern, decision: 'allow', match: rule.match })

/** A project's rules in a few sentences, for an agent that plans work under them. */
export const sayRules = (rules: ProjectRuleSet): string => {
  const named = (decision: CommandRule['decision']) =>
    rules.commands.flatMap((command) => (command.decision === decision ? [commandWords(command)] : []))
  const asks = [...rules.ask.map((id) => RULE_WORDS[id]), ...named('ask')]
  const never = [...rules.never.map((id) => RULE_WORDS[id]), ...named('never')]
  const allowed = [...rules.allow.map((id) => RULE_WORDS[id]), ...named('allow')]
  return [
    rules.mode === 'coordinator'
      ? `The coordinator judges permission requests within these rules. Always ask the person: ${asks.length === 0 ? 'none' : asks.join('; ')}.`
      : rules.mode === 'ask'
        ? "Agents may read anything and change a task's own files; everything else waits for the person."
        : rules.mode === 'allow' || asks.length === 0
          ? 'Agents may do anything.'
          : `Agents may do anything but these, which wait for the person: ${asks.join('; ')}.`,
    ...(rules.mode === 'allow' || allowed.length === 0 ? [] : [`Allowed without asking: ${allowed.join('; ')}.`]),
    ...(never.length === 0 ? [] : [`Never allowed: ${never.join('; ')}.`]),
  ].join(' ')
}

/** The MVP's rules, a project's first: everything allowed but every kind above, which asks. */
export const MVP_RULES: ProjectRuleSet = { mode: 'rules', ask: RULES, never: [], allow: [], commands: [] }

export interface RuleContext {
  /** Where the agent works: the task's worktree, a folder in it, or the task's folder that holds its worktrees. */
  readonly worktree: string
  /** The task's worktrees, one per repository, where it may write; just `worktree` unless the task has several. */
  readonly worktrees?: ReadonlyArray<string>
  /** The branch pushes to which always ask. */
  readonly defaultBranch: string
  /** Every repository's default branch, where the task has several repositories. */
  readonly defaultBranches?: ReadonlyArray<string>
  /** The task's branch, which the agent may push to and delete. */
  readonly taskBranch?: string
  /** The branch checked out in the worktree now, where a push without a destination goes. */
  readonly currentBranch?: string
  /** Follows symlinks; the file system's own unless a test gives one. */
  readonly realPath?: (path: string) => string
  /** Folders anything may write to, such as the temp folder. */
  readonly scratch?: ReadonlyArray<string>
  /**
   * The folder `$TMPDIR`, `$TMP` and `$TEMP` name in the agent's commands,
   * where Althar knows it: its own, as its launch made it (`privateTemp`).
   * Other agents name a temp folder of their own choosing.
   */
  readonly temp?: string
  /** The system the agent works on, whose paths and commands it names: this computer's unless a test gives one. */
  readonly platform?: NodeJS.Platform
  /** The person's home folder: this computer's unless a test gives one. */
  readonly home?: string
  /** The project's rules; the MVP's without them. */
  readonly project?: ProjectRuleSet
}

/** How the system an agent works on reads a path: its path functions, and the person's home folder. */
interface System {
  readonly paths: typeof posix
  readonly home: string
  readonly windows: boolean
  /** Its files' names are the same in any case, as on Windows and macOS: `~/.SSH` is `~/.ssh`. */
  readonly caseless: boolean
}

const systemOf = (context: Pick<RuleContext, 'platform' | 'home'> = {}): System => {
  const platform = context.platform ?? process.platform
  const windows = platform === 'win32'
  return { paths: windows ? win32 : posix, home: context.home ?? homedir(), windows, caseless: windows || platform === 'darwin' }
}

const ALLOW: Verdict = { verdict: 'allow' }
const ask = (reason: string, held: boolean): Verdict => ({ verdict: 'ask', reason, held })

// ---- Code hosts --------------------------------------------------------------

/*
 * Agents reach code hosts only through Althar (ADR-011): Althar pushes
 * and opens the task's pull request, and the lead reads and answers on it with
 * Althar's tools. So `gh` and `glab` may only look; anything else is
 * refused with what to do instead.
 *
 * The boundary is the agent's environment, not these words: agents run with
 * `gh` and `glab` signed out, git's credential helpers reset, and no SSH agent
 * (Config.ts), and Althar's own sign-ins are sealed where only the app can
 * open them. What is left within a shell's reach, the keychain through
 * `security` and git's helpers called directly, is refused here, for every
 * role. Files the person keeps credentials in, under their home folder, are
 * still readable by an agent that goes looking; only a sandbox closes that
 * (docs/open-questions.md).
 */

const CREDENTIALS_REFUSED =
  "Agents don't read the person's credentials or the keychain. Althar reaches the code host for the task; tell the person what's needed."

/** Why an agent may not run a command that reads credentials: the keychain's `security`, or git's credential helpers. */
const credentialReason = (words: ReadonlyArray<string>): string | undefined => {
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  if (program === 'security' || program.startsWith('git-credential')) return CREDENTIALS_REFUSED
  if (program !== 'git') return undefined
  // Git's own options before its command, and their values: `git -C dir -c k=v credential fill`.
  let index = 1
  while ((words[index] ?? '').startsWith('-'))
    index += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'].includes(words[index] ?? '') ? 2 : 1
  return (words[index] ?? '').startsWith('credential') ? CREDENTIALS_REFUSED : undefined
}

/*
 * Reading credentials is what no project can change (ADR-013), and the
 * keychain and git's helpers aren't all of them: people keep keys, tokens and
 * sign-ins in plain files under their home folder too. A request that names
 * one, as a path it reads or writes or as a word of a command, is refused for
 * every role, whatever the project allows. This holds only for what reaches
 * Althar, and only for what a request names: a command that finds such a file
 * itself (`grep -r token ~`) isn't seen, and a command an agent's sandbox runs
 * without asking never reaches Althar (docs/plans/safety-pass.md).
 */

/** What of `~/.ssh` holds no secret: public keys, the hosts it knows, and its config. */
const SSH_PUBLIC = /^\.ssh\/([^/]*\.pub|known_hosts(\.old)?|config|authorized_keys)$/

const SECRETS_REFUSED =
  "Agents don't read the person's keys, tokens or sign-ins, such as ~/.ssh, ~/.aws or ~/.npmrc. Tell the person what's needed."

/** Whether a place, as a path from the home folder, is where a secret is kept. */
const secretFromHome = (fromHome: string, { paths, caseless }: System): boolean => {
  if (fromHome === '' || fromHome === '..' || fromHome.startsWith(`..${paths.sep}`) || paths.isAbsolute(fromHome)) return false
  const fold = (path: string) => (caseless ? path.toLowerCase() : path)
  const path = fold(fromHome.split(paths.sep).join('/'))
  return !SSH_PUBLIC.test(path) && SECRET_PLACES.map(fold).some((place) => path === place || path.startsWith(`${place}/`))
}

/** The home folder, as a command may name it at the start of a path: in a POSIX shell, PowerShell or cmd. */
const HOME_WORD = /^(~|\$HOME|\$\{HOME\}|\$env:(USERPROFILE|HOME)|%USERPROFILE%)(?=$|[/\\])/i

/** The real path of a place that may not exist yet: its nearest existing folder, with symlinks followed, and the rest. */
const realFrom =
  (follow: (path: string) => string, paths: typeof posix) =>
  (path: string): string => {
    let existing = path
    const rest: Array<string> = []
    for (;;) {
      try {
        return paths.resolve(follow(existing), ...rest.toReversed())
      } catch {
        const parent = paths.dirname(existing)
        if (parent === existing) return path
        rest.push(existing.slice(parent.length).replace(/^[/\\]/, ''))
        existing = parent
      }
    }
  }

/** Whether a path, named from a folder, is where a secret is kept: as written, and with symlinks followed, to a file not there yet too. */
const secretPath = (path: string, cwd: string, system: System, follow: (path: string) => string = realpathSync): boolean => {
  const { paths, home, caseless } = system
  const full = paths.resolve(cwd, path.replace(HOME_WORD, home))
  const real = realFrom(follow, paths)
  const fromHome = (from: string, to: string) =>
    caseless ? paths.relative(from.toLowerCase(), to.toLowerCase()) : paths.relative(from, to)
  return secretFromHome(fromHome(home, full), system) || secretFromHome(fromHome(real(home), real(full)), system)
}

/** The paths a command's word may name: itself, and what follows an `@` or an `=` (`curl -d @file`, `--key-file=path`). */
const pathsInWord = (word: string): ReadonlyArray<string> =>
  [...new Set([word, word.slice(word.lastIndexOf('@') + 1), word.slice(word.indexOf('=') + 1)])].filter(
    (part) =>
      part !== '' &&
      (HOME_WORD.test(part) || part.startsWith('/') || part.startsWith('.') || /[/\\]/.test(part) || /^[A-Za-z]:/.test(part)),
  )

/** The home folder named anywhere in a line, quoted or inside `$(…)` too, with the path that follows it. */
const homeMentions = (text: string, { home }: System): ReadonlyArray<string> => {
  // A home folder at the root would match every absolute path; then only `~` and `$HOME` name it. Windows's either way round.
  const named = home === '/' ? '' : `|${literal(home)}|${literal(home.replaceAll('\\', '/'))}`
  const mentions = new RegExp(
    `(?:~|\\$HOME|\\$\\{HOME\\}|\\$env:(?:USERPROFILE|HOME)|%USERPROFILE%${named})([/\\\\][^\\s'"\`;|&<>()]*)`,
    'gi',
  )
  return [...text.matchAll(mentions)].map((match) => (match[1] ?? '').replace(/^[/\\]/, ''))
}

/**
 * Why a command line may not run because it names where the person keeps a
 * secret, or nothing. Each command's words are read from the folder it runs
 * in, after any `cd`; where that isn't known (`cwd` undefined), only paths
 * named from the home folder or the root count. A line read whole too, so a
 * path inside quotes or `$(…)` counts.
 */
const secretCommandReason = (text: string, cwd?: string, system: System = systemOf()): string | undefined => {
  const { paths, home } = system
  if (homeMentions(text, system).some((fromHome) => secretFromHome(fromHome.split(/[/\\]/).join(paths.sep), system))) return SECRETS_REFUSED
  const following: Following = {
    resolve: (from, path) => {
      const target = path.replace(HOME_WORD, home)
      return paths.isAbsolute(target) ? paths.resolve(target) : from === undefined ? undefined : paths.resolve(from, target)
    },
    paths,
    folder: isFolder,
    unknown: paths.parse(home).root,
    unsettled: (word) => unsettled(word),
  }
  // There a file's bare name is a secret's (`cd / && cd home/alice/.ssh && cat id_ed25519`), as `cd ~/.ssh` says.
  const inSecret = (folders: ReadonlyArray<Folder>) => folders.some(({ at }) => at !== undefined && secretPath(at, paths.sep, system))
  // Where Althar can't read a `cd`, a path could be from anywhere, the home folder too.
  const names = ({ at, blind }: Folder, path: string) =>
    ((at !== undefined || HOME_WORD.test(path) || paths.isAbsolute(path)) && secretPath(path, at ?? paths.sep, system)) ||
    (blind && secretPath(path, home, system))
  let refused = false
  for (const line of lineReadings(text, system)) {
    const last = walkFolders(line, cwd, following, (written, folders) => {
      if (!refused && inSecret(folders)) refused = true
      for (const words of refused ? [] : readings(written))
        for (const word of words.slice(1))
          for (const path of pathsInWord(word)) if (folders.some((folder) => names(folder, path))) refused = true
    })
    if (refused || inSecret(last)) return SECRETS_REFUSED
  }
  return undefined
}

/** Whether a path is a folder that's there. */
const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Why a request may not go ahead because it reads or writes where the person keeps a secret, or nothing. */
const secretReason = (request: PermissionRequest, cwd?: string, system: System = systemOf()): string | undefined => {
  const command = request.kind === 'execute' || request.kind === 'other' ? (commandIn(request.rawInput) ?? request.title) : undefined
  if (command !== undefined && secretCommandReason(command, cwd, system) !== undefined) return SECRETS_REFUSED
  const { paths } = system
  return pathsOf(request).some(
    (path) => (cwd !== undefined || HOME_WORD.test(path) || paths.isAbsolute(path)) && secretPath(path, cwd ?? paths.sep, system),
  )
    ? SECRETS_REFUSED
    : undefined
}

/** A `.env` file, which holds a project's secrets; not one that only shows what goes in it (`.env.example`). */
const envFile = (path: string) => {
  const name = path.split(/[/\\]/).at(-1) ?? ''
  return /^\.env(\.[\w.-]+)?$/.test(name) && !/\.(example|sample|template|dist|defaults?)$/.test(name)
}

/** A `.env` file outside the task's worktree, which the person keeps: it asks, whoever else would answer. */
const envKept = (path: string) =>
  kept(`Reading ${path}, outside the task's worktree, always asks: a .env file holds the person's secrets.`, 'outside', 'floor')

/** The Flatpak grants the app a broad host bridge; agents must not invoke it directly. */
const deviceBridgeReason = (words: ReadonlyArray<string>): string | undefined =>
  (words[0] ?? '').split('/').at(-1) === 'flatpak-spawn'
    ? 'Agents do not run commands on the device through Flatpak; Althar uses that bridge only for commands it prepares.'
    : undefined

/** What `gh` and `glab` may do: their read-only commands, by command and subcommand. */
const HOST_LOOKS: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['view', 'list', 'diff', 'checks', 'status']),
  mr: new Set(['view', 'list', 'diff']),
  issue: new Set(['view', 'list', 'status']),
  run: new Set(['view', 'list', 'watch']),
  ci: new Set(['view', 'list', 'status', 'trace']),
  workflow: new Set(['view', 'list']),
  repo: new Set(['view', 'list']),
  release: new Set(['view', 'list']),
  search: new Set(['repos', 'issues', 'prs', 'code', 'commits']),
}

const HOST_WRITE_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input', '-d', '--data'])

/** Why an agent may not run a `gh` or `glab` command, or nothing when it only looks. */
const hostReason = (words: ReadonlyArray<string>): string | undefined => {
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  if (program !== 'gh' && program !== 'glab') return undefined
  const [command, subcommand] = words.slice(1).filter((word) => !word.startsWith('-'))
  if (command === undefined || command === 'help' || command === 'version' || words.includes('--help') || words.includes('--version'))
    return undefined
  if (command === 'api') {
    const method =
      words
        .map((word, index) =>
          words[index - 1] === '-X' || words[index - 1] === '--method'
            ? word
            : word.startsWith('--method=')
              ? word.slice('--method='.length)
              : /^-X[A-Za-z]+$/.test(word)
                ? word.slice(2)
                : undefined,
        )
        .find((found) => found !== undefined) ?? 'GET'
    if (method.toUpperCase() === 'GET' && !words.some((word) => HOST_WRITE_FLAGS.has(word.split('=')[0] ?? ''))) return undefined
    return "Agents don't change things on the code host themselves; Althar does that for the task. Tell the person what's needed."
  }
  if (HOST_LOOKS[command]?.has(subcommand ?? '') === true) return undefined
  if ((command === 'pr' || command === 'mr') && subcommand === 'merge')
    return "Merging is the person's to do: they accept the change in Althar, or on the host."
  if ((command === 'pr' || command === 'mr') && (subcommand === 'comment' || subcommand === 'review' || subcommand === 'note'))
    return "Answer on the task's pull request with Althar's reply_on_pull_request tool."
  if (command === 'pr' || command === 'mr')
    return "Althar opens the task's pull request itself, and the person pushes what you commit to it once they've looked; only a merge Althar asked you to make to resolve a conflict, Althar pushes itself. Commit, then ask them to push it with push_to_pull_request; read it with read_pull_request."
  if (command === 'issue')
    return 'Althar changes issues through its own tools, not gh or glab. Read one with read_issue; on the issue this task came from, comment with comment_on_issue and propose a change with change_issue; for any other, tell the person what it needs.'
  if (command === 'auth') return "Agents run without the person's sign-in to the code host; Althar's tools reach it for the task."
  return "Agents don't change things on the code host themselves; Althar does that for the task. Tell the person what's needed."
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

/** The command an execute request runs: from its raw input where the agent gives one, else its title. */
export const commandOf = (request: PermissionRequest): string => commandIn(request.rawInput) ?? request.title

/** The command line in a tool call's raw input, as a shell would read it, when it names one. */
export const commandIn = (rawInput: unknown): string | undefined => {
  const command = field(rawInput, 'command') ?? field(rawInput, 'cmd')
  if (typeof command === 'string') return command
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) return command.map(quoteWord).join(' ')
  return undefined
}

const quoteWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'old_path', 'new_path', 'destination', 'source', 'target']

/** How much of a command the store keeps. The rules read all of it, in memory. */
const COMMAND_KEPT = 4_000

/**
 * What of a tool call's input the store keeps (docs/architecture/07: no file
 * contents, and so no secrets, in the record): the command, the paths, the
 * host a network request is for, and which files a patch touches, without
 * what it writes. What is left out is
 * named, so the record says it was cut. The rules decide on the whole input;
 * this is only what is written down.
 */
export const essentials = (
  rawInput: unknown,
): { readonly input: Readonly<Record<string, unknown>>; readonly cut: ReadonlyArray<string> } => {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput))
    return { input: {}, cut: rawInput === undefined || rawInput === null ? [] : ['input'] }
  const input: Record<string, unknown> = {}
  const cut: Array<string> = []
  for (const [key, value] of Object.entries(rawInput)) {
    if (key === 'command' || key === 'cmd') {
      const whole = typeof value === 'string' ? value : Array.isArray(value) ? value : undefined
      if (typeof whole === 'string' && whole.length > COMMAND_KEPT) {
        input[key] = `${whole.slice(0, COMMAND_KEPT)}…`
        cut.push(`${key} after ${COMMAND_KEPT} characters`)
      } else if (whole !== undefined) input[key] = whole
      else cut.push(key)
    } else if (PATH_KEYS.includes(key) && typeof value === 'string') input[key] = value
    // The host a network request is for (Claude Code's sandbox asks by it): a name, never a secret.
    else if (key === 'host' && typeof value === 'string') input.host = value.slice(0, 253)
    else if (key === 'changes' && typeof value === 'object' && value !== null) {
      // A patch's files, without their contents.
      input.changes = Array.isArray(value)
        ? value.map((change) => ({ path: field(change, 'path') }))
        : Object.fromEntries(Object.keys(value).map((path) => [path, {}]))
      cut.push('changes (contents)')
    } else cut.push(key)
  }
  return { input, cut }
}

/** Every path an action names: the agent's locations, path fields of its raw input, and the files of a patch (Codex's `changes`). */
export const pathsOf = (request: PermissionRequest): ReadonlyArray<string> => {
  const changes = field(request.rawInput, 'changes')
  const patched = typeof changes === 'object' && changes !== null && !Array.isArray(changes) ? Object.keys(changes) : []
  const listed = Array.isArray(changes) ? changes.map((change) => field(change, 'path')) : []
  return [
    ...new Set(
      [...request.paths, ...PATH_KEYS.map((key) => field(request.rawInput, key)), ...patched, ...listed].filter(
        (value): value is string => typeof value === 'string' && value !== '',
      ),
    ),
  ]
}

// ---- Reading commands ------------------------------------------------------

export interface Parsed {
  /** Each command, as its words, in the order the shell would run them. */
  readonly commands: ReadonlyArray<ReadonlyArray<string>>
  /** The text has parts the shell works out only when it runs: `$(…)`, backticks, `eval`. */
  readonly opaque: boolean
  /** For each command, the subshells it starts before it and ends after it, where a `cd` holds only inside. */
  readonly scopes?: ReadonlyArray<Scope>
}

/**
 * How a command runs: the subshells it starts and ends (`(cd x`, `ls)`, a
 * script handed to a shell, a side of a pipe), and whether it runs at all.
 * One that `keeps` may keep its `cd` or not: zsh runs a pipe's last side in
 * the shell itself, bash in a subshell.
 */
interface Scope {
  readonly opens: number
  readonly closes: number
  readonly keeps?: boolean
  /** It runs only where the one before succeeded (`&&`) or failed (`||`). */
  readonly joined?: '&&' | '||'
  /** It's inside an `if`, a loop, a `case` or a function: it may never run. */
  readonly maybe?: boolean
  /** It's inside a loop or a function: it may run many times. */
  readonly repeats?: boolean
  /** It's inside a function, which may run whenever it's called, later in the line. */
  readonly called?: boolean
}

const NO_SCOPE: Scope = { opens: 0, closes: 0 }

/** The subshells a command as written starts and ends with its parentheses: `( cd x`, `then (rm`, `ls )`, `(ls)`. */
const scopeOf = (words: ReadonlyArray<string>): Scope => {
  let opens = 0
  for (const word of words) {
    if (SHELL_KEYWORDS.includes(word)) continue
    const leading = /^\(*/.exec(word)?.[0].length ?? 0
    opens += leading
    if (leading === 0 || leading < word.length) break
  }
  let closes = 0
  for (const word of [...words].reverse()) {
    const trailing = /\)*$/.exec(word)?.[0].length ?? 0
    // `"$(pwd))"`: a parenthesis the word opens itself takes one of its own.
    const own =
      word
        .slice(0, word.length - trailing)
        .replace(/^\(+/, '')
        .split('(').length - 1
    closes += Math.max(0, trailing - own)
    if (trailing === 0 || trailing < word.length) break
  }
  return { opens, closes }
}

/** Scopes for commands run inside one more of them, with a command's own around them all: what runs them runs only as it does. */
const wrapped = (scopes: ReadonlyArray<Scope>, own: Scope, extra: number): Array<Scope> =>
  scopes.map((scope, index) => ({
    ...scope,
    opens: scope.opens + (index === 0 ? own.opens + extra : 0),
    closes: scope.closes + (index === scopes.length - 1 ? own.closes + extra : 0),
    ...(scope.keeps === true || (index === scopes.length - 1 && own.keeps === true) ? { keeps: true } : {}),
    ...(index === 0 && own.joined !== undefined ? { joined: own.joined } : {}),
    ...(own.maybe === true ? { maybe: true } : {}),
    ...(own.repeats === true ? { repeats: true } : {}),
    ...(own.called === true ? { called: true } : {}),
  }))

/** What opens and closes a compound command, which may run what's in it never, once or many times. */
const OPENS = ['if', 'while', 'until', 'for', 'select', 'case']
const CLOSES = ['fi', 'done', 'esac', '}']
const LOOPS = ['while', 'until', 'for', 'select', 'function']

/** Where a command stands among the compound commands of its line. */
interface Block {
  /** Where what it runs starts, past a function's name or a `case`'s pattern, which aren't commands: `f() { rm …`, `a) rm …`. */
  readonly start: number
  readonly maybe: boolean
  readonly repeats: boolean
  readonly called: boolean
  /** It's a part of a `case`'s pattern, `a|b)`, whose `|` is no pipe. */
  readonly pattern: boolean
}

/** Each command's place among the `if`s, loops, `case`s, groups and functions of its line, by the words that open and close them. */
const blocksOf = (commands: ReadonlyArray<ReadonlyArray<string>>, ends: ReadonlyArray<string>): Array<Block> => {
  const open: Array<string> = []
  // A `case`'s pattern comes after its `in`, after `;;`, and after a `|` in a pattern.
  let patternNext = false
  return commands.map((words, at) => {
    let index = 0
    let start = 0
    let pattern = false
    let atPattern = patternNext || [';;', ';;&'].includes(ends[at - 1] ?? '')
    patternNext = false
    // After a function's name, its `{` is its body's.
    let named = false
    while (index < words.length) {
      const word = (words[index] ?? '').replace(/^\(+/, '')
      if (atPattern && open.at(-1) === 'case' && word.replace(/\)+$/, '') !== 'esac') {
        atPattern = false
        const taken = word.endsWith(')') ? 1 : words[index + 1] === ')' ? 2 : 0
        if (taken > 0) {
          index += taken
          start = index
          continue
        }
        if (ends[at] === '|') {
          pattern = true
          patternNext = true
          break
        }
      }
      if (CLOSES.includes(word.replace(/\)+$/, ''))) {
        open.pop()
        index += 1
        continue
      }
      if (OPENS.includes(word)) {
        open.push(word)
        index += 1
        if (word === 'case') {
          // `case x in`, then a pattern.
          index += 2
          start = index
          atPattern = true
          continue
        }
        if (word === 'for' || word === 'select') break
        continue
      }
      const head =
        word === 'function' ? 2 + (words[index + 2] === '()' ? 1 : 0) : /^[\w.:-]+\(\)$/.test(word) ? 1 : words[index + 1] === '()' ? 2 : 0
      if (head > 0) {
        open.push('function')
        index += head
        start = index
        named = true
        continue
      }
      if (word === '{') {
        if (!named) open.push('{')
        named = false
        index += 1
        continue
      }
      if (SHELL_KEYWORDS.includes(word)) {
        index += 1
        continue
      }
      break
    }
    // `case x in` at the end of a line: the pattern is on the next.
    if (atPattern) patternNext = true
    return {
      start,
      maybe: open.some((each) => each !== '{'),
      repeats: open.some((each) => LOOPS.includes(each)),
      called: open.includes('function'),
      pattern,
    }
  })
}

const SEPARATORS = [';;&', ';;', '&&', '||', ';', '|', '&', '\n']
const REDIRECTS = ['>>', '&>', '2>', '>', '<']

/**
 * Splits a command line into commands and words, as a POSIX shell would for plain words, quotes and escapes. Each
 * command's redirects come after its other words (`redirectsLast`), so its first word is what it runs.
 */
export const parseCommandLine = (text: string): Parsed => {
  const { commands: written, operators: operating, opaque, ends } = splitCommandLine(text)
  const blocks = blocksOf(written, ends)
  // Without a function's name or a `case`'s pattern, keeping the parentheses before them: `(case x in a) rm …`.
  const commands = written.map((words, index) => {
    const start = blocks[index]?.start ?? 0
    if (start === 0 || start >= words.length) return { words, operators: operating[index] ?? new Set<number>() }
    const parens = scopeOf(words.slice(0, start)).opens
    const shift = (parens > 0 ? 1 : 0) - start
    return {
      words: [...(parens > 0 ? ['('.repeat(parens)] : []), ...words.slice(start)],
      operators: new Set([...(operating[index] ?? [])].filter((at) => at >= start).map((at) => at + shift)),
    }
  })
  const scopes = commands.map(({ words }, index): Scope => {
    const block = blocks[index]
    const before = ends[index - 1]
    const how: Scope = {
      // A line of only a `case`'s head or a pattern (`b)`) closes no subshell.
      ...(words === written[index] && (block?.start ?? 0) > 0 ? { opens: scopeOf(words).opens, closes: 0 } : scopeOf(words)),
      ...(before === '&&' || before === '||' ? { joined: before } : {}),
      ...(block?.maybe === true ? { maybe: true } : {}),
      ...(block?.repeats === true ? { repeats: true } : {}),
      ...(block?.called === true ? { called: true } : {}),
    }
    // Every side of a pipe but the last, and what runs in the background, runs in a subshell; zsh runs a pipe's last side in its own shell.
    if ((ends[index] === '|' && block?.pattern !== true) || ends[index] === '&')
      return { ...how, opens: how.opens + 1, closes: how.closes + 1 }
    if (before === '|' && blocks[index - 1]?.pattern !== true) return { ...how, opens: how.opens + 1, closes: how.closes + 1, keeps: true }
    return how
  })
  return expandShells(
    commands.map(({ words, operators }) => redirectsLast(words, operators).words),
    opaque,
    scopes,
  )
}

/**
 * A command's words with its redirects after the rest, as the shell reads them wherever they stand: `> /dev/null git
 * push` and `git > /dev/null push` both run `git push`, so every rule that reads what a command runs from its first
 * words reads it there. Only what the shell takes for a redirect moves, with the file or stream it names (`2>&1`), not
 * a quoted `'>'`. `at` says where each word went.
 */
const redirectsLast = (words: ReadonlyArray<string>, operators: ReadonlySet<number>) => {
  const rest: Array<number> = []
  const moved: Array<number> = []
  for (let index = 0; index < words.length; index += 1) {
    if (!operators.has(index) || !REDIRECTS.includes(words[index] ?? '')) {
      rest.push(index)
      continue
    }
    moved.push(index)
    // What it reads or writes: a stream it names (`&1`), else the next word, unless that is a redirect of its own (`<<`).
    const next = index + 1
    if (next < words.length && (!operators.has(next) || (words[next] ?? '').startsWith('&'))) {
      moved.push(next)
      index = next
    }
  }
  const order = [...rest, ...moved]
  return { words: order.map((from) => words[from] ?? ''), at: new Map(order.map((from, to) => [from, to])) }
}

/**
 * Whether the expansion at a `$` can set a variable or work out arithmetic,
 * which can: `$[…]`, `${…}` beyond a plain name (`${X:=.}`, `${a[X=1]}`,
 * zsh's `${(e)X}`), or zsh's subscript `$a[…]`. `$X` and `${X}` only read.
 */
const evaluates = (text: string, at: number) => {
  const rest = text.slice(at + 1)
  if (rest.startsWith('[')) return true
  if (rest.startsWith('{')) return !/^\{[A-Za-z_][A-Za-z0-9_]*\}/.test(rest)
  return /^[#=~^+]*[A-Za-z_][A-Za-z0-9_]*\[/.test(rest)
}

/** Programs that take what they read as text, never as a script they run (and none of them runs a program of their own from it). */
const readsTextOnly = new Set(['cat', 'tee', 'head', 'tail', 'sort', 'uniq', 'wc', 'tr', 'cut', 'grep', 'jq', 'diff', 'base64'])

/**
 * Programs with subcommands, and the built-in ones that take text: a configured alias (`git -calias.run='!sh' run`) can
 * run anything but can never shadow a built-in, so only these are text. Anything else, or an option before the
 * subcommand, is not known to be.
 */
const textSubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set(['commit', 'tag', 'notes', 'merge', 'stash', 'am', 'apply', 'commit-tree', 'hash-object', 'mktag']),
  gh: new Set(['pr', 'issue', 'release', 'gist', 'api', 'discussion']),
  glab: new Set(['mr', 'issue', 'release', 'api']),
}

/** Variables that change which program, or which configuration, a later command runs with. */
const changesWhatRuns = /^(?:PATH|IFS|ENV|BASH_ENV|BASH_FUNC_.*|SHELL|LD_.*|DYLD_.*|GIT_.*|GH_.*|GLAB_.*|XDG_CONFIG_HOME|HOME)$/

/** Builtins that redefine, or may redefine, what a name runs for the commands after them. */
const redefinesNames = new Set([
  'alias',
  'function',
  'export',
  'declare',
  'typeset',
  'readonly',
  'unalias',
  'hash',
  'set',
  'shopt',
  'enable',
  'source',
  '.',
  'eval',
  'exec',
])

const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/

/** Whether a command (as words) changes what a name runs afterwards, or what it runs with: a variable such as PATH, or a builtin that defines names. */
const changesNames = (words: ReadonlyArray<string>): boolean => {
  const at = words.findIndex((word) => !assignment.test(word))
  return (
    words.slice(0, at === -1 ? words.length : at).some((word) => changesWhatRuns.test(assignment.exec(word)?.[1] ?? '')) ||
    (at !== -1 && redefinesNames.has(words[at] ?? ''))
  )
}

/** Whether a command's input is text to it: nothing to run, or a bare name from the list, or a built-in subcommand that takes text. */
const takesText = (words: ReadonlyArray<string>): boolean => {
  if (changesNames(words)) return false
  const at = words.findIndex((word) => !assignment.test(word))
  if (at === -1) return true
  const name = words[at] ?? ''
  const subcommands = textSubcommands[name]
  return subcommands === undefined ? readsTextOnly.has(name) : subcommands.has(words[at + 1] ?? '')
}

/**
 * A command line without the bodies of its quoted heredocs (`<<'EOF'`,
 * `<<"EOF"`, `<<-'EOF'`, `<<\EOF`): the shell takes that text literally, so it
 * runs nothing, whatever backticks or words like `push` it holds. A body stays
 * wherever it could be more than text: an unquoted heredoc's (the shell expands
 * `$(…)` and backticks in it), one that is never closed, and one read by any
 * command not known to take only text, anywhere in its pipeline (`sh <<'EOF'`,
 * `cat <<'EOF' | sh`, a function or script, a continued line): there the rules
 * judge it as they would have, as a command. The operator and the line it is on
 * stay; the body and its closing line go. Comments are skipped, as `# <<'EOF'`
 * opens nothing. `reads` says which commands leave a body unread as commands:
 * those that take only text, unless the caller says more.
 */
export const withoutQuotedHeredocs = (text: string, reads: (words: ReadonlyArray<string>) => boolean = takesText): string => {
  if (!text.includes('<<')) return text
  /** The commands of a pipeline, and of what is grouped with it in parentheses: the readers a heredoc's body can reach. */
  interface Group {
    readonly commands: Array<Array<string>>
  }
  interface Heredoc {
    readonly end: string
    readonly tabs: boolean
    readonly quoted: boolean
    readonly group: Group
    /** An earlier command defined a function or alias or changed PATH or the like, so a bare name may not be the program it seems. */
    readonly shadowed: boolean
  }
  /** A body and its closing line, dropped at the end if its heredoc is quoted and only text readers are in its group. */
  interface Held {
    readonly text: string
    readonly heredoc: Heredoc
    readonly closed: boolean
  }
  const chunks: Array<string | Held> = []
  let out = ''
  let pending: Array<Heredoc> = []
  let group: Group = { commands: [] }
  let command: Array<string> = []
  let word = ''
  let inWord = false
  /** Parentheses open outside quotes: what is in them is grouped with whatever they are redirected to. */
  let depth = 0
  /** A `|` ended the last command, so a newline goes on with the same pipeline. */
  let piped = false
  /** Some command so far may have changed what a name runs. */
  let shadowed = false
  const endWord = () => {
    if (inWord) {
      command.push(word)
      piped = false
    }
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    group.commands.push(command)
    if (changesNames(command)) shadowed = true
    command = []
  }
  const endGroup = () => {
    endCommand()
    if (depth === 0) group = { commands: [] }
  }
  let quote = ''
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    const before = text[index - 1] ?? ''
    if (quote !== '') {
      out += char
      if (char === '\\' && quote === '"' && index + 1 < text.length) {
        out += text[++index]
        word += text[index]
      } else if (char === quote) quote = ''
      else word += char
      index++
      continue
    }
    if (char === '\\') {
      out += char + (text[index + 1] ?? '')
      // A backslash before a newline joins the lines: the word goes on, and so does the command.
      if (text[index + 1] !== '\n') {
        word += text[index + 1] ?? ''
        inWord = true
      }
      index += 2
      continue
    }
    if (char === '#' && (index === 0 || /[\s;&|(]/.test(before))) {
      const stop = text.indexOf('\n', index)
      const end = stop === -1 ? text.length : stop
      out += text.slice(index, end)
      index = end
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      inWord = true
      out += char
      index++
      continue
    }
    if (text.startsWith('<<<', index)) {
      endWord()
      out += '<<<'
      index += 3
      continue
    }
    if (char === '<' && text.startsWith('<<', index) && text[index + 2] !== '(') {
      const opener = /^<<(-?)[ \t]*((?:[^\s;&|<>()'"\\]|'[^']*'|"[^"]*"|\\.)+)/.exec(text.slice(index))
      if (opener !== null) {
        endWord()
        const written = opener[2] ?? ''
        pending.push({
          end: written.replace(/'([^']*)'|"([^"]*)"|\\(.)/g, '$1$2$3'),
          tabs: opener[1] === '-',
          quoted: /['"\\]/.test(written),
          group,
          shadowed,
        })
        out += opener[0]
        index += opener[0].length
        continue
      }
    }
    out += char
    index++
    if (char === ' ' || char === '\t') endWord()
    else if (char === ';') endGroup()
    else if (char === '&') {
      // `2>&1`, `>&2` and `&>` are redirects; `&&` and a lone `&` end a command list.
      if (before === '>' || before === '<' || text[index] === '>') endWord()
      else {
        if (text[index] === '&') out += text[index++]
        endGroup()
      }
    } else if (char === '|') {
      if (before === '>') endWord()
      else if (text[index] === '|') {
        out += text[index++]
        endGroup()
      } else {
        if (text[index] === '&') out += text[index++]
        endCommand()
        piped = true
      }
    } else if (char === '(') {
      // A word right before `(` that is not `$(` or `<(` is a function being defined (`cat() { sh; }`).
      if (inWord && !word.endsWith('$') && command.length === 0) shadowed = true
      if (!inWord && command.length === 1 && text.slice(index).trimStart().startsWith(')')) shadowed = true
      endCommand()
      depth++
    } else if (char === ')') {
      endCommand()
      depth = Math.max(0, depth - 1)
    } else if (char === '<' || char === '>') endWord()
    else if (char === '\n') {
      if (piped) endCommand()
      else endGroup()
    } else {
      word += char
      inWord = true
    }
    if (char === '\n' && pending.length > 0) {
      for (const heredoc of pending) {
        // Up to and including the line that closes it, or the end of the text where nothing does.
        const from = index
        let body = ''
        let closing = ''
        let closed = false
        while (index < text.length) {
          const stop = text.indexOf('\n', index)
          const line = text.slice(index, stop === -1 ? text.length : stop)
          index = stop === -1 ? text.length : stop + 1
          if ((heredoc.tabs ? line.replace(/^\t+/, '') : line) === heredoc.end) {
            closing = `${line}\n`
            closed = true
            break
          }
          body += `${line}\n`
        }
        chunks.push(out)
        out = ''
        chunks.push({ text: closed ? `${body}${closing}` : text.slice(from), heredoc, closed })
      }
      pending = []
    }
  }
  endCommand()
  chunks.push(out)
  return chunks
    .map((chunk) =>
      typeof chunk === 'string' ||
      !chunk.closed ||
      !chunk.heredoc.quoted ||
      chunk.heredoc.shadowed ||
      !chunk.heredoc.group.commands.every(reads)
        ? typeof chunk === 'string'
          ? chunk
          : chunk.text
        : '',
    )
    .join('')
}

/** Interpreters that read a script in their own language, not the shell's: `python3 - <<'EOF'`. */
const SCRIPT_LANGUAGES = /^(python[\d.]*|node|ruby|perl|php|bun|deno)$/

/**
 * Whether a command takes a heredoc's body as text or as a script in a
 * language other than the shell's, whose words aren't commands: `python3 -`,
 * `node`. What such a script does the rules can't read either way.
 */
const takesScript = (words: ReadonlyArray<string>): boolean => {
  if (takesText(words)) return true
  if (changesNames(words)) return false
  const program = words.find((word) => !assignment.test(word)) ?? ''
  return SCRIPT_LANGUAGES.test(program.slice(program.lastIndexOf('/') + 1))
}

/** A command line's commands as written, with the separator that ends each ('' for the last). */
const splitCommandLine = (source: string) => {
  const text = withoutQuotedHeredocs(source)
  const commands: Array<Array<string>> = []
  const ends: Array<string> = []
  /** For each command, which of its words are redirect operators, not arguments that look like them (`echo '>'`). */
  const operators: Array<ReadonlySet<number>> = []
  /** For each command, which of its words the shell expands, outside quotes: a glob, braces, a variable (`*.ts`, `$X`). */
  const expanded: Array<ReadonlySet<number>> = []
  let words: Array<string> = []
  let operating = new Set<number>()
  let expanding = new Set<number>()
  let word = ''
  let inWord = false
  /** The word in progress has a quoted or escaped part. */
  let literal = false
  /** The word in progress has a part the shell expands: a glob or a variable, or braces it may (`{a,b}`, not `stash@{0}`). */
  let expands = false
  let braces = false
  let opaque = false
  /** Parentheses outside quotes: a subshell, a function's definition (`cat () (…)`), zsh's qualifier on a pattern. */
  let grouped = false
  /** An expansion that can set a variable or work out arithmetic (`evaluates`). */
  let evaluated = false
  const endWord = () => {
    if (inWord) {
      if (expands || (braces && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(word))) expanding.add(words.length)
      words.push(word)
    }
    word = ''
    inWord = false
    literal = false
    expands = false
    braces = false
  }
  const endCommand = (separator = '') => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
      ends.push(separator)
      operators.push(operating)
      expanded.push(expanding)
    }
    words = []
    operating = new Set()
    expanding = new Set()
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const rest = text.slice(index)
    if (char === "'") {
      const close = text.indexOf("'", index + 1)
      const end = close === -1 ? text.length : close
      word += text.slice(index + 1, end)
      inWord = true
      literal = true
      index = end
      continue
    }
    if (char === '"') {
      inWord = true
      literal = true
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        const inner = text[index] ?? ''
        if (inner === '\\' && index + 1 < text.length && '"\\$`'.includes(text[index + 1] ?? '')) {
          word += text[index + 1]
          index += 1
        } else {
          if (inner === '`' || (inner === '$' && text[index + 1] === '(')) opaque = true
          if (inner === '$' && evaluates(text, index)) evaluated = true
          word += inner
        }
      }
      continue
    }
    if (char === '\\') {
      word += text[index + 1] ?? ''
      inWord = true
      literal = true
      index += 1
      continue
    }
    // `$'…'`, quoted as C is, where `\'` doesn't end it: kept as written, and expanded, as the shell decodes it into other words.
    if (char === '$' && text[index + 1] === "'") {
      let end = index + 2
      while (end < text.length && text[end] !== "'") end += text[end] === '\\' ? 2 : 1
      word += `$${text.slice(index + 2, Math.min(end, text.length))}`
      inWord = true
      literal = true
      expands = true
      index = end
      continue
    }
    // A comment, from a word's start to the line's end: nothing in it runs, and what follows the line does.
    if (char === '#' && !inWord) {
      const end = text.indexOf('\n', index)
      index = (end === -1 ? text.length : end) - 1
      continue
    }
    if (char === '`' || (char === '$' && text[index + 1] === '(')) opaque = true
    if (char === '$' && evaluates(text, index)) evaluated = true
    if (char === '(' || char === ')') grouped = true
    const separator = SEPARATORS.find((candidate) => rest.startsWith(candidate))
    if (separator !== undefined && !(separator === '&' && rest.startsWith('&>'))) {
      endCommand(separator)
      index += separator.length - 1
      continue
    }
    const redirect = REDIRECTS.find((candidate) => rest.startsWith(candidate))
    if (redirect !== undefined) {
      // `1>file`: the descriptor belongs to the redirect, not to the arguments.
      if (inWord && !literal && /^\d+$/.test(word) && ['>', '>>', '2>'].includes(redirect)) {
        word = ''
        inWord = false
      }
      endWord()
      operating.add(words.length)
      words.push(redirect)
      index += redirect.length - 1
      // `2>&1`, `>&2`: a redirect to another stream, not to a file.
      const stream = /^&[0-9-]+/.exec(text.slice(index + 1))
      if (stream !== null) {
        operating.add(words.length)
        words.push(stream[0])
        index += stream[0].length
      }
      continue
    }
    if (char === ' ' || char === '\t') {
      endWord()
      continue
    }
    if ('*?[$'.includes(char)) expands = true
    if (char === '{') braces = true
    word += char
    inWord = true
  }
  endCommand()
  return { commands, ends, operators, expanded, opaque, grouped, evaluated }
}

/** Commands as the shell runs them: a script handed to a shell is read as commands of its own. */
const expandShells = (
  commands: ReadonlyArray<ReadonlyArray<string>>,
  opaqueBefore: boolean,
  scopesOf: ReadonlyArray<Scope> = [],
): Parsed => {
  let opaque = opaqueBefore
  const scopes: Array<Scope> = []
  const expanded = commands.flatMap((command, at): Array<ReadonlyArray<string>> => {
    const own = scopesOf[at] ?? NO_SCOPE
    const inner = unwrap(command)
    const [program, ...args] = inner
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    const windows = windowsScript(inner)
    if (windows === null) opaque = true
    const posixScript =
      program !== undefined && /^(ba|z|da|k)?sh$/.test(program.split('/').at(-1) ?? '') && flag !== -1 ? args[flag + 1] : undefined
    if (posixScript !== undefined || typeof windows === 'string') {
      // cmd's and PowerShell's backslashes separate folders: read as POSIX, they would escape the next letter.
      const script = parseCommandLine(posixScript ?? (windows ?? '').replaceAll('\\', '/'))
      if (script.opaque) opaque = true
      // Where the shell's own output goes stays a command of its own, made of its redirects alone: `sh -c '…' > ~/.zshrc`.
      const redirected = inner.flatMap((word, index) =>
        REDIRECTS.includes(word) ? [word, ...(inner[index + 1] === undefined ? [] : [inner[index + 1] ?? ''])] : [],
      )
      const ran = [...script.commands, ...(redirected.length === 0 ? [] : [redirected])]
      // The script runs in a shell of its own: a `cd` in it doesn't hold after.
      const inside = wrapped(script.scopes ?? script.commands.map(() => NO_SCOPE), NO_SCOPE, 1)
      scopes.push(...wrapped([...inside, ...(redirected.length === 0 ? [] : [NO_SCOPE])], own, 0))
      return ran
    }
    if (program === 'eval' || program === 'xargs' || program === 'source' || program === '.') opaque = true
    // What `eval` runs, as commands of their own, so git and the rest read them as they would written out: `eval git stash drop`.
    // It runs in the shell itself, so its `cd` holds.
    if (program === 'eval') {
      const ran = parseCommandLine(args.join(' '))
      scopes.push(...wrapped([NO_SCOPE, ...(ran.scopes ?? ran.commands.map(() => NO_SCOPE))], own, 0))
      return [inner, ...ran.commands]
    }
    scopes.push(own)
    return [inner]
  })
  return { commands: expanded, opaque, scopes }
}

/** The words a shell reads before a command it runs: `then rm …`. */
const SHELL_KEYWORDS = ['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']

/** A command without the words that only run it: shell keywords, a subshell's parentheses, variable assignments, `sudo`, `env`, `command`, `time`… */
const unwrap = (written: ReadonlyArray<string>): ReadonlyArray<string> => {
  // A subshell's or a group's command, and one a shell keyword starts: `(rm …)`, `{ rm …; }`, `do rm …`, `then rm …`, `! rm …`.
  let command = written
  // A parenthesis may stand as a word of its own: `( rm … )`, `( ( rm … ) )`.
  while (SHELL_KEYWORDS.includes(command[0] ?? '') || /^\(+$/.test(command[0] ?? '') || /^\(+[^(]/.test(command[0] ?? '')) {
    const [first = '', ...rest] = command
    command = SHELL_KEYWORDS.includes(first) || /^\(+$/.test(first) ? rest : [first.replace(/^\(+/, ''), ...rest]
  }
  while (command.length > 1 && /^\)+$/.test(command.at(-1) ?? '')) command = command.slice(0, -1)
  if (/[^)]\)+$/.test(command.at(-1) ?? '') && written[0]?.startsWith('(') === true)
    command = [...command.slice(0, -1), (command.at(-1) ?? '').replace(/\)+$/, '')]
  let index = 0
  while (index < command.length) {
    const word = command[index] ?? ''
    // `timeout [options] 60 cmd`: its options, then how long, then the command.
    if (word === 'timeout') {
      index += 1
      while ((command[index] ?? '').startsWith('-'))
        index += ['-s', '-k', '--signal', '--kill-after'].includes(command[index] ?? '') ? 2 : 1
      index += 1
      continue
    }
    if (
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ||
      ['sudo', 'command', 'builtin', 'exec', 'env', 'nice', 'time', 'nohup', 'caffeinate'].includes(word)
    ) {
      index += 1
      // `sudo -u x`, `env -i`, `nice -n 5`: their options too.
      while ((command[index] ?? '').startsWith('-')) index += ['-u', '-n', '-g'].includes(command[index] ?? '') ? 2 : 1
      continue
    }
    break
  }
  return command.slice(index)
}

/**
 * What a command line runs, by name: its first program and, when the next
 * word reads as one, its subcommand (`vercel deploy`). Never its arguments,
 * which may hold a secret, so it can be said where the command can't.
 */
export const programOf = (text: string): string | undefined => {
  for (const words of parseCommandLine(text).commands) {
    const [program, next] = unwrap(words)
    if (program === undefined || program === 'cd' || REDIRECTS.includes(program)) continue
    const name = program.slice(program.lastIndexOf('/') + 1)
    return next !== undefined && /^[a-z][a-z-]{0,22}[a-z0-9]?$/.test(next) ? `${name} ${next}` : name
  }
  return undefined
}

const OUTPUT_REDIRECTS = ['>>', '&>', '2>', '>']
/** Programs that only trim or filter what a command printed, when it pipes into them. */
const PLUMBING = ['tail', 'head', 'grep']
const KEPT_BETWEEN: Readonly<Record<string, string>> = { '&&': ' && ', '||': ' || ', ';': '; ', '\n': '; ', '|': ' | ', '&': ' & ' }

const sayWord = (word: string) => (word === '' ? "''" : /^[^\s'"\\;&|<>()`]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** A command's words without where its output goes: `2>&1`, `> out.log`. */
const withoutRedirects = (words: ReadonlyArray<string>, operators: ReadonlySet<number>): ReadonlyArray<string> =>
  words.flatMap((word, index) => {
    if (operators.has(index) && (OUTPUT_REDIRECTS.includes(word) || word.startsWith('&'))) return []
    // The word a redirect writes to.
    return operators.has(index - 1) && OUTPUT_REDIRECTS.includes(words[index - 1] ?? '') ? [] : [word]
  })

/** Flags whose value is a place, such as a config file, that a reader has no use for at a glance: `--config ../../a/vite.config.ts`. */
const PLACE_FLAGS = /^--?(config|config-?file|cwd|root|project|tsconfig|env-?file|prefix|dir|workspace)$/i
/** A runner's own words before the program it runs: `npx -y`, `bunx`, `pnpm dlx`, `yarn dlx`, `bun x`. */
const FETCHERS = [['npx'], ['bunx'], ['pnpx'], ['pnpm', 'dlx'], ['yarn', 'dlx'], ['bun', 'x']]
const FETCHER_FLAGS = ['-y', '--yes', '-q', '--quiet', '--no-install', '--no', '--bun']
const BIN_FOLDER = /(?:^|[/\\])node_modules[/\\]\.bin[/\\]([^/\\]+)$/
const looksLikePlace = (value: string) => /[/\\]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)

/**
 * A command's last meaningful part (ADR-044): its program without the folder
 * a package manager keeps it in or the runner that fetches it, and without
 * the flags that only say where a file is: `node_modules/.bin/vp dev
 * --config ../../a/vite.config.ts` reads `vp dev`.
 */
const plainer = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  let rest = words
  const runner = FETCHERS.find((one) => one.every((word, at) => rest[at] === word))
  if (runner !== undefined && rest.length > runner.length) {
    rest = rest.slice(runner.length)
    while (FETCHER_FLAGS.includes(rest[0] ?? '') && rest.length > 1) rest = rest.slice(1)
  }
  const bin = BIN_FOLDER.exec(rest[0] ?? '')?.[1]
  if (bin !== undefined) rest = [bin, ...rest.slice(1)]
  const kept: Array<string> = []
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? ''
    if (at > 0 && word.startsWith('-')) {
      const [flag = '', ...joined] = word.split('=')
      if (PLACE_FLAGS.test(flag)) {
        if (joined.length > 0 && looksLikePlace(joined.join('='))) continue
        if (joined.length === 0 && looksLikePlace(rest[at + 1] ?? '')) {
          at += 1
          continue
        }
      }
    }
    kept.push(word)
  }
  return kept
}

/**
 * A command line as the person reads it at a glance: what it runs, without
 * the `cd <dir> &&` an agent puts first, variable assignments, `timeout N`
 * and the like, or the plumbing after it (`2>&1`, `| tail -20`); a program
 * without its `node_modules/.bin/` or the `npx` that fetches it, and without
 * flags that only name a file (`plainer`). The line
 * itself is never changed; this is only what to show of it. A line that only
 * changes folder, or that has parts the shell works out when it runs, is
 * shown as written.
 */
export const shortCommand = (text: string): string => {
  const whole = text.trim()
  const { commands, ends, operators, opaque } = splitCommandLine(whole)
  if (opaque || whole.includes('<<')) return whole
  const parts = commands.map((words, index) => ({ words, end: ends[index] ?? '', operators: operators[index] ?? new Set<number>() }))
  // Leading `cd dir &&`, however many.
  let first = 0
  while (first < parts.length - 1) {
    const part = parts[first]
    if (part === undefined || !['cd', 'pushd'].includes(part.words[0] ?? '') || !['&&', ';', '\n'].includes(part.end)) break
    first += 1
  }
  let kept = parts.slice(first)
  // Trailing `| tail -20`, `| grep x`, only where something comes before the pipe.
  while (kept.length > 1 && kept.at(-2)?.end === '|' && PLUMBING.includes(unwrap(kept.at(-1)?.words ?? [])[0] ?? ''))
    kept = kept.slice(0, -1)
  const said = kept
    .map(({ words, end, operators }, index) => {
      // Words dropped from the front by unwrap shift where the operators are.
      const unwrapped = unwrap(words)
      const dropped = words.length - unwrapped.length
      const shown = plainer(withoutRedirects(unwrapped, new Set([...operators].map((at) => at - dropped))))
      return shown.length === 0 ? '' : `${shown.map(sayWord).join(' ')}${index === kept.length - 1 ? '' : (KEPT_BETWEEN[end] ?? '; ')}`
    })
    .join('')
    .trim()
  // A line that is only a `cd`, or only plumbing, has nothing to shorten to.
  return said === '' ? whole : said
}

// ---- Windows ---------------------------------------------------------------

/*
 * On Windows an agent's command may be cmd's or PowerShell's rather than a
 * POSIX shell's: `rd /s /q C:\code\app`, `Remove-Item -Recurse -Force
 * $env:USERPROFILE\code`, `git.exe push --force`. The rules read each command
 * also as the POSIX command that does the same (`rm -rf …`), so every rule
 * below holds for it; a line handed to cmd or PowerShell (`cmd /c …`,
 * `powershell -Command …`) as the commands it runs; and, on Windows, a line
 * also with its backslashes as the folder separators they are there. A second
 * reading only ever adds what a command is, never takes away.
 */

/** A program's name as Windows finds it: without its folder or `.exe`, in any case. */
const windowsName = (word: string) => (word.split(/[/\\]/).at(-1) ?? '').replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()

/** One of cmd's switches: `/s`, `/Q`, `/a:h`, `/-y`. */
const CMD_SWITCH = /^\/-?[A-Za-z?](:\S*)?$/

/** Whether a word names a PowerShell parameter by the start of its name, as PowerShell takes it: `-fo` for `-Force`. */
const isParameter = (word: string, name: string, shortest = 1) => {
  const given = /^-([A-Za-z]+)(?::|$)/.exec(word)?.[1]?.toLowerCase()
  return given !== undefined && given.length >= shortest && name.startsWith(given)
}

/**
 * A PowerShell command's arguments: the values of the parameters among
 * `valued` (`-Path x`, `-Path:x`, `-LiteralPath x,y`), and the rest by
 * position. Other parameters are switches; cmd's switches are left out.
 */
const powershellArgs = (args: ReadonlyArray<string>, valued: ReadonlyArray<string>) => {
  const named = new Map<string, Array<string>>()
  const positional: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (REDIRECTS.includes(arg)) {
      index += 1
      continue
    }
    if (CMD_SWITCH.test(arg)) continue
    const parameter = /^-([A-Za-z]+)(?::(.*))?$/.exec(arg)
    if (parameter === null) {
      positional.push(...arg.split(','))
      continue
    }
    const name = valued.find((each) => each.startsWith((parameter[1] ?? '').toLowerCase()))
    if (name === undefined) continue
    const value = parameter[2] ?? args[(index += 1)]
    if (value !== undefined) named.set(name, [...(named.get(name) ?? []), ...value.split(',')])
  }
  const of = (...names: ReadonlyArray<string>) => names.flatMap((name) => named.get(name) ?? [])
  return { of, positional }
}

const ITEM_PATHS = ['path', 'literalpath', 'pspath', 'filter', 'include', 'exclude', 'credential', 'stream']
const COPY_PATHS = [...ITEM_PATHS, 'destination', 'tosession', 'fromsession']
const WRITE_PATHS = [
  'path',
  'literalpath',
  'filepath',
  'value',
  'encoding',
  'itemtype',
  'type',
  'name',
  'credential',
  'stream',
  'inputobject',
]

/** Where a copy or move goes and what it takes, PowerShell's way or cmd's: `-Path` and `-Destination`, or by position. */
const fromTo = (args: ReadonlyArray<string>): { readonly sources: ReadonlyArray<string>; readonly target: string | undefined } => {
  const { of, positional } = powershellArgs(args, COPY_PATHS)
  const rest = [...positional]
  const sources = of('path', 'literalpath', 'pspath')
  if (sources.length === 0) sources.push(...rest.splice(0, Math.max(1, rest.length - (of('destination').length > 0 ? 0 : 1))))
  return { sources, target: of('destination')[0] ?? rest.at(-1) }
}

/** The POSIX command that does what a cmd or PowerShell command does, as far as the rules read it; none where it's the same. */
const fromWindows = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', ...args] = words
  const name = windowsName(first)
  const has = (cmd: ReadonlyArray<string>, parameter: string, shortest = 1) =>
    args.some((arg) => cmd.includes(arg.toLowerCase()) || isParameter(arg, parameter, shortest))
  switch (name) {
    case 'remove-item':
    case 'ri':
    case 'del':
    case 'erase':
    case 'rd':
    case 'rmdir':
    case 'rm': {
      const { of, positional } = powershellArgs(args, ITEM_PATHS)
      const flags = `${has(['/s', '-r'], 'recurse') ? 'r' : ''}${has(['/q', '/f', '-f'], 'force', 2) ? 'f' : ''}`
      return ['rm', ...(flags === '' ? [] : [`-${flags}`]), ...of('path', 'literalpath', 'pspath'), ...positional]
    }
    case 'move-item':
    case 'mi':
    case 'move':
    case 'mv': {
      const { sources, target } = fromTo(args)
      return ['mv', ...sources, target ?? '.']
    }
    case 'rename-item':
    case 'rni':
    case 'ren':
    case 'rename': {
      const { of, positional } = powershellArgs(args, ['path', 'literalpath', 'newname', 'credential'])
      return ['mv', ...[...of('path', 'literalpath'), ...positional].slice(0, 1), of('newname')[0] ?? positional.at(-1) ?? '.']
    }
    case 'copy-item':
    case 'cpi':
    case 'copy':
    case 'xcopy':
    case 'cp': {
      const { sources, target } = fromTo(args)
      return ['cp', ...sources, target ?? '.']
    }
    case 'robocopy': {
      // `robocopy <from> <to> [files] [/options]`: /MIR and /PURGE delete in where it copies to, /MOV and /MOVE from where it copies from.
      const [from = '.', to = '.'] = args.filter((arg) => !arg.startsWith('/'))
      const options = args.map((arg) => arg.toLowerCase())
      return [
        'rsync',
        ...(options.includes('/mir') || options.includes('/purge') ? ['--delete'] : []),
        ...(options.includes('/mov') || options.includes('/move') ? ['--remove-source-files'] : []),
        from,
        to,
      ]
    }
    case 'set-content':
    case 'sc':
    case 'add-content':
    case 'ac':
    case 'clear-content':
    case 'clc':
    case 'out-file':
    case 'new-item':
    case 'ni':
    case 'md':
    case 'mkdir':
    case 'tee-object': {
      const { of, positional } = powershellArgs(args, WRITE_PATHS)
      const named = of('path', 'literalpath', 'filepath')
      // What replaces a file's content, as `truncate` does; adding to it or making it keeps what's there.
      const replaces =
        ['set-content', 'sc', 'clear-content', 'clc'].includes(name) ||
        (['out-file', 'tee-object'].includes(name) && !has([], 'append')) ||
        (['new-item', 'ni'].includes(name) && has([], 'force'))
      return [replaces ? 'truncate' : 'touch', ...(named.length > 0 ? named : positional.slice(0, 1))]
    }
    case 'set-location':
    case 'sl':
    case 'chdir':
    case 'pushd':
    case 'cd': {
      const { of, positional } = powershellArgs(args, ['path', 'literalpath', 'stackname'])
      return ['cd', ...[...of('path', 'literalpath'), ...positional].slice(0, 1)]
    }
    default:
      return name === first ? undefined : [name, ...args]
  }
}

/** A command as written, and as the POSIX command that does what it does on Windows, where that differs. */
const readings = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> => {
  const read = fromWindows(words)
  return read === undefined || read.join('\0') === words.join('\0') ? [words] : [words, read]
}

/** A line as a POSIX shell reads it and, on Windows, with its backslashes as folders' separators, first, so a reason names the path as written. */
const lineReadings = (text: string, system: System): ReadonlyArray<Parsed> =>
  system.windows && text.includes('\\') ? [parseCommandLine(text.replaceAll('\\', '/')), parseCommandLine(text)] : [parseCommandLine(text)]

/** The PowerShell options that take a value, so what follows one isn't its command. */
const POWERSHELL_VALUED =
  /^-(executionpolicy|ep|ex|windowstyle|w|version|v|outputformat|o|of|inputformat|if|configurationname|psconsolefile|workingdirectory|wd|settingsfile|custompipename)$/i

/**
 * The script a line hands to cmd (`cmd /c …`) or PowerShell (`powershell
 * -Command …`, and Windows PowerShell's bare `powershell Remove-Item …`);
 * `null` for one Althar can't read (`-EncodedCommand`, or from its input);
 * none where it hands neither one.
 */
const windowsScript = (words: ReadonlyArray<string>): string | null | undefined => {
  const [first = '', ...args] = words
  const name = windowsName(first)
  if (name === 'cmd') {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
    return at === -1 ? undefined : args.slice(at + 1).join(' ')
  }
  if (name !== 'powershell' && name !== 'pwsh') return undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const option = arg.startsWith('-') ? arg.slice(1).toLowerCase() : undefined
    if (option !== undefined && (option === 'e' || option === 'ec' || (option.length >= 2 && 'encodedcommand'.startsWith(option))))
      return null
    if (option !== undefined && option !== '' && 'command'.startsWith(option)) {
      const script = args.slice(index + 1).join(' ')
      return script === '-' || script === '' ? null : script
    }
    if (option !== undefined && option.length >= 1 && 'file'.startsWith(option)) return undefined
    if (option !== undefined) {
      if (POWERSHELL_VALUED.test(arg)) index += 1
      continue
    }
    return args.slice(index).join(' ')
  }
  return undefined
}

// ---- Places ----------------------------------------------------------------

interface Places {
  readonly system: System
  /** Whether something is at a path. */
  readonly exists: (path: string) => boolean
  /** Whether a path is a folder that's there. */
  readonly folder: (path: string) => boolean
  /** The names in a folder that's there; none where it isn't. */
  readonly names: (path: string) => ReadonlyArray<string>
  readonly real: (path: string) => string
  readonly worktrees: ReadonlyArray<string>
  readonly scratch: ReadonlyArray<string>
  /** The folder `$TMPDIR` names in the agent's commands, where the rules know it (`RuleContext`'s `temp`). */
  readonly temp: string | undefined
}

const places = (context: RuleContext): Places => {
  const system = systemOf(context)
  const follow = context.realPath ?? realpathSync
  const real = realFrom(follow, system.paths)
  const exists = (path: string) => {
    try {
      follow(path)
      return true
    } catch {
      return false
    }
  }
  const folder = (path: string) => {
    try {
      return statSync(follow(path)).isDirectory()
    } catch {
      return false
    }
  }
  const names = (path: string) => {
    try {
      return readdirSync(follow(path))
    } catch {
      return []
    }
  }
  // On Windows the null device too, as Git Bash names it, where agents' commands run: `2>/dev/null` writes nothing.
  const scratch = [
    ...(context.scratch ?? (system.windows ? [tmpdir(), '/dev/null'] : [tmpdir(), '/tmp', '/dev/null', '/dev/stdout', '/dev/stderr'])),
  ].map(real)
  const temp = context.temp === undefined ? undefined : real(context.temp)
  return {
    system,
    exists,
    folder,
    names,
    real,
    worktrees: (context.worktrees ?? [context.worktree]).map(real),
    scratch: temp === undefined ? scratch : [...scratch, temp],
    temp,
  }
}

const within = ({ paths }: System, root: string, path: string) => {
  const inner = paths.relative(root, path)
  return inner === '' || (!inner.startsWith(`..${paths.sep}`) && inner !== '..' && !paths.isAbsolute(inner))
}

/** The temp folder, as a command may name it at the start of a path. */
const TEMP_WORD = /^(\$TMPDIR|\$\{TMPDIR\}|\$TMP|\$TEMP|\$env:(TEMP|TMP)|%TEMP%|%TMP%)(?=$|[/\\])/i

/** The folder a command runs in, as it may name it at the start of a path. */
const HERE_WORD = /^(\$PWD|\$\{PWD\})(?=$|[/\\])/

/** Whether a path that starts with the temp folder's name climbs out of it: `$TMPDIR/../notes.md`. */
const leavesTemp = (word: string) => {
  const rest = word.replace(TEMP_WORD, '')
  if (rest === word) return false
  const inner = posix.normalize(`.${rest.replaceAll('\\', '/')}`)
  return inner === '..' || inner.startsWith('../')
}

/**
 * Where a path a command names really is, from the folder the command runs
 * in: with the home folder, the temp folder and `$PWD` written out, so
 * `cp $TMPDIR/x ./y` reads as `cp /…/x ./y`. Where the rules don't know the
 * agent's temp folder, a path in it is read as in Althar's: what is in any
 * temp folder is the task's own, whichever it is; one that climbs out of it
 * is worked out only when the command runs (`unsettled`).
 */
const locate = (where: Places, cwd: string, path: string) => {
  const { paths, home } = where.system
  const temp = where.temp ?? where.scratch[0]
  const written = path
    .replace(HOME_WORD, home)
    .replace(HERE_WORD, cwd)
    .replace(TEMP_WORD, (word) => temp ?? word)
  return where.real(paths.resolve(cwd, written))
}

const outside = (where: Places, path: string) =>
  !where.worktrees.some((root) => within(where.system, root, path)) && !where.scratch.some((root) => within(where.system, root, path))

/**
 * The git checkout an existing file outside the task is in: the person's
 * own, another task's. What isn't committed there is nowhere else, so
 * changing it could throw that away. None for a file that isn't there yet.
 */
const checkoutOf = (where: Places, path: string): string | undefined => {
  const { paths } = where.system
  if (!where.exists(path)) return undefined
  // A folder of its own may be the checkout: copying a folder over `~/code/app`.
  for (let folder = where.folder(path) ? path : paths.dirname(path); ; folder = paths.dirname(folder)) {
    if (where.exists(paths.join(folder, '.git'))) return folder
    if (paths.dirname(folder) === folder) return undefined
  }
}

/** A wildcard's characters in a path's name: `*.log`, `b-?.png`, `[ab].txt`. */
const WILDCARD = /[*?[]/

/**
 * What a shell may make of a word besides `*`, `?` and `[…]`, where the
 * rules don't read what it names: braces (`{a,b}.txt`), escapes, zsh's and
 * extglob's patterns (`(a|b)`, `<1-9>`, `^*.ts`, `a#`, `*~x`, `=ls`).
 */
const EXPANDED = /[{}()<>|^#\\]|.~|^=/

/**
 * What a shell's wildcard in a name matches, as a test of a name: `*` any
 * run of characters, `?` one, `[…]` one listed or in a range, `[!…]` or
 * `[^…]` one not. None where it can't read it as the shell would, such as a
 * class (`[[:digit:]]`), an equivalence (`[[=a=]]`), an unclosed `[` or one
 * that starts `[]`. A name matches where it does as written or with case
 * ignored, as a shell may (`nocaseglob`): ignoring case alone narrows a
 * class left out, `[!A-Z]` then missing `l`. Matching more than the shell
 * would only reads more as there.
 */
const wildcardPattern = (name: string): ((each: string) => boolean) | undefined => {
  let pattern = '^'
  for (let at = 0; at < name.length; at++) {
    const char = name.charAt(at)
    if (char === '*') pattern += '.*'
    else if (char === '?') pattern += '.'
    else if (char === '[') {
      const negated = name.charAt(at + 1) === '!' || name.charAt(at + 1) === '^'
      const from = at + (negated ? 2 : 1)
      const end = name.indexOf(']', from)
      const listed = end === -1 ? '' : name.slice(from, end)
      // `[]a]` and `[!]a]` list `]` itself, not read; with `[` or `\` in it, it is a class, an equivalence or an escape.
      if (listed === '' || /[[\\]/.test(listed)) return undefined
      pattern += `[${negated ? '^' : ''}${listed.replace(/\^/g, '\\^')}]`
      at = end
    } else pattern += char.replace(/[.+^${}()|\]\\]/g, '\\$&')
  }
  try {
    const exact = new RegExp(`${pattern}$`)
    const caseless = new RegExp(`${pattern}$`, 'i')
    return (each) => exact.test(each) || caseless.test(each)
  } catch {
    // A range out of order, `[z-a]`.
    return undefined
  }
}

/**
 * Whether what a command names is surely not there now: it isn't, while its
 * folder is; or, named relatively from a folder the rules guess the shell is
 * in (`guessed`), nor is its folder, as where the shell is elsewhere (its
 * folder holds from one command to the next) or a `cd` they followed leads
 * nowhere. With a wildcard in its name, nothing in its folder matches it;
 * with one before, the folder before it is named from there and isn't there.
 * Never what the shell could expand otherwise (`EXPANDED`).
 */
const missing = (where: Places, word: string, path: string, guessed: boolean) => {
  if (EXPANDED.test(word.replace(HOME_WORD, ''))) return false
  const { paths } = where.system
  const relative = guessed && !paths.isAbsolute(word.replace(HOME_WORD, '/').replace(TEMP_WORD, '/'))
  const folder = paths.dirname(path)
  if (!WILDCARD.test(path)) return !where.exists(path) && (relative || where.exists(folder))
  if (WILDCARD.test(folder)) {
    const parts = path.split(/[/\\]/)
    return (
      relative &&
      !where.exists(
        parts
          .slice(
            0,
            parts.findIndex((part) => WILDCARD.test(part)),
          )
          .join(paths.sep) || paths.sep,
      )
    )
  }
  if (!where.exists(folder)) return relative
  const matches = wildcardPattern(paths.basename(path))
  return matches !== undefined && where.folder(folder) && !where.names(folder).some(matches)
}

const changesCheckout = (path: string) =>
  kept(`Changing ${path}, in another checkout, always asks: what isn't committed there is nowhere else.`, 'outside', 'irreversible')

/**
 * A variable a path may start with that the rules can read: the temp folder,
 * or where the command runs. Any other `$…`, `%…%` or backtick is worked out
 * only when the command runs.
 */
const KNOWN_START = /^(\$TMPDIR|\$\{TMPDIR\}|\$TMP|\$TEMP|\$env:(TEMP|TMP)|%TEMP%|%TMP%|\$PWD|\$\{PWD\})(?=$|[/\\])/i

/**
 * Whether a word is worked out only when the command runs: `$DIR`,
 * `"$(git rev-parse --show-toplevel)/dist"`, `%APP%`; and, where the rules
 * don't know the agent's temp folder, a path climbing out of it.
 */
const unsettled = (word: string, where?: Places) =>
  (where?.temp === undefined && leavesTemp(word)) || /[$`]|%\w+%/.test(word.replace(HOME_WORD, '').replace(KNOWN_START, ''))

// ---- Git -------------------------------------------------------------------

interface GitCall {
  readonly subcommand: string
  readonly args: ReadonlyArray<string>
  /** The folder git works in, after `-C`. */
  readonly cwd: string
  /** Global options that point git at another repository: `--git-dir`, `--work-tree`. */
  readonly elsewhere: ReadonlyArray<string>
}

const GIT_OPTIONS_WITH_VALUE = ['-c', '--namespace', '--exec-path', '--super-prefix', '--config-env', '--list-cmds']

const gitCall = (words: ReadonlyArray<string>, cwd: string, paths = systemOf().paths): GitCall | undefined => {
  if ((words[0] ?? '').split('/').at(-1) !== 'git') return undefined
  let at = cwd
  const elsewhere: Array<string> = []
  let index = 1
  while (index < words.length) {
    const word = words[index] ?? ''
    if (word === '-C') {
      at = paths.resolve(at, words[index + 1] ?? '.')
      index += 2
    } else if (word === '--git-dir' || word === '--work-tree') {
      elsewhere.push(paths.resolve(at, words[index + 1] ?? '.'))
      index += 2
    } else if (word.startsWith('--git-dir=') || word.startsWith('--work-tree=')) {
      elsewhere.push(paths.resolve(at, word.slice(word.indexOf('=') + 1)))
      index += 1
    } else if (GIT_OPTIONS_WITH_VALUE.includes(word)) {
      index += 2
    } else if (word.startsWith('-')) {
      index += 1
    } else {
      return { subcommand: word, args: words.slice(index + 1), cwd: at, elsewhere }
    }
  }
  return undefined
}

const PUSH_OPTIONS_WITH_VALUE = ['--repo', '-o', '--push-option', '--receive-pack', '--exec']
const PUSH_FLAGS_HARMLESS =
  /^(-u|--set-upstream|-n|--dry-run|-v|--verbose|-q|--quiet|--progress|--no-progress|--no-verify|--verify|--atomic|--no-atomic|--porcelain|--ipv4|--ipv6|-4|-6|--thin|--no-thin|--signed(=.*)?|--no-signed|--recurse-submodules=.*|--no-recurse-submodules|--no-force-with-lease|--no-force-if-includes|--no-tags|--no-follow-tags)$/

/** What a push does that the rules keep for the person: every kind it is; none where it goes only where the task may push. */
const pushKinds = (args: ReadonlyArray<string>, context: RuleContext): ReadonlyArray<Kept> => {
  const mains = context.defaultBranches ?? [context.defaultBranch]
  const own = (branch: string) => branch === context.taskBranch
  const found: Array<Kept> = []
  const positional: Array<string> = []
  let deleting = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    if (/^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(arg) || /^-[a-z]*f[a-z]*$/.test(arg))
      found.push(kept('A force push always asks: it can throw away commits on the remote.', 'force-push', 'irreversible'))
    else if (arg === '--mirror')
      // A mirror makes the remote's branches the same as here: it forces them, and deletes those not here.
      found.push(
        kept('Pushing every branch always asks.', 'many-branches'),
        kept(
          'A mirror push forces every branch, which always asks: it can throw away commits on the remote.',
          'force-push',
          'irreversible',
        ),
        kept(
          "A mirror push deletes the remote's branches that aren't here, which always asks: their commits may be nowhere else.",
          'delete-branch',
          'irreversible',
        ),
      )
    else if (/^(--all|--branches)$/.test(arg)) found.push(kept('Pushing every branch always asks.', 'many-branches'))
    else if (/^(--tags|--follow-tags)$/.test(arg))
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
    else if (arg === '--prune')
      found.push(
        kept('A push that deletes remote branches always asks: their commits may be nowhere else.', 'delete-branch', 'irreversible'),
      )
    else if (arg === '-d' || arg === '--delete') deleting = true
    else if (PUSH_OPTIONS_WITH_VALUE.includes(arg)) index += 1
    else if (!PUSH_OPTIONS_WITH_VALUE.some((option) => arg.startsWith(`${option}=`)) && !PUSH_FLAGS_HARMLESS.test(arg))
      found.push(kept(`Althar can't tell what \`${arg}\` does to a push, so it asks.`, 'unclear', 'irreversible'))
  }
  const [, ...refspecs] = positional
  const destinations: Array<{ readonly branch: string; readonly deletes: boolean }> = []
  // `--tags` alone pushes the tags and no branch, whichever is checked out.
  if (refspecs.length === 0 && (deleting || !args.includes('--tags'))) {
    if (deleting) found.push(kept(`Althar can't tell which branch this deletes, so it asks.`, 'unclear', 'irreversible'))
    else if (context.currentBranch === undefined)
      found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear', 'irreversible'))
    else destinations.push({ branch: context.currentBranch, deletes: false })
  }
  for (const written of refspecs) {
    // A forced refspec still goes somewhere, which counts too.
    if (written.startsWith('+'))
      found.push(kept('A force push always asks: it can throw away commits on the remote.', 'force-push', 'irreversible'))
    const refspec = written.replace(/^\+/, '')
    if (refspec.includes('*')) {
      found.push(kept('A push to a pattern of branches always asks.', 'many-branches'))
      continue
    }
    const colon = refspec.lastIndexOf(':')
    const source = colon === -1 ? refspec : refspec.slice(0, colon)
    let destination = colon === -1 ? refspec : refspec.slice(colon + 1)
    if (colon !== -1 && destination === '') {
      found.push(kept('A push of matching branches always asks.', 'many-branches'))
      continue
    }
    if (destination === 'HEAD' || (colon === -1 && source === 'HEAD')) {
      if (context.currentBranch === undefined) {
        found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear', 'irreversible'))
        continue
      }
      destination = context.currentBranch
    }
    if (destination.startsWith('refs/tags/')) {
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
      continue
    }
    if (destination.startsWith('refs/') && !destination.startsWith('refs/heads/')) {
      found.push(kept(`Althar can't tell what \`${destination}\` is, so it asks.`, 'unclear', 'irreversible'))
      continue
    }
    destinations.push({ branch: destination.replace(/^refs\/heads\//, ''), deletes: deleting || (colon !== -1 && source === '') })
  }
  for (const { branch, deletes } of destinations) {
    if (mains.includes(branch))
      found.push(
        kept(
          deletes
            ? `Deleting ${branch} always asks: everyone's work starts from it.`
            : `A push to ${branch} always asks: once others have it, it can't be taken back.`,
          'default-branch',
          'irreversible',
        ),
      )
    else if (deletes && !own(branch))
      found.push(
        kept(
          `Deleting ${branch}, which isn't this task's branch, always asks: its commits may be nowhere else.`,
          'delete-branch',
          'irreversible',
        ),
      )
  }
  return found
}

// ---- Commands --------------------------------------------------------------

/**
 * Tools that deploy or publish, by the subcommands that do: read in the
 * subcommand's place, never in arguments or quoted text, so `grep deploy`
 * and `git commit -m "Fix the deploy script"` aren't deploys.
 */
const DEPLOYERS: Readonly<Record<string, RegExp>> = {
  wrangler: /^(deploy|publish)$/,
  vercel: /^(deploy|publish)$/,
  netlify: /^deploy$/,
  flyctl: /^deploy$/,
  fly: /^deploy$/,
  firebase: /^deploy$/,
  serverless: /^deploy$/,
  sls: /^deploy$/,
  cdk: /^(deploy|destroy)$/,
  sam: /^deploy$/,
  kubectl: /^(apply|delete|rollout|replace|patch)$/,
  terraform: /^(apply|destroy)$/,
  tofu: /^(apply|destroy)$/,
  pulumi: /^(up|destroy)$/,
  helm: /^(install|upgrade|uninstall|rollback)$/,
  npm: /^publish$/,
  bun: /^publish$/,
  pnpm: /^publish$/,
  yarn: /^publish$/,
  cargo: /^publish$/,
  gem: /^(publish|push)$/,
  twine: /^upload$/,
  poetry: /^publish$/,
}

/** Task runners whose targets name what they do: `make deploy`, `just publish-docs`. */
const RUNNERS = ['make', 'just', 'task', 'rake', 'mage']

const DEPLOY_WORD = /^(deploy|publish|release)([:._-]|$)/

/** Whether a command deploys or publishes, as its program and subcommand say. */
const deploys = (words: ReadonlyArray<string>): boolean => {
  const [first = '', ...rest] = words
  const program = first.slice(first.lastIndexOf('/') + 1)
  const [sub = '', next = ''] = rest.filter((word) => !word.startsWith('-'))
  // A script named for it: `./deploy.sh`, `scripts/release`.
  if (DEPLOY_WORD.test(program) && program !== 'release') return true
  if (DEPLOYERS[program]?.test(sub) === true) return true
  if (program === 'vercel' && rest.includes('--prod')) return true
  if (program === 'gh' && sub === 'release' && next === 'create') return true
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program) && sub === 'run' && DEPLOY_WORD.test(next)) return true
  if (RUNNERS.includes(program) && rest.some((word) => !word.startsWith('-') && DEPLOY_WORD.test(word))) return true
  // A script given its own subcommand: `./ops.sh deploy prod`.
  return (first.includes('/') || /\.(sh|py|js|ts|rb)$/.test(program)) && DEPLOY_WORD.test(sub)
}

/**
 * The command a package runner runs for it, as its own words: `npx vercel
 * deploy`, `pnpm exec prisma migrate reset`. None where the command isn't one.
 */
const runnerRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', second = ''] = words
  const program = first.slice(first.lastIndexOf('/') + 1)
  const start = ['npx', 'bunx', 'pnpx', 'uvx'].includes(program)
    ? 1
    : (program === 'pnpm' && (second === 'exec' || second === 'dlx')) ||
        (program === 'yarn' && (second === 'exec' || second === 'dlx')) ||
        (program === 'npm' && second === 'exec') ||
        (program === 'bun' && second === 'x')
      ? 2
      : undefined
  if (start === undefined) return undefined
  let index = start
  while ((words[index] ?? '').startsWith('-')) index += ['-p', '--package', '-c', '--call', '--from'].includes(words[index] ?? '') ? 2 : 1
  if (words[index] === '--') index += 1
  return words.slice(index)
}

/** Shells and interpreters that run a script they're given: `bash ops/run.sh deploy`. */
const INTERPRETERS = ['bash', 'sh', 'zsh', 'dash', 'python', 'python3', 'node', 'ruby', 'perl']

/** The script an interpreter runs, as a command of its own; none where it runs no script. */
const scriptRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', ...rest] = words
  if (!INTERPRETERS.includes(first.slice(first.lastIndexOf('/') + 1))) return undefined
  const at = rest.findIndex((word) => !word.startsWith('-'))
  return at === -1 ? undefined : rest.slice(at)
}

/** `xargs`'s options that take the next word. */
const XARGS_VALUED = [
  '-a',
  '-d',
  '-E',
  '-e',
  '-I',
  '-L',
  '-l',
  '-n',
  '-P',
  '-s',
  '--arg-file',
  '--delimiter',
  '--max-args',
  '--max-procs',
  '--max-chars',
  '--max-lines',
  '--process-slot-var',
]

/** The command `xargs` runs, with the words its input adds left out; none where it isn't `xargs`. */
const xargsRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  if ((words[0] ?? '').split('/').at(-1) !== 'xargs') return undefined
  let index = 1
  while ((words[index] ?? '').startsWith('-') && words[index] !== '--') index += XARGS_VALUED.includes(words[index] ?? '') ? 2 : 1
  if (words[index] === '--') index += 1
  return words.slice(index)
}

/** The commands `eval` runs, read again as the shell would; none where it isn't `eval`. */
const evalRuns = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  words[0] === 'eval' ? parseCommandLine(words.slice(1).join(' ')).commands : []

/** A command as itself, and as what a package runner, an interpreter, `xargs` or `eval` runs for it. */
const commandsIn = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  [words, runnerRuns(words), scriptRuns(words), xargsRuns(words), ...evalRuns(words)].filter(
    (each): each is ReadonlyArray<string> => each !== undefined && each.length > 0,
  )

/** Programs whose arguments are places they write: all of them, or the last. */
const WRITES_ALL = ['touch', 'mkdir', 'rm', 'rmdir', 'tee', 'truncate', 'chmod', 'chown', 'chgrp', 'unlink', 'shred']
const WRITES_LAST = ['cp', 'mv', 'ln', 'install', 'rsync', 'scp']

/** Where a command's output goes, as its redirects say: files, not other streams (`2>&1`). */
const redirects = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  words.flatMap((word, index) => {
    const target = words[index + 1]
    return REDIRECTS.slice(0, 4).includes(word) && target !== undefined && !target.startsWith('&') ? [target] : []
  })

/** A command made only of the redirects a shell wrapper carried, for where its script's output goes. */
const onlyRedirects = (words: ReadonlyArray<string>) => REDIRECTS.includes(words[0] ?? '')

/** Programs that take the folder they copy or move into as `-t`, by the other short flags they take a value for. */
const TARGET_FOLDER: Readonly<Record<string, string>> = { cp: 'S', mv: 'S', ln: 'S', install: 'Sgmo' }

/**
 * What a copy or move takes from and where it puts it, as its words say: the
 * last operand is where, but where `-t` names the folder (`-t dir`, `-tdir`,
 * `--target-directory=dir`), every operand is something it takes.
 */
const copied = (words: ReadonlyArray<string>): { readonly sources: ReadonlyArray<string>; readonly target: string | undefined } => {
  const values = TARGET_FOLDER[(words[0] ?? '').split('/').at(-1) ?? '']
  const operands: Array<string> = []
  let folder: string | undefined
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (REDIRECTS.includes(word)) index += 1
    else if (!word.startsWith('-')) operands.push(word)
    else if (values === undefined || word === '-' || word === '--') continue
    else if (word.startsWith('--')) {
      const [name = '', ...value] = word.split('=')
      if (name.length >= 3 && '--target-directory'.startsWith(name))
        folder = value.length > 0 ? value.join('=') : (words[(index += 1)] ?? '')
    } else {
      // A cluster of short flags, where the first that takes a value takes the rest of the word, or the next.
      const at = word.slice(1).search(new RegExp(`[t${values}]`)) + 1
      if (at === 0) continue
      const value = word.length > at + 1 ? word.slice(at + 1) : (words[(index += 1)] ?? '')
      if (word[at] === 't') folder = value
    }
  }
  return folder === undefined
    ? { sources: operands.slice(0, -1), target: operands.length > 1 ? operands.at(-1) : undefined }
    : { sources: operands, target: folder }
}

/**
 * The places a command replaces what's there, as far as its words say: a
 * `>` redirect, where a copy or move goes, `tee`, `truncate`, `sed -i`,
 * `dd of=`. Not `>>`, `touch`, `mkdir` or `chmod`, which keep it.
 */
const overwrites = (words: ReadonlyArray<string>, where: Places, cwd: string): ReadonlyArray<string> => {
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  const operands = operandsOf(words)
  const { sources, target } = copied(words)
  const { paths } = where.system
  // Into a folder that's there, a copy or move lands on what has its source's name in it: `cp main.ts ~/code/app`, `cp -r src ~/code/app`.
  // A folder's contents (`src/.`, `src/*`, rsync's `src/`) land on the folder itself.
  const contents = (source: string) => /(^|[/\\])\.$|[*?[][^/\\]*$/.test(source) || (program === 'rsync' && /[/\\]$/.test(source))
  const landing = (into: string) =>
    where.folder(locate(where, cwd, into))
      ? sources.map((source) =>
          contents(source) ? locate(where, cwd, into) : paths.join(locate(where, cwd, into), paths.basename(locate(where, cwd, source))),
        )
      : [into]
  return [
    ...words.flatMap((word, index) =>
      ['>', '&>', '2>'].includes(word) && words[index + 1] !== undefined && !(words[index + 1] ?? '').startsWith('&')
        ? [words[index + 1] ?? '']
        : [],
    ),
    ...words.flatMap((word) => (word.startsWith('of=') ? [word.slice(3)] : [])),
    ...(program === 'truncate' || (program === 'tee' && !hasFlag(words.slice(1), '-a', '--append')) ? operands : []),
    ...(WRITES_LAST.includes(program) && target !== undefined ? landing(target) : []),
    ...(program === 'sed' && words.some((word) => word.startsWith('-i') || word === '--in-place') ? operands.slice(1) : []),
  ]
}

/** The places a command writes, as far as its words say. */
const writes = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const targets: Array<string> = [...redirects(words)]
  words.forEach((word) => {
    if (word.startsWith('of=')) targets.push(word.slice(3))
  })
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  const operands = operandsOf(words)
  if (WRITES_ALL.includes(program)) targets.push(...operands)
  const { target } = copied(words)
  if (WRITES_LAST.includes(program) && target !== undefined) targets.push(target)
  if (program === 'sed' && words.some((word) => word.startsWith('-i') || word === '--in-place')) targets.push(...operands.slice(1))
  return targets
}

/**
 * A command's operands: its words that aren't flags, redirects or where a
 * redirect goes. cmd's `rmdir /s /q` takes switches, not folders at the
 * root, which a POSIX `rmdir` would only remove empty.
 */
const operandsOf = (words: ReadonlyArray<string>) =>
  words
    .slice(1)
    .filter((word, index, all) => !word.startsWith('-') && !REDIRECTS.includes(word) && !REDIRECTS.includes(all[index - 1] ?? ''))
    .filter((word) => !(/^\/[sq]$/i.test(word) && (words[0] ?? '').split('/').at(-1) === 'rmdir'))

/**
 * The places a command deletes or moves away, as its words say: what `rm`
 * and the like name, the sources of `mv`, the folders `find -delete` starts
 * from, and what `rsync --delete` or `--remove-source-files` removes.
 */
const removes = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  const operands = operandsOf(words)
  if (['rm', 'rmdir', 'unlink', 'shred', 'rimraf', 'trash'].includes(program)) return operands
  if (program === 'mv') return copied(words).sources
  if (program === 'rsync')
    return [
      ...(words.some((word) => word.startsWith('--delete')) ? operands.slice(-1) : []),
      ...(words.includes('--remove-source-files') ? operands.slice(0, -1) : []),
    ]
  if (program === 'find') {
    const deletes =
      words.includes('-delete') ||
      words.some(
        (word, index) =>
          ['-exec', '-execdir', '-ok', '-okdir'].includes(word) && /(^|\/)(rm|rmdir|unlink|shred)$/.test(words[index + 1] ?? ''),
      )
    if (!deletes) return []
    const from = words.slice(1).findIndex((word) => word.startsWith('-') || word === '(' || word === '!')
    const roots = from === -1 ? words.slice(1) : words.slice(1, from + 1)
    return roots.length === 0 ? ['.'] : roots
  }
  return []
}

/** Package managers that install on this computer for everyone, by the subcommands that do: outside any task's worktree. */
const INSTALLERS: Readonly<Record<string, RegExp>> = {
  brew: /^(install|reinstall|uninstall|remove|rm|upgrade|link|unlink|tap|untap|autoremove|cleanup|services)$/,
  cargo: /^(install|uninstall)$/,
  go: /^install$/,
  gem: /^(install|uninstall|update)$/,
  pipx: /^(install|uninstall|upgrade|upgrade-all|reinstall|reinstall-all|inject|uninject)$/,
  apt: /^(install|reinstall|remove|purge|upgrade|full-upgrade|dist-upgrade|autoremove)$/,
  'apt-get': /^(install|reinstall|remove|purge|upgrade|dist-upgrade|autoremove)$/,
  dnf: /^(install|reinstall|remove|erase|upgrade|update|autoremove)$/,
  yum: /^(install|reinstall|remove|erase|upgrade|update|autoremove)$/,
  zypper: /^(install|in|remove|rm|update|up|dist-upgrade|dup)$/,
  apk: /^(add|del|upgrade)$/,
  port: /^(install|uninstall|upgrade|activate|deactivate)$/,
  snap: /^(install|remove|refresh)$/,
  winget: /^(install|add|uninstall|remove|rm|upgrade|update|import)$/,
  choco: /^(install|uninstall|upgrade)$/,
  scoop: /^(install|uninstall|update|reset|bucket)$/,
}

/** What a JavaScript package manager does to installed packages: with `-g`, it does it for the whole computer. */
const JS_INSTALLS = /^(install|i|add|uninstall|un|remove|rm|r|update|up|upgrade|link|ln|unlink)$/

/** Whether a command installs or removes software for the whole computer, as its words say, outside any task. */
const installsGlobally = (words: ReadonlyArray<string>): boolean => {
  const [first = '', ...rest] = words
  const program = first.slice(first.lastIndexOf('/') + 1)
  const [sub = '', next = ''] = rest.filter((word) => !word.startsWith('-'))
  if (INSTALLERS[program]?.test(sub) === true) return true
  if (program === 'pacman') return rest.some((word) => /^-[SRU]/.test(word))
  if (['npm', 'pnpm', 'bun'].includes(program))
    return JS_INSTALLS.test(sub) && rest.some((word) => word === '-g' || word === '--global' || word === '--location=global')
  if (program === 'yarn') return sub === 'global'
  if (program === 'uv')
    return (sub === 'tool' && /^(install|uninstall|upgrade)$/.test(next)) || (sub === 'pip' && rest.includes('--system'))
  // PowerShell's modules and packages, for every session of the person's.
  if (/^(install|uninstall|update)-(module|package|script|psresource)$/i.test(program)) return true
  if (/^pip(3(\.\d+)?)?$/.test(program))
    return /^(install|uninstall)$/.test(sub) && rest.some((word) => word === '--user' || word === '--break-system-packages')
  return false
}

/** Whether a short or long flag is among a command's words: `-D` in `-D` or `-Df`, `--delete` as itself. */
const hasFlag = (args: ReadonlyArray<string>, ...flags: ReadonlyArray<string>) =>
  args.some(
    (arg) =>
      flags.includes(arg) || (/^-[a-zA-Z]{2,}$/.test(arg) && flags.some((flag) => /^-[a-zA-Z]$/.test(flag) && arg.includes(flag.slice(1)))),
  )

/** The value a flag takes, as the next word or joined with `=`: `-B name`, `--force-create=name`. */
const flagValue = (args: ReadonlyArray<string>, ...flags: ReadonlyArray<string>): string | undefined => {
  for (const [index, arg] of args.entries()) {
    if (flags.includes(arg)) return args[index + 1]
    const joined = flags.find((flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`))
    if (joined !== undefined) return arg.slice(joined.length + 1)
  }
  return undefined
}

/**
 * What a git command that isn't a push does that could lose work, here or
 * in every checkout of the repository: deleting a branch that isn't the
 * task's, or moving, renaming or resetting one by force (a worktree shares
 * its repository's branches, so they are the person's too, and their commits
 * may be nowhere else); clearing the stash, which every checkout shares; and
 * throwing away what git keeps to recover lost work (`reflog expire`, `gc
 * --prune=now`, `prune`).
 */
const gitKinds = (git: GitCall, context: RuleContext): ReadonlyArray<Kept> => {
  const others = (branches: ReadonlyArray<string | undefined>) =>
    branches.filter((branch): branch is string => branch !== undefined && branch !== '' && branch !== context.taskBranch)
  const branchKept = (how: string, branches: ReadonlyArray<string | undefined>) =>
    others(branches)
      .slice(0, 1)
      .map((branch) =>
        kept(
          `${how} ${branch}, which isn't this task's branch, always asks: its commits may be nowhere else.`,
          'delete-branch',
          'irreversible',
        ),
      )
  const named = git.args.filter((arg) => !arg.startsWith('-'))
  switch (git.subcommand) {
    case 'branch': {
      if (hasFlag(git.args, '-d', '-D', '--delete')) return branchKept('Deleting the branch', named)
      const renames = hasFlag(git.args, '-m', '-M', '--move')
      const copies = hasFlag(git.args, '-c', '-C', '--copy')
      const forced = hasFlag(git.args, '-f', '--force', '-M', '-C')
      if (renames || copies) {
        const [from, to] = named.length >= 2 ? named : [context.currentBranch, named[0]]
        return [...(renames ? branchKept('Renaming the branch', [from]) : []), ...(forced ? branchKept('Replacing the branch', [to]) : [])]
      }
      return forced ? branchKept('Moving the branch', [named[0]]) : []
    }
    case 'checkout':
      return branchKept('Resetting the branch', [flagValue(git.args, '-B')])
    case 'switch':
      return branchKept('Resetting the branch', [flagValue(git.args, '-C', '--force-create')])
    case 'update-ref': {
      // What it changes comes in on its input, which isn't read here: deleting or moving any branch, say.
      if (git.args.includes('--stdin'))
        return [kept("Althar can't tell which branches `git update-ref --stdin` changes, so it asks.", 'unclear', 'irreversible')]
      const ref = git.args.filter((arg, index, all) => !arg.startsWith('-') && all[index - 1] !== '-m')[0] ?? ''
      if (!ref.startsWith('refs/heads/')) return []
      return branchKept(git.args.includes('-d') ? 'Deleting the branch' : 'Moving the branch', [ref.slice('refs/heads/'.length)])
    }
    case 'stash': {
      // Every checkout shares the stash, and an entry may be the person's or another task's: `stash@{0}` is whoever stashed last.
      const how = { clear: "Clearing git's stash", drop: 'Dropping a stash entry', pop: 'Popping a stash entry' }[git.args[0] ?? '']
      return how === undefined
        ? []
        : [kept(`${how} always asks: every checkout of the repository shares the stash, the person's too.`, 'outside', 'floor')]
    }
    case 'reflog':
    case 'gc':
    case 'prune': {
      const forgets =
        git.subcommand === 'prune' ||
        (git.subcommand === 'reflog' && ['expire', 'delete'].includes(git.args[0] ?? '')) ||
        (git.subcommand === 'gc' && git.args.some((arg) => /^--prune=(now|all)$/.test(arg)))
      return forgets
        ? [
            kept(
              `\`git ${git.subcommand}\` throws away what git keeps to recover lost work, in every checkout of the repository, so it always asks.`,
              'outside',
              'floor',
            ),
          ]
        : []
    }
    default:
      return []
  }
}

/** What `git checkout` may take that changes no file, beside the branch it switches to and the name `-b`, `-B` or `--orphan` makes. */
const CHECKOUT_SWITCHES =
  /^(-q|--quiet|--progress|--no-progress|--detach|-t|--track(=.*)?|--no-track|--guess|--no-guess|--recurse-submodules|--no-recurse-submodules)$/

/**
 * Whether `git checkout` only switches branch, which never overwrites a
 * change: to one branch at most, by a name that can't be a file there. A name
 * git could read as a file (`README.md`, `src`, `*.ts`), or anything else it
 * takes, could put back files over what the checkout's owner changed.
 */
const onlySwitches = (args: ReadonlyArray<string>, isPath: (name: string) => boolean): boolean => {
  const names: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (['-b', '-B', '--orphan'].includes(arg)) index += 1
    else if (arg !== '-' && arg.startsWith('-')) {
      if (!CHECKOUT_SWITCHES.test(arg)) return false
    } else names.push(arg)
  }
  const [name] = names
  return names.length <= 1 && (name === undefined || name === '-' || (/^\w[\w/-]*$/.test(name) && !isPath(name)))
}

/**
 * Whether a git command throws away work in the checkout it runs in: changes
 * not committed, files it doesn't track, a stash. `isPath` says whether a name
 * is a file or folder there.
 */
const discards = (git: GitCall, isPath: (name: string) => boolean): boolean => {
  const { subcommand, args } = git
  switch (subcommand) {
    case 'reset':
      return args.includes('--hard')
    case 'clean':
      return hasFlag(args, '-f', '--force')
    case 'checkout':
      return !onlySwitches(args, isPath)
    case 'switch':
      return hasFlag(args, '-f', '--force', '--discard-changes')
    case 'restore':
      return !hasFlag(args, '-S', '--staged') || hasFlag(args, '-W', '--worktree')
    case 'stash':
      return !['list', 'show'].includes(args[0] ?? '')
    case 'rm':
      return true
    default:
      return false
  }
}

/** One command of a line, and what of it the rules keep for the person: every kind, and those of where its output goes. */
interface CommandKinds {
  readonly words: ReadonlyArray<string>
  readonly kinds: ReadonlyArray<Kept>
  /** Writes outside the worktree its redirects make, which no rule for the command itself covers. */
  readonly redirected: ReadonlyArray<Kept>
}

/** Each command of a line, as the shell would run them, with every kind each one is. */
const eachCommand = (text: string, context: RuleContext): { readonly opaque: boolean; readonly commands: ReadonlyArray<CommandKinds> } => {
  const where = places(context)
  const lines = lineReadings(text, where.system)
  const each: Array<CommandKinds> = []
  const following: Following = {
    resolve: (from, path) => locate(where, from ?? context.worktree, path),
    paths: where.system.paths,
    folder: where.folder,
    unknown: where.system.paths.parse(where.system.home).root,
    unsettled: (word) => unsettled(word, where),
  }
  for (const line of lines)
    walkFolders(line, context.worktree, following, (written, folders) => {
      const kinds: Array<Kept> = []
      const redirected: Array<Kept> = []
      const unseenKinds: Array<Kept> = []
      for (const { at = context.worktree, blind: unseen, guessed } of folders)
        for (const words of readings(written)) {
          const found = kindsOf(words, at, where, context, guessed === true)
          // Blind only where it is the folder that makes it so: `rm -rf ~/Documents` is that from anywhere.
          const anywhere = unseen ? kindsOf(words, context.worktree, where, context).kinds.map((one) => JSON.stringify(one)) : []
          const read = unseen
            ? found.kinds.map((one) => (anywhere.includes(JSON.stringify(one)) ? one : { ...one, blind: true }))
            : found.kinds
          kinds.push(...read.filter((one) => !kinds.some((other) => JSON.stringify(other) === JSON.stringify(one))))
          redirected.push(...found.redirected.filter((one) => !redirected.some((other) => JSON.stringify(other) === JSON.stringify(one))))
          if (unseen) unseenKinds.push(...found.kinds)
        }
      const blind = floorOf(unseenKinds)
      if (blind !== undefined)
        kinds.unshift(kept("Althar can't tell which folder `cd` goes to until it runs, so it asks.", 'unclear', blind))
      each.push({ words: written, kinds, redirected })
    })
  return { opaque: lines.some((line) => line.opaque), commands: each }
}

/** Where a `cd` goes, as its words say, past its options (`cd -P x`, cmd's `cd /d D:\\x`); none for home. */
const cdTarget = (words: ReadonlyArray<string>): string | undefined => {
  const [first, ...rest] = words.filter(
    (word, index) => index > 0 && !REDIRECTS.includes(word) && !REDIRECTS.includes(words[index - 1] ?? ''),
  )
  return first !== undefined && (/^-[PLe@]+$|^--$/.test(first) || (/^\/d$/i.test(first) && rest.length > 0))
    ? cdTarget(['cd', ...rest])
    : first
}

/** A folder a command could run in, and whether it got there by a `cd` Althar can't read until it runs. */
interface Folder {
  /** None where the folder the line started in isn't known. */
  readonly at: string | undefined
  readonly blind: boolean
  /**
   * Reached from where the line starts by relative `cd`s alone, or none: a
   * folder the rules read from the worktree's top, where the shell may not be.
   */
  readonly guessed?: boolean
}

/** How to follow a line's `cd`s. */
interface Following {
  /** Where a `cd` to a path goes from a folder; none where that isn't known. */
  readonly resolve: (from: string | undefined, path: string) => string | undefined
  readonly paths: System['paths']
  /** Whether a folder is there, so a `cd` to it can't fail and leave the shell where it was. */
  readonly folder: (path: string) => boolean
  /** Where a `cd` that shows only when it runs is read as going: the root of the disk, the worst it could be. */
  readonly unknown: string
  /** Whether a word is worked out only when the command runs (`unsettled`). */
  readonly unsettled: (word: string) => boolean
}

const distinct = (folders: ReadonlyArray<Folder>): Array<Folder> => [
  ...new Map(folders.map((one) => [`${one.blind}\0${one.guessed === true}\0${one.at}`, one])).values(),
]

/**
 * Walks a line's commands with every folder each could run in, so a `cd`
 * the shell may skip doesn't hide where what follows runs: one after `&&`
 * or `||`, in an `if`, a loop, a `case` or a function, to a folder that
 * isn't there; one in a subshell holds only there; `cd -` and `popd` go
 * back to any folder it was in; a function's or an alias's may come back
 * whenever it's called.
 */
const walkFolders = (
  { commands, scopes }: Parsed,
  start: string | undefined,
  following: Following,
  visit: (written: ReadonlyArray<string>, folders: ReadonlyArray<Folder>) => void,
): ReadonlyArray<Folder> => {
  const unknown: Folder = { at: following.unknown, blind: true }
  // Where the command before succeeded and where it failed, which `&&` and `||` pick between.
  let ok: ReadonlyArray<Folder> = [{ at: start, blind: false, guessed: true }]
  let failed: ReadonlyArray<Folder> = []
  // Every folder the line has been in, where `cd -` and `popd` go back to.
  let seen: ReadonlyArray<Folder> = ok
  // Where a function or an alias with a `cd` may go whenever it's called.
  let called: ReadonlyArray<Folder> = []
  const started: Array<ReadonlyArray<Folder>> = []
  commands.forEach((written, index) => {
    const scope = scopes?.[index] ?? NO_SCOPE
    const all = distinct([...ok, ...failed, ...called])
    for (let opened = 0; opened < scope.opens; opened += 1) started.push(all)
    const picked = distinct([...(scope.joined === '&&' ? ok : scope.joined === '||' ? failed : all), ...called])
    const folders = picked.length > 0 ? picked : all
    visit(written, folders)
    const program = (written[0] ?? '').toLowerCase()
    const back = ['popd', 'pop-location'].includes(program)
    const aliased = program === 'alias' && /\b(cd|pushd|popd|chdir)\b/.test(written.join(' '))
    const cds = readings(written).filter((words) => words[0] === 'cd')
    let landed: ReadonlyArray<Folder> = folders
    let certain = !back && !aliased
    if (back) landed = seen
    else if (aliased) landed = [unknown]
    else if (cds.length > 0)
      landed = distinct(
        cds.flatMap((words) => {
          const target = cdTarget(words)
          if (target !== undefined && /^(-|[-+]\d+)$/.test(target)) {
            certain = false
            return seen
          }
          if (target !== undefined && following.unsettled(target)) {
            certain = false
            return [unknown]
          }
          const path = target ?? '~'
          const relative = !following.paths.isAbsolute(path.replace(HOME_WORD, '/').replace(TEMP_WORD, '/'))
          const went = folders.map(({ at, blind, guessed }) => ({
            at: following.resolve(at, path),
            blind: blind && relative,
            guessed: guessed === true && relative,
          }))
          if (!went.every(({ at }) => at !== undefined && following.folder(at))) certain = false
          // A loop or a function may take a relative `cd` many times: `cd ..` again and again.
          return [...went, ...(scope.repeats === true && relative ? [unknown] : [])]
        }),
      )
    const moves = back || aliased || cds.length > 0
    const may = scope.maybe === true || aliased
    if (moves && (scope.called === true || aliased)) called = distinct([...called, ...landed])
    const succeeded = moves ? distinct([...landed, ...(may ? folders : [])]) : folders
    const failing = moves && certain && !may ? [] : folders
    ok = scope.joined === '||' ? distinct([...ok, ...succeeded]) : succeeded
    failed = scope.joined === '&&' ? distinct([...failed, ...failing]) : failing
    for (let closed = 0; closed < scope.closes; closed += 1) {
      const before = started.pop()
      if (before === undefined) break
      // A subshell's `cd` ends with it; a pipe's last side may keep it.
      const keeps = scope.keeps === true && closed === scope.closes - 1
      ok = keeps ? distinct([...before, ...ok, ...failed]) : before
      failed = ok
    }
    seen = distinct([...seen, ...ok, ...failed])
  })
  return distinct([...ok, ...failed, ...called])
}

/** Every kind one command is, read one way, from the folder it runs in; and, for a `cd`, where it goes. */
const kindsOf = (
  words: ReadonlyArray<string>,
  cwd: string,
  where: Places,
  context: RuleContext,
  /** Whether `cwd` is where the rules guess the shell is: `Folder`'s `guessed`. */
  guessed = false,
): { readonly kinds: ReadonlyArray<Kept>; readonly redirected: ReadonlyArray<Kept>; readonly cwd?: string } => {
  const follow = context.realPath ?? realpathSync
  // Where its output goes, whatever the command: `git status > ~/.zshrc`, `cd . > ~/.zshrc`, from where it runs.
  const redirected = redirects(words)
    .filter((path) => outside(where, locate(where, cwd, path)))
    .slice(0, 1)
    .map((path) => kept(`Writing outside the task's worktree always asks: ${path}`, 'outside'))
  const kinds: Array<Kept> = [...redirected]
  const done = (moved?: string) => {
    // What it could be once it runs, where that is firmer than what it is as written.
    if (floorOf(kinds) !== 'irreversible') {
      const hidden = floorOf(unseenReadings(words, where, context).flatMap((each) => kindsOf(each, cwd, where, context).kinds))
      if (hidden !== undefined && hidden !== floorOf(kinds))
        kinds.push(kept(`Althar can't tell what \`${programNamed(words)}\` acts on until it runs, so it asks.`, 'unclear', hidden))
    }
    return { kinds, redirected, ...(moved === undefined ? {} : { cwd: moved }) }
  }
  if (commandsIn(words).some(deploys)) kinds.push(kept('Deploying or publishing always asks.', 'deploy'))
  if (words[0] === 'cd') return done(locate(where, cwd, cdTarget(words) ?? '~'))
  const git = gitCall(words, cwd, where.system.paths)
  if (git !== undefined) {
    const repository = [locate(where, cwd, git.cwd), ...git.elsewhere.map((path) => locate(where, cwd, path))]
    const elsewhere = repository.find((path) => outside(where, path))
    if (elsewhere !== undefined) {
      kinds.push(kept(`Git in another folder always asks: ${elsewhere}`, 'outside'))
      // The person's own checkout, say: what they haven't committed there is nowhere else.
      const isPath = (name: string) =>
        repository.some((folder) => {
          try {
            follow(where.system.paths.resolve(folder, name))
            return true
          } catch {
            return false
          }
        })
      // In a folder that is there but in no checkout, git has no work to throw away: it fails. Not the root of the disk, which
      // stands for a folder the rules can't tell.
      const noCheckout =
        elsewhere !== where.system.paths.parse(where.system.home).root &&
        where.folder(elsewhere) &&
        checkoutOf(where, elsewhere) === undefined
      if (!noCheckout && discards(git, isPath))
        kinds.push(
          kept(
            `\`git ${git.subcommand}\` in another checkout always asks: it could throw away work there: ${elsewhere}`,
            'outside',
            'irreversible',
          ),
        )
    }
    kinds.push(...(git.subcommand === 'push' ? pushKinds(git.args, context) : gitKinds(git, context)))
    if (git.subcommand === 'worktree' || git.subcommand === 'clone') {
      const target = writes([
        'touch',
        ...git.args.filter((arg) => !['add', 'remove', 'prune', 'move', 'lock', 'unlock'].includes(arg)),
      ]).find((path) => outside(where, locate(where, cwd, path)))
      if (target !== undefined)
        kinds.push(
          git.subcommand === 'worktree' && git.args.includes('remove')
            ? kept(
                `Removing a worktree that isn't the task's always asks: what isn't committed there is nowhere else: ${target}`,
                'outside',
                'irreversible',
              )
            : kept(`Writing outside the task's worktree always asks: ${target}`, 'outside'),
        )
    }
    return done()
  }
  if (commandsIn(words).some(installsGlobally)) kinds.push(kept('Installing on this computer, outside the task, always asks.', 'outside'))
  // What it deletes or moves away outside the worktree could be anyone's work: the person's own checkout, their documents.
  const removed = commandsIn(words)
    .flatMap(removes)
    .filter((path) => outside(where, locate(where, cwd, path)))
  // What isn't there when it asks loses no one anything: the line made it itself, or it runs from a folder the shell never reaches.
  const gone = removed.find((path) => !missing(where, path, locate(where, cwd, path), guessed))
  const absent = removed[0]
  const target = writes(words)
    .filter((path) => !redirects(words).includes(path))
    .find((path) => outside(where, locate(where, cwd, path)))
  const replaced = commandsIn(words)
    .flatMap((each) => overwrites(each, where, cwd))
    .find((path) => outside(where, locate(where, cwd, path)) && checkoutOf(where, locate(where, cwd, path)) !== undefined)
  if (gone !== undefined)
    kinds.push(
      kept(
        `Deleting or moving away what's outside the task's worktree always asks: it could be someone's only copy: ${gone}`,
        'outside',
        'irreversible',
      ),
    )
  else if (absent !== undefined)
    kinds.push(kept(`Deleting or moving away what's outside the task's worktree always asks: ${absent}`, 'outside'))
  else if (replaced !== undefined) kinds.push(changesCheckout(replaced))
  else if (target !== undefined) kinds.push(kept(`Writing outside the task's worktree always asks: ${target}`, 'outside'))
  // A project's secrets, in a `.env` file the task doesn't own: the person's checkout's, say.
  const env = words
    .slice(1)
    .flatMap(pathsInWord)
    .find((path) => envFile(path) && outside(where, locate(where, cwd, path)))
  if (env !== undefined) kinds.push(envKept(env))
  return done()
}

/** A command's program by name, and what `xargs` runs: `xargs rm`. */
const programNamed = (words: ReadonlyArray<string>) => {
  const [program = ''] = unwrap(words)
  const xargs = xargsRuns(unwrap(words))?.[0]
  return [program, xargs]
    .filter((each) => each !== undefined)
    .map((each) => each.split('/').at(-1))
    .join(' ')
}

/**
 * A command as it could run where its words are worked out only then: what
 * `xargs` adds from its input, and each such word, standing for the root of
 * the disk or the default branch, the worst each could be. None where the
 * rules can read all of it.
 */
const unseenReadings = (words: ReadonlyArray<string>, where: Places, context: RuleContext): ReadonlyArray<ReadonlyArray<string>> => {
  const xargs = xargsRuns(unwrap(words))
  if (!words.some((word) => unsettled(word, where)) && xargs === undefined) return []
  return [where.system.paths.parse(where.system.home).root, context.defaultBranch].map((worst) => {
    const read = words.map((word) => (unsettled(word, where) ? worst : word))
    return xargs === undefined ? read : [...(xargsRuns(unwrap(read)) ?? []), worst]
  })
}

/** What a command line does that the rules keep for the person: every kind, in every command of it. */
const commandKinds = (text: string, context: RuleContext): ReadonlyArray<Kept> => {
  const { commands, opaque } = eachCommand(text, context)
  // What a quoted heredoc holds is text: words in it say nothing of what the command does.
  const read = withoutQuotedHeredocs(text)
  return [
    ...(opaque && /\bpush\b|\bdeploy\b|\bpublish\b|\bmerge\b/.test(read)
      ? [
          kept(
            `Althar can't tell what this command does until it runs, so it asks.`,
            'unclear',
            /\bpush\b/.test(read) ? 'irreversible' : undefined,
          ),
        ]
      : []),
    ...commands.flatMap((command) => command.kinds),
  ]
}

/** Escapes a string for a regular expression. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a command's words start as a project's pattern says: its words in
 * order, `*` for anything. A program is matched by its name, wherever it
 * lives: `npm publish` matches `/usr/local/bin/npm publish --tag next`, not
 * `npm publisher`.
 */
export const matchesPattern = (pattern: string, words: ReadonlyArray<string>): boolean => {
  const [program = '', ...rest] = words
  const line = [program.slice(program.lastIndexOf('/') + 1), ...rest].join(' ')
  // A word that is only `*` stands for any words, or none: `psql *` matches `psql` too.
  const source = pattern
    .trim()
    .split(/\s+/)
    .map((part, index) => (part === '*' ? '(?: .*)?' : `${index === 0 ? '' : ' '}${part.split('*').map(literal).join('.*')}`))
    .join('')
  return new RegExp(`^${source}(?: .*)?$`).test(line)
}

/** Whether a line names a program as a word of its own, wherever it lives: `npm` in `$(npm …)`, not in `pnpm`. */
const namesProgram = (text: string, program: string) =>
  program !== '' && new RegExp(`(^|[\\s/;&|()$\`"'])${literal(program)}(?=$|[\\s;&|()\`"'])`).test(text)

/** Whether a command starts as a rule's pattern says: as itself, or as what a package runner or interpreter runs for it. */
const startsAs = (pattern: string, words: ReadonlyArray<string>) => commandsIn(words).some((each) => matchesPattern(pattern, each))

/**
 * The project's command rule a command line meets that asks or refuses, a
 * refusal before an ask: an exact rule by the whole line; a rule by how a
 * command starts by each command in it, read on its own, as a shell would
 * run it, and as what a package runner runs for it (`npx prisma …`). A line
 * whose commands only show when it runs, that names a pattern's program,
 * meets that pattern.
 */
const commandRule = (text: string, rules: ProjectRuleSet['commands'], system: System) => {
  const lines = lineReadings(text, system)
  const commands = lines.flatMap((line) => line.commands.flatMap(readings))
  const opaque = lines.some((line) => line.opaque)
  const met = rules.filter((rule) =>
    rule.decision === 'allow'
      ? false
      : exactly(rule)
        ? text.trim() === rule.pattern
        : commands.some((words) => startsAs(rule.pattern, words)) ||
          (opaque && namesProgram(withoutQuotedHeredocs(text), rule.pattern.trim().split(/\s+/)[0] ?? '')),
  )
  return met.find((rule) => rule.decision === 'never') ?? met[0]
}

/**
 * Whether the project has someone answer whatever goes beyond reads and the
 * task's own files: the person (`ask`), or the coordinator (`coordinator`),
 * so an allow rule there lets through what would otherwise ask or be judged.
 */
const everyRunAnswered = (project: ProjectRuleSet) => project.mode === 'ask' || project.mode === 'coordinator'

/**
 * The allow rules that cover what would make a request ask (ADR-018), or
 * none where they don't cover all of it. A command line is covered by an
 * exact rule as a whole, or command by command: each that would ask starts
 * as an allow rule says, or is only of kinds the project always allows. A
 * command that only changes folder or only looks rides along with the rest,
 * as reads do. A line whose commands only show when it runs is never
 * covered: what it would run isn't known. Anything else is covered by the
 * kinds it is, every one of them always allowed.
 */
const allowedBy = (
  request: PermissionRequest,
  context: RuleContext,
  project: ProjectRuleSet,
  found: ReadonlyArray<Kept>,
): ReadonlyArray<AllowRule> | undefined => {
  const rules = project.commands.filter((rule) => rule.decision === 'allow')
  if (rules.length === 0 && project.allow.length === 0) return undefined
  const byKinds = (kinds: ReadonlyArray<Kept>): ReadonlyArray<AllowRule> | undefined =>
    kinds.length > 0 && kinds.every((each) => each.rule !== 'unclear' && project.allow.includes(each.rule))
      ? kinds.flatMap((each) => (each.rule === 'unclear' ? [] : [{ kind: each.rule }]))
      : undefined
  if (request.kind !== 'execute' && request.kind !== 'other') return byKinds(found)
  const text = commandOf(request)
  const { commands, opaque } = eachCommand(text, context)
  if (opaque) return undefined
  const whole = rules.find((rule) => exactly(rule) && rule.pattern === text.trim())
  if (whole !== undefined) return [{ pattern: whole.pattern, match: 'exact' }]
  const used: Array<AllowRule> = []
  for (const { words, kinds, redirected } of commands) {
    // Changing folder, or where a shell's output goes, runs nothing: only what it writes outside counts.
    const bare = words[0] === 'cd' || onlyRedirects(words)
    // Under "Ask me", or where the coordinator decides, every command that runs something needs an answer; otherwise only what the rules can't tell.
    const asks = everyRunAnswered(project) ? !bare || kinds.length > 0 : kinds.some((each) => each.rule === 'unclear')
    if (!asks) continue
    const rule = bare ? undefined : rules.find((each) => !exactly(each) && startsAs(each.pattern, words))
    // A rule covers how a command starts, never where its output goes: that is a write like any other.
    const output = redirected.length === 0 ? [] : byKinds(redirected)
    if (rule !== undefined && output !== undefined) {
      used.push({ pattern: rule.pattern, match: 'prefix' }, ...output)
      continue
    }
    // One that only looks needs no rule of its own beside the rest.
    if (everyRunAnswered(project) && !bare && readerWordsReason(words) === undefined) continue
    const covered = byKinds(kinds)
    if (covered === undefined) return undefined
    used.push(...covered)
  }
  // Each rule once, in the order it was met.
  const once = used.filter((rule, index) => used.findIndex((other) => JSON.stringify(other) === JSON.stringify(rule)) === index)
  return once.length === 0 ? undefined : once
}

const CHANGES: ReadonlyArray<PermissionRequest['kind']> = ['edit', 'delete', 'move']

/** What the rules keep for the person in a request, whatever the project says of it: every kind it is, and why. */
const keptOf = (request: PermissionRequest, context: RuleContext): ReadonlyArray<Kept> => {
  if (request.kind === 'execute' || request.kind === 'other') return commandKinds(commandOf(request), context)
  const paths = pathsOf(request)
  // A `.env` file the task doesn't own, read or changed: the person's checkout's, say.
  const envs = paths.filter(envFile)
  const env = envs.length === 0 ? undefined : envs.find((path) => outside(places(context), locate(places(context), context.worktree, path)))
  const secrets = env === undefined ? [] : [envKept(env)]
  if (CHANGES.includes(request.kind)) {
    if (paths.length === 0)
      return [kept(`Althar can't tell where this ${request.kind === 'edit' ? 'edit writes' : 'change goes'}, so it asks.`, 'unclear')]
    const where = places(context)
    const escaping = paths.filter((path) => outside(where, locate(where, context.worktree, path)))
    // Any of them in another checkout, wherever it comes in the edit: a new file first doesn't hide it.
    const replaced = escaping.find((path) => checkoutOf(where, locate(where, context.worktree, path)) !== undefined)
    const [first] = escaping
    if (first !== undefined)
      return [
        ...secrets,
        // Deleting or moving away what's outside could be anyone's work; an edit there only writes.
        request.kind !== 'edit'
          ? kept(
              `Deleting or moving away what's outside the task's worktree always asks: it could be someone's only copy: ${first}`,
              'outside',
              'irreversible',
            )
          : replaced !== undefined
            ? changesCheckout(replaced)
            : kept(`Writing outside the task's worktree always asks: ${first}`, 'outside'),
      ]
  }
  return secrets
}

/** Why what can't be undone asks with everything allowed, in the card's one line. */
const evenAllowed = (reason: string) => reason.replace(/ always asks/, ' asks even with everything allowed')

/**
 * What can't be undone in a request with everything allowed (ADR-067's
 * amendment): only what the rules read as that. Not what they can't tell
 * (`Kept`'s `unclear`, or what is only the worst a folder it can't tell
 * could be, `blind`), nor the words of a script in a language other than
 * the shell's (`python3 - <<'EOF'`).
 */
const lastingOf = (request: PermissionRequest, context: RuleContext): Kept | undefined => {
  const lasting = (kinds: ReadonlyArray<Kept>) =>
    kinds.find((each) => each.irreversible === true && each.rule !== 'unclear' && each.blind !== true)
  if (request.kind !== 'execute' && request.kind !== 'other') return lasting(keptOf(request, context))
  return lasting(commandKinds(withoutQuotedHeredocs(commandOf(request), takesScript), context))
}

/** Kinds whose floor is only part of them, so a choice about the kind isn't one about what could lose work: writes outside are mostly harmless. */
const BROADER_THAN_FLOOR: ReadonlyArray<Kept['rule']> = ['outside', 'unclear']

/** Kinds of request that only look, which even a project that asks about everything lets through. */
const LOOKS: ReadonlyArray<PermissionRequest['kind']> = ['read', 'search', 'think']

/**
 * Decides a permission request from the rules and the project's (ADR-013).
 * What no project can change comes first: a code host is reached only
 * through Althar, and no one reads credentials, in the keychain or in the
 * files people keep them in. A request can be several kinds at once (`git
 * push --force origin main` is a force push and a push to the default
 * branch), and every kind counts. Then, in order:
 * - what the project never allows is refused: any kind it is, or a command
 *   the project named;
 * - with everything allowed, anything else is allowed, short of what the
 *   rules can't read where the project never allows something: that is
 *   refused, with how to run it so they can; and short of what the rules
 *   read as what can't be undone from the task (`lastingOf`, ADR-067),
 *   which asks the person;
 * - a kind on the always-ask list, or a command the project asks about, is
 *   held for the person, whatever else would answer;
 * - what could lose work or a secret asks the person where the project would
 *   otherwise have the coordinator judge it or let a read through, unless
 *   its kind is always allowed;
 * - what would ask otherwise (what the rules can't tell, or, where the
 *   project asks about everything or has the coordinator decide, anything
 *   but reads and changes to the task's own files, which every agent's
 *   sandbox keeps) is let through where the project's allow rules cover it
 *   (ADR-018), saying which;
 * - where the coordinator decides, it judges the rest of that, but for
 *   what the rules can't tell (ADR-019);
 * - the rest of that waits for the person;
 * - anything else is allowed.
 */
export const decide = (request: PermissionRequest, context: RuleContext): Verdict => {
  const project = context.project ?? MVP_RULES
  const system = systemOf(context)
  const named =
    request.kind === 'execute' || request.kind === 'other' ? commandRule(commandOf(request), project.commands, system) : undefined
  if (request.kind === 'execute' || request.kind === 'other') {
    // A code host is reached through Althar: `gh` and `glab` only look, and no one reads credentials, wherever they are in the command.
    const refused = lineReadings(commandOf(request), system)
      .flatMap((line) => line.commands.flatMap((words) => readings(unwrap(words))))
      .map((words) => credentialReason(words) ?? hostReason(words) ?? deviceBridgeReason(words))
      .find((reason) => reason !== undefined)
    if (refused !== undefined) return { verdict: 'deny', reason: refused }
  }
  // Nor the files people keep keys and sign-ins in, whatever the request does with them.
  const secret = secretReason(request, context.worktree, system)
  if (secret !== undefined) return { verdict: 'deny', reason: secret }
  if (named?.decision === 'never') return { verdict: 'deny', reason: `The project's rules never allow \`${named.pattern.trim()}\`.` }
  const found = keptOf(request, context)
  const never = found.find((each) => each.rule !== 'unclear' && project.never.includes(each.rule))
  if (never !== undefined && never.rule !== 'unclear')
    return { verdict: 'deny', reason: `The project's rules never allow ${RULE_WORDS[never.rule]}.` }
  const unclear = found.find((each) => each.rule === 'unclear')
  if (project.mode === 'allow') {
    // With no one to ask, what the rules can't read can't be let past what is never allowed.
    const neverAny = project.never.length > 0 || project.commands.some((rule) => rule.decision === 'never')
    if (unclear !== undefined && neverAny)
      return {
        verdict: 'deny',
        reason: `${unclear.reason.replace(/,? so it asks\.$/, '.')} The project's rules never allow some things, so it's refused: run it with its words spelled out, without \`eval\` or \`$(…)\`, naming the branch or file.`,
      }
    // What can't be undone from the task still asks, where the rules read it as that: allowing everything is for what the person
    // could take back if it went wrong, and trusts the agent with what the rules can't read.
    const lasting = lastingOf(request, context)
    return lasting === undefined ? ALLOW : ask(evenAllowed(lasting.reason), false)
  }
  const asked = found.find((each) => each.rule === 'unclear' || project.ask.includes(each.rule))
  // What always asks waits for the person, whatever the allow rules say.
  if (asked !== undefined && found.some((each) => each.rule !== 'unclear' && project.ask.includes(each.rule)))
    return ask(asked.reason, true)
  if (named !== undefined) return ask(asked?.reason ?? `The project's rules ask before \`${named.pattern.trim()}\`.`, true)
  // What could lose work or a secret is the person's to answer, not the coordinator's, unless they always allow its kind; where
  // the project lets the rest through ("Allowed"), a kind taken off the always-ask list is the person's own choice. Not for a
  // kind that is more than that: allowing writes outside the worktree isn't allowing `rm -rf` of the person's checkout.
  const floor = found.find(
    (each) =>
      each.floor === true &&
      (each.rule === 'unclear' ||
        BROADER_THAN_FLOOR.includes(each.rule) ||
        (project.mode !== 'rules' && !project.allow.includes(each.rule))),
  )
  if (floor !== undefined) return ask(floor.reason, false)
  // Reads, and changes to the task's own files, go through, as they would in any agent's sandbox.
  const ownFiles = CHANGES.includes(request.kind) && found.length === 0
  const routine = LOOKS.includes(request.kind) || ownFiles
  const reason =
    asked?.reason ??
    (everyRunAnswered(project) && !routine
      ? project.mode === 'coordinator'
        ? 'The coordinator decides within the project rules.'
        : "This project asks you before anything an agent does beyond the task's own files."
      : undefined)
  if (reason === undefined) return ALLOW
  // An allow rule answers before anyone is asked, the coordinator too: no judgment is spent on what a rule covers.
  const rules = allowedBy(request, context, project, found)
  if (rules !== undefined) return { verdict: 'allow', rules }
  // What the rules can't tell waits for the person; the rest the coordinator judges, where the project has it decide.
  if (asked === undefined && project.mode === 'coordinator') return { verdict: 'judge', reason }
  return ask(reason, false)
}

/** How far an "always" answer reaches (ADR-018): this exact command, commands that start the same way, or the kind it is. */
export type AlwaysScope = 'exact' | 'prefix' | 'kind'

/** A rule an "always" answer keeps: a kind, or a command by how it starts or exactly, let through or never allowed. */
export type AlwaysRule =
  | { readonly decision: 'allow' | 'never'; readonly kind: RuleId }
  | { readonly decision: 'allow' | 'never'; readonly pattern: string; readonly match: 'prefix' | 'exact' }

/** The project's rules with an always rule among them. */
const withAlways = (project: ProjectRuleSet, rule: AlwaysRule): ProjectRuleSet => {
  if (!('kind' in rule))
    return {
      ...project,
      commands: [
        ...project.commands,
        { pattern: rule.pattern, decision: rule.decision, ...(rule.match === 'exact' ? { match: 'exact' as const } : {}) },
      ],
    }
  return rule.decision === 'allow'
    ? { ...project, allow: [...project.allow, rule.kind] }
    : { ...project, never: [...project.never, rule.kind] }
}

/**
 * Whether an always rule would hold for a request under the rules as the
 * context has them: an allow rule only where it would let it through, a
 * never rule where it would refuse it.
 */
export const holds = (request: PermissionRequest, context: RuleContext, rule: AlwaysRule): boolean => {
  const verdict = decide(request, { ...context, project: withAlways(context.project ?? MVP_RULES, rule) })
  return rule.decision === 'allow' ? verdict.verdict === 'allow' && verdict.rules !== undefined : verdict.verdict === 'deny'
}

/** What an "always" answer to a request would keep in the project's rules, and the scopes each answer holds for. */
export interface Always {
  /** The command, as an exact rule keeps it; none where it runs none, or is too long to keep. */
  readonly command: string | null
  /** How its command starts, as a rule by its start keeps it; none where nothing reads as one. */
  readonly prefix: string | null
  /** The kind it is, the first the rules found. */
  readonly kind: RuleId | null
  /** The scopes an allow rule would let it through by next time; none where something else keeps it for the person. */
  readonly allow: ReadonlyArray<AlwaysScope>
  /** The scopes a never rule would refuse it by. */
  readonly deny: ReadonlyArray<AlwaysScope>
}

/** Programs whose first word is a subcommand: without one, how a command starts says too little to keep. */
const SUBCOMMANDED = new Set([
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'bunx',
  'pnpx',
  'uvx',
  'docker',
  'kubectl',
  'cargo',
  'go',
  'uv',
  'deno',
  'make',
  'just',
])

/**
 * How a command starts, as a rule would keep it: its program by name, and
 * its subcommand where it has one (`git status`, `bun test`), or the
 * script an interpreter runs (`node scripts/build.js`). None where only
 * the program would be left of a tool with subcommands, which says too
 * little: `git -C sub status`.
 */
const prefixOf = (words: ReadonlyArray<string>): string | null => {
  const [program = '', next] = words
  const name = program.slice(program.lastIndexOf('/') + 1)
  if (name === '') return null
  if (INTERPRETERS.includes(name)) return next !== undefined && !next.startsWith('-') ? `${name} ${next}` : null
  if (next !== undefined && /^[a-z][a-z-]{0,22}[a-z0-9]?$/.test(next)) return `${name} ${next}`
  return SUBCOMMANDED.has(name) ? null : name
}

/**
 * What Allow always and Deny always would keep for a request that waits
 * (ADR-018), and the scopes each would hold for: an allow rule only where
 * it would let this request through next time, and a never rule where it
 * would refuse it. The command an always is about is the first that keeps
 * the line for the person, else the first that runs something.
 */
export const alwaysOf = (request: PermissionRequest, context: RuleContext): Always => {
  const project = context.project ?? MVP_RULES
  const runs = request.kind === 'execute' || request.kind === 'other'
  const text = runs ? commandOf(request).trim() : ''
  const command = text !== '' && text.length <= COMMAND_KEPT ? text : null
  const found = keptOf(request, context)
  const kind = found.flatMap((each) => (each.rule === 'unclear' ? [] : [each.rule]))[0] ?? null
  const commands = runs ? eachCommand(text, context).commands.filter((each) => each.words[0] !== 'cd' && !onlyRedirects(each.words)) : []
  const named = (words: ReadonlyArray<string>) =>
    project.commands.some((rule) => rule.decision !== 'allow' && !exactly(rule) && startsAs(rule.pattern, words))
  const subject =
    commands.find((each) => each.kinds.length > 0 || named(each.words)) ??
    commands.find((each) => readerWordsReason(each.words) !== undefined) ??
    commands[0]
  const prefix = subject === undefined ? null : prefixOf(subject.words)
  const always: Omit<Always, 'allow' | 'deny'> = { command, prefix, kind }
  const scopes = (decision: 'allow' | 'never'): ReadonlyArray<AlwaysScope> =>
    (['exact', 'prefix', 'kind'] as const).filter((scope) => {
      const rule = alwaysRuleOf(always, decision, scope)
      return rule !== undefined && holds(request, context, rule)
    })
  return { ...always, allow: scopes('allow'), deny: scopes('never') }
}

/** The rule an "always" by a scope would keep, by the words a call was offered: none where it has none for that scope. */
export const alwaysRuleOf = (
  always: Pick<Always, 'command' | 'prefix' | 'kind'>,
  decision: 'allow' | 'never',
  scope: AlwaysScope,
): AlwaysRule | undefined => {
  switch (scope) {
    case 'exact':
      return always.command === null ? undefined : { decision, pattern: always.command, match: 'exact' }
    case 'prefix':
      return always.prefix === null ? undefined : { decision, pattern: always.prefix, match: 'prefix' }
    case 'kind':
      return always.kind === null ? undefined : { decision, kind: always.kind }
  }
}

// ---- Roles that only read ----------------------------------------------------

/*
 * A role that only reads, such as the coordinator (docs/architecture/04) or a
 * reviewer, is never asked about and never asks: what it may do, it does, and
 * the rest is refused with a reason it reads. It may read anything, search,
 * fetch from the web, and run commands that only look. It may call
 * Althar's own tools, which are how it changes anything. Every write, and
 * every command that could write, is refused. A change is a task.
 */

export type ReaderVerdict = { readonly verdict: 'allow' } | { readonly verdict: 'deny'; readonly reason: string }

const deny = (reason: string): ReaderVerdict => ({ verdict: 'deny', reason })

/** Althar's own tools, as each agent names them: `mcp__althar__…` (Claude Code), `mcp.althar.…` (Codex), `althar_…` (OpenCode). */
export const ALTHAR_TOOL = /^(mcp__althar__|mcp\.althar\.|althar_)/

/**
 * The flags a program may take in a reader's command, when some of its flags
 * write or run another program (`rg --pre`, `fd -x`, `sort -o`). A flag not
 * listed refuses the command: a list of what may run stays right as programs
 * grow flags, where a list of what may not keeps missing some.
 */
interface Flags {
  /** Short flags, one letter each, which may be combined: `-la`. */
  readonly short?: string
  /** Short flags that take a value, joined or as the next word: `-g '*.ts'`, `-g*.ts`. */
  readonly shortWithValue?: string
  /** Long flags, with or without `=value`. */
  readonly long?: ReadonlyArray<string>
  /** Long flags whose value is the next word when it isn't joined with `=`. */
  readonly longWithValue?: ReadonlyArray<string>
  /** The most operands it may take: one more is where some programs write. */
  readonly operands?: number
}

/**
 * Programs a reader may run. `any` marks those with no flag that writes or
 * runs another program, which may take any flag; the others list theirs. Git,
 * `find`, `sed`, `printf` and `test` are read more closely below.
 */
const READS: Readonly<Record<string, Flags | 'any' | 'git' | 'find' | 'sed' | 'env' | 'printf' | 'test'>> = {
  ls: 'any',
  cat: 'any',
  head: 'any',
  tail: 'any',
  wc: 'any',
  grep: 'any',
  egrep: 'any',
  fgrep: 'any',
  stat: 'any',
  pwd: 'any',
  echo: 'any',
  printf: 'printf',
  which: 'any',
  cut: 'any',
  tr: 'any',
  jq: 'any',
  diff: 'any',
  basename: 'any',
  dirname: 'any',
  realpath: 'any',
  du: 'any',
  nl: 'any',
  true: 'any',
  cd: 'any',
  test: 'test',
  '[': 'test',
  rg: {
    short: 'nNiSFwlcoLvHhuUaz0qsx',
    shortWithValue: 'gtTCABmMe',
    long: [
      '--line-number',
      '--no-line-number',
      '--ignore-case',
      '--smart-case',
      '--case-sensitive',
      '--fixed-strings',
      '--word-regexp',
      '--line-regexp',
      '--files',
      '--files-with-matches',
      '--files-without-match',
      '--count',
      '--count-matches',
      '--only-matching',
      '--invert-match',
      '--hidden',
      '--no-ignore',
      '--no-ignore-vcs',
      '--follow',
      '--text',
      '--multiline',
      '--multiline-dotall',
      '--json',
      '--heading',
      '--no-heading',
      '--with-filename',
      '--no-filename',
      '--column',
      '--vimgrep',
      '--null',
      '--unrestricted',
      '--pcre2',
      '--trim',
      '--stats',
      '--quiet',
      '--no-messages',
      '--color',
      '--sort',
      '--sortr',
      '--max-depth',
      '--max-count',
      '--max-columns',
      '--context',
      '--after-context',
      '--before-context',
      '--glob',
      '--iglob',
      '--type',
      '--type-not',
      '--type-list',
      '--regexp',
      '--replace',
      '--passthru',
    ],
    longWithValue: [
      '--sort',
      '--sortr',
      '--max-depth',
      '--max-count',
      '--max-columns',
      '--context',
      '--after-context',
      '--before-context',
      '--glob',
      '--iglob',
      '--type',
      '--type-not',
      '--regexp',
      '--replace',
      '--color',
    ],
  },
  fd: {
    short: 'HIiFsapLu0l1g',
    shortWithValue: 'tedESc',
    long: [
      '--hidden',
      '--no-ignore',
      '--no-ignore-vcs',
      '--ignore-case',
      '--case-sensitive',
      '--fixed-strings',
      '--glob',
      '--regex',
      '--absolute-path',
      '--full-path',
      '--follow',
      '--print0',
      '--list-details',
      '--type',
      '--extension',
      '--max-depth',
      '--min-depth',
      '--exact-depth',
      '--exclude',
      '--size',
      '--changed-within',
      '--changed-before',
      '--color',
      '--max-results',
    ],
    longWithValue: [
      '--type',
      '--extension',
      '--max-depth',
      '--min-depth',
      '--exact-depth',
      '--exclude',
      '--size',
      '--changed-within',
      '--changed-before',
      '--color',
      '--max-results',
    ],
  },
  sort: {
    short: 'nrufhVbdgiMRcCsz',
    shortWithValue: 'ktS',
    long: [
      '--numeric-sort',
      '--reverse',
      '--unique',
      '--ignore-case',
      '--human-numeric-sort',
      '--version-sort',
      '--general-numeric-sort',
      '--month-sort',
      '--random-sort',
      '--ignore-leading-blanks',
      '--dictionary-order',
      '--check',
      '--stable',
      '--zero-terminated',
      '--key',
      '--field-separator',
    ],
    longWithValue: ['--key', '--field-separator'],
  },
  uniq: {
    short: 'cdDuiz',
    shortWithValue: 'fsw',
    long: ['--count', '--repeated', '--unique', '--ignore-case', '--zero-terminated', '--skip-fields', '--skip-chars', '--check-chars'],
    longWithValue: ['--skip-fields', '--skip-chars', '--check-chars'],
    operands: 1,
  },
  tree: {
    short: 'adfiplsughDFrtvCnQNJX',
    shortWithValue: 'LIP',
    long: ['--gitignore', '--noreport', '--dirsfirst', '--filelimit', '--prune', '--matchdirs', '--charset'],
    longWithValue: ['--filelimit', '--charset'],
  },
  file: { short: 'bLhiknrsz0', long: ['--brief', '--mime', '--mime-type', '--mime-encoding', '--dereference', '--no-dereference'] },
  date: {
    short: 'uRj',
    shortWithValue: 'rdfI',
    long: ['--utc', '--iso-8601', '--rfc-3339', '--date', '--reference'],
    longWithValue: ['--date', '--reference'],
  },
  git: 'git',
  find: 'find',
  sed: 'sed',
  env: 'env',
}

/**
 * What a trusted reader, the coordinator in its own copies (ADR-058), may
 * run beside: programs that only say how the computer stands. Not `ps` or
 * `lsof`, whose lines carry other programs' arguments, keys among them.
 */
const TRUSTED_READS: Readonly<Record<string, Flags | 'any'>> = {
  uptime: 'any',
  uname: 'any',
  whoami: 'any',
  id: 'any',
  groups: 'any',
  nproc: 'any',
  arch: { operands: 0 },
  sw_vers: 'any',
  vm_stat: 'any',
  df: 'any',
  free: 'any',
  // `hostname NAME` sets it.
  hostname: { short: 'sfidaAIsy', long: ['--short', '--fqdn', '--ip-address', '--all-ip-addresses', '--domain'], operands: 0 },
}

/**
 * `git tag`'s flags that only list, for a trusted reader: with `-l`, or one
 * that implies it, its other words are patterns. Not `-v`, which runs gpg,
 * nor any that makes a tag.
 */
const GIT_TAG_LISTS =
  /^(-l|--list|-n\d*|--sort(=.*)?|--format(=.*)?|--points-at(=.*)?|--contains(=.*)?|--no-contains(=.*)?|--merged(=.*)?|--no-merged(=.*)?|--column(=.*)?|--no-column|-i|--ignore-case|--omit-empty|--color(=.*)?)$/
const GIT_TAG_IMPLIES_LIST = /^(-l|--list|-n\d*|--points-at(=.*)?|--contains(=.*)?|--no-contains(=.*)?|--merged(=.*)?|--no-merged(=.*)?)$/
/** The flags whose value is the next word, where it isn't joined with `=`. */
const GIT_TAG_WITH_VALUE = /^(--sort|--format|--points-at)$/

/** Why a trusted reader's `git tag` would make or remove a tag, or verify one, or nothing when it only lists. */
const gitTagReason = (args: ReadonlyArray<string>): string | undefined => {
  let operands = 0
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '--') {
      operands += args.length - index - 1
      break
    }
    if (arg.startsWith('-')) {
      if (!GIT_TAG_LISTS.test(arg)) return `\`git tag ${arg}\` makes, removes or verifies a tag, and this role only reads.`
      if (GIT_TAG_WITH_VALUE.test(arg)) index += 1
      continue
    }
    operands += 1
  }
  return operands === 0 || args.some((arg) => GIT_TAG_IMPLIES_LIST.test(arg))
    ? undefined
    : '`git tag` with a name makes a tag; list them with `git tag -l` and a pattern, as this role only reads.'
}

/** Why a command's flags go beyond what a reader may use, or nothing when they don't. */
const flagsReason = (program: string, flags: Flags, args: ReadonlyArray<string>): string | undefined => {
  let operands = 0
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? ''
    if (word === '--') {
      operands += args.length - index - 1
      break
    }
    if (word.startsWith('--')) {
      const name = word.split('=')[0] ?? word
      if (!(flags.long ?? []).includes(name)) return `\`${program} ${name}\` isn't among the flags a reader may use.`
      if ((flags.longWithValue ?? []).includes(name) && !word.includes('=')) index += 1
      continue
    }
    if (word.startsWith('-') && word.length > 1 && !/^-\d/.test(word)) {
      for (let at = 1; at < word.length; at += 1) {
        const letter = word[at] ?? ''
        if ((flags.shortWithValue ?? '').includes(letter)) {
          if (at === word.length - 1) index += 1
          break
        }
        if (!(flags.short ?? '').includes(letter)) return `\`${program} -${letter}\` isn't among the flags a reader may use.`
      }
      continue
    }
    operands += 1
  }
  if (flags.operands !== undefined && operands > flags.operands) return `\`${program}\` would write to its last operand.`
  return undefined
}

/** `find`'s tests and options that only look; an action (`-exec`, `-delete`, `-fprint`) isn't one. */
const FIND_LOOKS = new Set([
  '-name',
  '-iname',
  '-path',
  '-ipath',
  '-wholename',
  '-iwholename',
  '-regex',
  '-iregex',
  '-type',
  '-maxdepth',
  '-mindepth',
  '-newer',
  '-mtime',
  '-mmin',
  '-atime',
  '-amin',
  '-ctime',
  '-cmin',
  '-size',
  '-empty',
  '-user',
  '-group',
  '-perm',
  '-readable',
  '-writable',
  '-executable',
  '-links',
  '-inum',
  '-samefile',
  '-depth',
  '-follow',
  '-xdev',
  '-mount',
  '-prune',
  '-print',
  '-print0',
  '-not',
  '-and',
  '-or',
  '-a',
  '-o',
  '-true',
  '-false',
  '-L',
  '-H',
  '-P',
  '-E',
  '-x',
  '-s',
])

/** A `sed` script that only prints lines: `1,40p`, `$p`, `/re/p`. Anything else (`w`, `e`, `r`) is refused. */
const SED_PRINTS = /^((\d+|\$|\/[^/]*\/)(,(\d+|\$|\/[^/]*\/))?)?p$/

/**
 * The shell's own commands that set a variable, an alias or a function, or
 * how the shell finds a command, or that run what they're given: after
 * `read PATH`, `hash -p ./cat cat` or `alias cat=./cat`, a plain `cat` would
 * run the repository's. Never a reader's, wherever they come in a line.
 */
const SHELL_STATE = new Set([
  'read',
  'declare',
  'typeset',
  'local',
  'export',
  'readonly',
  'set',
  'unset',
  'alias',
  'unalias',
  'hash',
  'rehash',
  'unhash',
  'enable',
  'disable',
  'builtin',
  'source',
  '.',
  'eval',
  'exec',
  'trap',
  'shopt',
  'setopt',
  'unsetopt',
  'emulate',
  'mapfile',
  'readarray',
  'function',
  'functions',
  'autoload',
  'zmodload',
  'let',
  'getopts',
  'integer',
  'float',
  'vared',
  'print',
])

/**
 * A `printf` format that only prints what it is given as text (`%s`, `%b`,
 * `%q`, `%c`, `%%`): zsh works out a number it is given as arithmetic, which
 * can set a variable (`printf %d PATH=1`) or run a command.
 */
const PRINTF_TEXT = /%(%|(\d+\$)?[-+ #0]*\d*(\.\d*)?[sbqc])/g

/** Why a `printf` would set a variable, or work out what it is given as arithmetic; nothing where it only prints. */
const printfReason = (args: ReadonlyArray<string>): string | undefined => {
  const [first] = args
  if (first !== undefined && first.startsWith('-') && first !== '--' && first !== '-')
    return `\`printf ${first}\` can set a variable, as \`-v\` does, and this role only reads.`
  const format = first === '--' ? args[1] : first
  return format !== undefined && format.replace(PRINTF_TEXT, '').includes('%')
    ? '`printf` may only print text here, as `%s` does: a number it is given is worked out as arithmetic, which can set a variable, and this role only reads.'
    : undefined
}

/** `test` operators that work out their operand as a variable's subscript (`-v`, `-R`) or as arithmetic (zsh's `-t`), which can run a command. */
const TEST_EVALUATES = new Set(['-v', '-R', '-t'])

/**
 * Git's options before the subcommand a reader may use: none that set config
 * or run a program. Nor `--git-dir` or `--work-tree`: a repository a pull
 * request carries, named so, would have its config read, which can name a
 * program for git to run (a review's lead's git takes no bare repository it
 * isn't told to, so `-C` into one finds none).
 */
const GIT_GLOBAL_LOOKS =
  /^(-C|--no-pager|-P|--no-optional-locks|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs)$/

/** Git's flags that write a file or run a program, in any subcommand. */
const GIT_FLAG_WRITES =
  /^(--output(=.*)?|--output-directory(=.*)?|-o|--ext-diff|--textconv|-O.*|--open-files-in-pager(=.*)?|--exec(=.*)?|--upload-pack(=.*)?)$/

/** Git's subcommands that only look. */
const GIT_LOOKS = new Set([
  'log',
  'diff',
  'show',
  'status',
  'blame',
  'grep',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'shortlog',
  'describe',
  'cat-file',
  'show-ref',
  'merge-base',
  'whatchanged',
  'name-rev',
  'for-each-ref',
  'count-objects',
])
/** Subcommands that only look when they only list: `git branch -a`, not `git branch -D old`. */
const GIT_LISTS = new Set(['branch', 'tag', 'remote'])
const GIT_LIST_FLAGS = new Set([
  '-a',
  '-r',
  '-v',
  '-vv',
  '-l',
  '--list',
  '--all',
  '--remotes',
  '--show-current',
  '--verbose',
  '--contains',
  '--merged',
  '--no-merged',
  'show',
])

/** Why a git command a reader wants to run would change something or run a program, or nothing when it only looks. */
const gitReason = (words: ReadonlyArray<string>, trusted: boolean): string | undefined => {
  const call = gitCall(words, '.')
  if (call === undefined) return undefined
  const before = words.slice(1, words.indexOf(call.subcommand, 1))
  for (let index = 0; index < before.length; index += 1) {
    const word = before[index] ?? ''
    if (!GIT_GLOBAL_LOOKS.test(word)) return `\`git ${word}\` can set git's config or run a program, and this role only reads.`
    if (word === '-C') index += 1
  }
  const flag = call.args.find((arg) => GIT_FLAG_WRITES.test(arg))
  if (flag !== undefined) return `\`git ${call.subcommand} ${flag}\` writes a file or runs a program, and this role only reads.`
  if (GIT_LOOKS.has(call.subcommand)) return undefined
  if (GIT_LISTS.has(call.subcommand) && call.args.every((arg) => GIT_LIST_FLAGS.has(arg))) return undefined
  if (trusted && call.subcommand === 'tag') return gitTagReason(call.args)
  // A stash or the reflog only looks when listed or shown: `git stash` alone stashes the lead's work.
  if ((call.subcommand === 'stash' || call.subcommand === 'reflog') && ['list', 'show'].includes(call.args[0] ?? '')) return undefined
  return `\`git ${call.subcommand}\` can change the repository, and this role only reads.`
}

/**
 * The folders a reader may name a program in by its path: the system's and
 * its package managers', on macOS and Linux, never a repository's. Named so
 * anywhere else (`./cat`, `node_modules/.bin/cat`, `~/bin/cat`), a program
 * is what that folder holds, whatever its name says.
 */
const SYSTEM_PROGRAMS =
  /^\/(s?bin|usr\/s?bin|usr\/local\/s?bin|opt\/homebrew\/s?bin|home\/linuxbrew\/\.linuxbrew\/s?bin|snap\/bin|run\/current-system\/sw\/bin|nix\/var\/nix\/profiles\/default\/bin)\/[^/]+$/

/**
 * What stands for a command substitution's output once its command is read
 * (`substitutionsIn`): a variable, which the shell expands into words that
 * may be anything, a flag among them.
 */
const OUTPUT = '$ALTHAR_OUTPUT'
/** What stands for the output of a substitution that prints only commits' and refs' names, which never start with a dash. */
const NAMES = '$ALTHAR_NAMES'
/** Where a word holds a substitution's output. */
const SUBSTITUTED = /\$ALTHAR_(OUTPUT|NAMES)/

/** `git rev-parse`'s and `git rev-list`'s flags that keep them printing names: `rev-parse` prints any other flag back. */
const NAMES_FLAGS =
  /^(--short(=\d+)?|--abbrev-ref|--verify|--quiet|-q|--symbolic-full-name|--count|--first-parent|--reverse|--merges|--no-merges|--all|--branches|--tags|--max-count=\d+|-\d+)$/

/**
 * Whether a substitution's command prints only commits' and refs' names,
 * or a count: one git command of those that do, as `git describe --tags`.
 * A name never starts with a dash, so what it prints is never a flag.
 */
const namesOnly = (script: string): boolean => {
  const { commands, opaque } = parseCommandLine(script)
  const [only] = commands
  if (opaque || commands.length !== 1 || only === undefined || only[0] !== 'git') return false
  const [subcommand, ...args] = only.slice(1)
  if (subcommand === 'describe' || subcommand === 'merge-base') return true
  if (subcommand === 'branch') return args.length === 1 && args[0] === '--show-current'
  if (subcommand !== 'rev-parse' && subcommand !== 'rev-list') return false
  return args.every((arg) => (arg.startsWith('-') ? NAMES_FLAGS.test(arg) : !/[$`*?[{]/.test(arg)))
}

/** The index of the `)` that closes what opens just before `from`, past quotes and parentheses of its own; -1 where none does. */
const closingOf = (text: string, from: number): number => {
  let depth = 1
  for (let index = from; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === '\\') index += 1
    else if (char === "'") {
      const close = text.indexOf("'", index + 1)
      if (close === -1) return -1
      index = close
    } else if (char === '"') {
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) if (text[index] === '\\') index += 1
    } else if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * The commands a line's substitutions run, `$(…)` and backticks, and the
 * line with each one's output standing as `OUTPUT`, outside quotes, so it
 * is read as words the shell expands; or why it can't be read so. For a
 * trusted reader: each command is read as a line of its own.
 */
const substitutionsIn = (text: string): { readonly scripts: ReadonlyArray<string>; readonly text: string } | string => {
  const scripts: Array<string> = []
  let out = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === '\\') {
      out += text.slice(index, index + 2)
      index += 1
      continue
    }
    if (char === "'" && !quoted) {
      const close = text.indexOf("'", index + 1)
      const end = close === -1 ? text.length : close
      out += text.slice(index, end + 1)
      index = end
      continue
    }
    if (char === '"') {
      quoted = !quoted
      out += char
      continue
    }
    const standIn = (script: string) => {
      const stands = namesOnly(script) ? NAMES : OUTPUT
      return quoted ? `"${stands}"` : stands
    }
    if (char === '$' && text[index + 1] === '(') {
      if (text[index + 2] === '(')
        return 'An arithmetic expansion, `$((…))`, can set a variable, which changes what runs; work the number out yourself, as this role only reads.'
      const end = closingOf(text, index + 2)
      if (end === -1) return "Althar can't tell where this `$(…)` ends, and this role only reads."
      const script = text.slice(index + 2, end)
      scripts.push(script)
      out += standIn(script)
      index = end
      continue
    }
    if (char === '`') {
      let end = index + 1
      while (end < text.length && text[end] !== '`') end += text[end] === '\\' ? 2 : 1
      if (end >= text.length) return "Althar can't tell where this backtick ends, and this role only reads."
      const script = text.slice(index + 1, end).replace(/\\([`$\\])/g, '$1')
      scripts.push(script)
      out += standIn(script)
      index = end
      continue
    }
    out += char
  }
  return { scripts, text: out }
}

/** Whether all a word's shell expands is the output of substitutions that print only names (`NAMES`): it can't become a flag. */
const onlyNames = (word: string) => {
  if (!word.includes(NAMES)) return false
  const rest = word.replaceAll(NAMES, 'x')
  return !/[*?[$]/.test(rest) && !/\{[^{}]*(,|\.\.)[^{}]*\}/.test(rest)
}

/** Why one command would change something or run another program, or nothing when it only looks. */
const readerWordsReason = (words: ReadonlyArray<string>, trusted = false): string | undefined => {
  const named = words[0] ?? ''
  const program = named.split('/').at(-1) ?? ''
  const written = writes(words).filter((target) => target !== '/dev/null')
  if (written.length > 0) return `It would write to ${written[0]}, and this role only reads.`
  // Where a shell's output goes, thrown away.
  if (onlyRedirects(words)) return undefined
  if (SUBSTITUTED.test(named)) return "What `$(…)` prints can't be the command to run: name the program, as this role only reads."
  if (named.includes('/') && !SYSTEM_PROGRAMS.test(named))
    return `\`${named}\` runs what that folder holds, not the system's \`${program}\`, and this role only reads.`
  if (SHELL_STATE.has(program))
    return `\`${program}\` can set a variable, a function or an alias, or how the shell finds a command, and this role only reads.`
  const reads = READS[program] ?? (trusted ? TRUSTED_READS[program] : undefined)
  if (reads === undefined) return `\`${program}\` isn't on the list of commands that only look, and this role only reads.`
  const args = words.slice(1)
  const reason = ((): string | undefined => {
    switch (reads) {
      case 'any':
        return undefined
      case 'git':
        return gitReason(words, trusted)
      case 'env':
        return args.length > 0 ? '`env` runs another command, and this role only reads.' : undefined
      case 'printf':
        return printfReason(args)
      case 'test': {
        const operator = args.find((arg) => TEST_EVALUATES.has(arg))
        return operator === undefined
          ? undefined
          : `\`${program} ${operator}\` works out its operand as a variable or as arithmetic, which can run a command, and this role only reads.`
      }
      case 'find': {
        const action = args.find((arg) => arg.startsWith('-') && !FIND_LOOKS.has(arg))
        return action === undefined ? undefined : `\`find ${action}\` isn't a test that only looks, and this role only reads.`
      }
      case 'sed': {
        const flags = args.filter((arg) => arg.startsWith('-'))
        const [script] = args.filter((arg) => !arg.startsWith('-'))
        if (flags.some((flag) => !['-n', '-E', '-r', '--quiet', '--silent'].includes(flag)))
          return '`sed` with those flags can edit files or run commands, and this role only reads.'
        return script !== undefined && SED_PRINTS.test(script.replaceAll(' ', ''))
          ? undefined
          : '`sed` may only print lines here, as in `sed -n 1,40p`, and this role only reads.'
      }
      default:
        return flagsReason(program, reads, args)
    }
  })()
  return reason === undefined || reason.endsWith('only reads.') ? reason : `${reason.slice(0, -1)}, and this role only reads.`
}

/** A shell, by its program's name: what `sh -c` hands a script to. */
const SHELLS = /^(ba|z|da|k)?sh$/

/**
 * Why the words that start a reader's command, before its program, would
 * change what runs: a variable set for it (`PATH=. cat`, `GIT_EXTERNAL_DIFF=…
 * git diff`), `env`, which can set one or search a path of its own, `sudo`,
 * or `exec`, which hands the shell over to it. Timing and niceness wrappers
 * are only that.
 */
const readerLaunchReason = (words: ReadonlyArray<string>): string | undefined => {
  const before = words.slice(0, words.length - unwrap(words).length)
  for (const [index, word] of before.entries()) {
    const set = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word)?.[1]
    if (set !== undefined) return `Setting ${set} for a command can change what it runs, and this role only reads.`
    // `env` alone only prints the environment.
    if (word === 'env' && index < words.length - 1) return '`env` runs another command, and this role only reads.'
    if (word === 'sudo') return '`sudo` runs a command as someone else, and this role only reads.'
    if (word === 'exec') return '`exec` hands the shell over to a command, and this role only reads.'
  }
  return undefined
}

/**
 * Why a command a reader wants to run would change something, or run
 * something that isn't the system's own program, or nothing when it only
 * looks. Each command of the line is read alike, whatever joins them (`|`,
 * `&&`, `;`), and a script handed to a shell is read as commands of its own.
 * A reader may read a repository it doesn't trust, as the lead of a review
 * does, so a read is decided from what runs, never from a name the
 * repository could give something else: no program from its folders, no
 * variable set to change what runs, by a word before it, a shell command
 * (`printf -v PATH .`, `read`, `hash`, a function named `cat`) or an
 * expansion (`${PATH:=.}`, `$[PATH=1]`), and no file name the shell expands
 * into a flag (`rg x *` where a file is named `--pre=./run.sh`).
 */
const readerCommandReason = (text: string, trusted = false): string | undefined => {
  if (/[<>]\(/.test(text)) return 'A process substitution, `<(…)`, runs a command of its own, and this role only reads.'
  const { commands, operators, expanded, opaque, grouped, evaluated } = splitCommandLine(text)
  if (opaque) return "Althar can't tell what this command does until it runs, and this role only reads."
  if (grouped)
    return 'Parentheses start a subshell, define a function or qualify a pattern, any of which can run a command of its own; quote them where they are text, as this role only reads.'
  if (evaluated)
    return 'An expansion such as `${X:=…}`, `$[…]` or `$a[…]` can set a variable or work out arithmetic, which changes what runs; name a variable plainly, as `$X`, as this role only reads.'
  for (const [index, written] of commands.entries()) {
    // Redirects after the rest, as the shell reads them: `> /dev/null security …` runs `security`.
    const { words, at: movedTo } = redirectsLast(written, operators[index] ?? new Set())
    const launched = readerLaunchReason(words)
    if (launched !== undefined) return launched
    // A wrapper alone runs nothing else: `env` prints the environment.
    const inner = unwrap(words).length === 0 ? words : unwrap(words)
    const dropped = words.length - inner.length
    const [named = '', ...args] = inner
    const program = named.split('/').at(-1) ?? ''
    const script = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    if (SHELLS.test(program) && script !== -1 && args[script + 1] !== undefined) {
      // A shell may only be started plainly (`bash -lc`): `-i`, `--rcfile` and the like have it read a file of its own first.
      if (named.includes('/') && !SYSTEM_PROGRAMS.test(named))
        return `\`${named}\` runs what that folder holds, not the system's \`${program}\`, and this role only reads.`
      const option = args.slice(0, script + 1).find((arg) => !/^-[celuvx]+$/.test(arg))
      if (option !== undefined) return `\`${program} ${option}\` has the shell read or run more than its script, and this role only reads.`
      const written = writes(inner).filter((target) => target !== '/dev/null')
      if (written.length > 0) return `It would write to ${written[0]}, and this role only reads.`
      const reason = readerCommandReason(args[script + 1] ?? '', trusted)
      if (reason !== undefined) return reason
      continue
    }
    // A program whose flags are read closely can't take one the shell made from a file's name; after `--` none is a flag.
    const reads = READS[program] ?? (trusted ? TRUSTED_READS[program] : undefined)
    if (reads !== undefined && reads !== 'any') {
      const ends = inner.indexOf('--')
      const at = [...(expanded[index] ?? [])]
        .map((each) => (movedTo.get(each) ?? each) - dropped)
        .find(
          (each) =>
            each >= 1 && (ends === -1 || each < ends) && !REDIRECTS.includes(inner[each - 1] ?? '') && !onlyNames(inner[each] ?? ''),
        )
      if (at !== undefined && SUBSTITUTED.test(inner[at] ?? ''))
        return `What \`$(…)\` prints could start with a dash, which \`${program}\` would take for a flag: run it on its own and name what it prints, or put it after \`--\`, as this role only reads.`
      if (at !== undefined)
        return `The shell would expand \`${inner[at]}\`, which \`${program}\` could take for a flag where a file's name starts with a dash; quote it or name the files, as this role only reads.`
    }
    const reason = readerWordsReason(inner, trusted)
    if (reason !== undefined) return reason
  }
  return undefined
}

/** Why an offline reader's fetch is refused: what it reviews came from outside the project. */
export const OFFLINE =
  'This review has no network: the pull request is from outside the project, and its words could send you to a page of their choosing. Read the pull request with read_pull_request, and its code in your copy.'

/** How a reader is held: see `decideReader`. */
export interface ReaderOptions {
  readonly offline?: boolean
  readonly cwd?: string
  readonly trusted?: boolean
  /**
   * Where a trusted reader's own tools may read (ADR-058): none of `denied`
   * but what `allowed` gives back, real paths, as its sandbox holds its
   * commands. Its agent's tools for reading and searching aren't in the
   * sandbox, so the rules hold them.
   */
  readonly reads?: { readonly allowed: ReadonlyArray<string>; readonly denied: ReadonlyArray<string> }
}

/** Why a trusted reader may not read a place outside what it is given. */
const HELD_REFUSED =
  "That is outside what this role reads: the person's home folder, their checkouts and the task folders, but for your working folder and its copies."

/** Why a trusted reader may not search from a place that is, or holds, one outside what it is given. */
const SEARCH_REFUSED = `${HELD_REFUSED} A search from a folder above one of those goes into it: search from your working folder or a copy in it.`

/** A path as the filesystem has it, links followed, as far as it is there. */
const realOf = (path: string, paths: typeof posix): string => {
  try {
    return realpathSync(path)
  } catch {
    const parent = paths.dirname(path)
    return parent === path ? path : paths.join(realOf(parent, paths), paths.basename(path))
  }
}

/**
 * Whether a trusted reader's tool reading `path` reaches into a place it is
 * held from, and not one given back. A search goes down from where it starts,
 * so one that starts above a place held from it reaches into it too.
 */
const heldFrom = (path: string, cwd: string, reads: NonNullable<ReaderOptions['reads']>, searches = false, system: System = systemOf()) => {
  const { paths, home, caseless } = system
  const fold = (value: string) => (caseless ? value.toLowerCase() : value)
  const target = fold(realOf(paths.resolve(cwd, path.replace(HOME_WORD, home)), paths))
  const inside = (outer: string, inner: string) => {
    const between = paths.relative(outer, inner)
    return !between.startsWith('..') && !paths.isAbsolute(between)
  }
  const within = (place: string) => inside(fold(place), target)
  if (reads.denied.some(within) && !reads.allowed.some(within)) return true
  return searches && reads.denied.some((place) => inside(target, fold(place)))
}

/** Glob's characters: a pattern's folder is what comes before the first. */
const GLOB_CHARACTER = /[*?[{]/

/**
 * A pattern that starts at a root: `/`, or on Windows a drive's (`C:\`, `C:/`). Not a bare backslash, which starts many a
 * regex Grep is given (`\bretry`).
 */
const ROOTED = /^(\/|[A-Za-z]:[/\\])/

/**
 * Where a search starts: the folder it names, or the working folder, and the
 * folder a pattern of paths names before its first glob character where it
 * leaves that folder (absolute, from home, or up with `..`), as Glob's
 * `pattern` or Grep's `glob` may.
 */
const searchRootsOf = (request: PermissionRequest, cwd: string): ReadonlyArray<string> => {
  const named = pathsOf(request)
  const from = named[0] ?? cwd
  const patterns = ['pattern', 'glob']
    .map((key) => field(request.rawInput, key))
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => ROOTED.test(value) || HOME_WORD.test(value) || /(^|[/\\])\.\.($|[/\\])/.test(value))
    .map((value) => {
      const glob = value.search(GLOB_CHARACTER)
      const fixed = glob === -1 ? value : value.slice(0, glob)
      const folder = fixed.slice(0, Math.max(fixed.lastIndexOf('/'), fixed.lastIndexOf('\\')) + 1)
      return folder === '' ? fixed : folder
    })
    .map((folder) => (ROOTED.test(folder) || HOME_WORD.test(folder) ? folder : `${from}/${folder}`))
  return [...(named.length === 0 ? [cwd] : named), ...patterns]
}

/** Why a trusted reader may not read a `.env` file outside its folder. */
const ENV_REFUSED =
  "A .env file outside your working folder holds the person's secrets, such as their checkout's; this role reads only its own copies'."

/** A `.env` file outside a trusted reader's folder, as the person's checkout's is: from `~`, or from the folder. */
const envOutside = (path: string, cwd: string, system: System = systemOf()) => {
  const { paths, home } = system
  const target = paths.resolve(cwd, path.replace(HOME_WORD, home))
  const inside = paths.relative(cwd, target)
  return envFile(target) && (inside.startsWith('..') || paths.isAbsolute(inside))
}

/**
 * Whether a trusted reader's line names a `.env` file outside its folder:
 * by its path, or by any name at all where a `cd` takes it elsewhere first.
 */
const envOutsideIn = (command: string, cwd: string) => {
  const { commands } = parseCommandLine(command)
  const moves = commands.some((words) => ['cd', 'pushd'].includes(words[0] ?? ''))
  return commands.some((words) =>
    words
      .slice(1)
      .flatMap(pathsInWord)
      .some((path) => (moves ? envFile(path) : envOutside(path, cwd))),
  )
}

/**
 * Why a command line a reader wants to run would do more than look, or
 * nothing when it only looks. A trusted reader's substitutions, `$(…)` and
 * backticks, are each read as a line of their own, and what they print as
 * words the shell expands.
 */
const readerLineReason = (command: string, options: ReaderOptions): string | undefined => {
  if (options.trusted === true) {
    if (options.cwd !== undefined && envOutsideIn(command, options.cwd)) return ENV_REFUSED
    const found = substitutionsIn(command)
    if (typeof found === 'string') return found
    if (found.scripts.length > 0)
      return [...found.scripts, found.text].map((line) => readerLineReason(line, options)).find((reason) => reason !== undefined)
  }
  return (
    parseCommandLine(command)
      .commands.map((words) => credentialReason(unwrap(words)) ?? deviceBridgeReason(unwrap(words)))
      .find((found) => found !== undefined) ??
    secretCommandReason(command, options.cwd) ??
    readerCommandReason(command, options.trusted === true)
  )
}

/**
 * Decides a request from a role that only reads. Nothing here asks a person:
 * a reader's request is allowed or refused. `offline`, as the lead of a
 * review of a pull request from outside the project is, it reaches nothing
 * on the network: a fetch is refused, as anything the agent's sandbox asks
 * to reach is, and no command it may run reaches the network anyway. `cwd`
 * is the folder the agent works in, which the paths it names are read from.
 * `trusted`, as the coordinator is in its own copies of the project's
 * repositories (ADR-058), it may also run `$(…)` and backticks whose
 * commands only look, a few programs that say how the computer stands
 * (`uptime`), and list tags with patterns: never the lead of a review.
 */
export const decideReader = (request: PermissionRequest, options: ReaderOptions = {}): ReaderVerdict => {
  if (ALTHAR_TOOL.test(request.title)) return ALLOW
  switch (request.kind) {
    case 'read':
    case 'search': {
      // A reader may read anything but where the person keeps keys and sign-ins; a trusted one, no `.env` outside its folder either.
      const secret = secretReason(request, options.cwd)
      if (secret !== undefined) return deny(secret)
      const { cwd, reads } = options
      if (options.trusted !== true || cwd === undefined) return ALLOW
      const read = pathsOf(request)
      if (read.some((path) => envOutside(path, cwd))) return deny(ENV_REFUSED)
      if (reads === undefined) return ALLOW
      if (request.kind === 'search')
        return searchRootsOf(request, cwd).some((path) => heldFrom(path, cwd, reads, true)) ? deny(SEARCH_REFUSED) : ALLOW
      return read.some((path) => heldFrom(path, cwd, reads)) ? deny(HELD_REFUSED) : ALLOW
    }
    case 'think':
      return ALLOW
    case 'fetch':
      return options.offline === true ? deny(OFFLINE) : ALLOW
    case 'edit':
    case 'delete':
    case 'move':
      return deny('This role only reads: a change is a task.')
    default: {
      const command = commandIn(request.rawInput) ?? (request.kind === 'execute' ? request.title : undefined)
      if (command === undefined || command === '') return deny("Althar can't tell what this does, and this role only reads.")
      const reason = readerLineReason(command, options)
      return reason === undefined ? ALLOW : deny(reason)
    }
  }
}
