import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { PermissionRequest } from '@althar/provider-adapters'

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
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'ask'; readonly reason: string }
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

/** Why the rules keep a request for the person, and which kind it is: one a project names, or one they can't tell. */
interface Kept {
  readonly reason: string
  readonly rule: RuleId | 'unclear'
}

const kept = (reason: string, rule: RuleId | 'unclear'): Kept => ({ reason, rule })

/** A project's rules, as the rules read them (ADR-013, Policies). */
export interface ProjectRuleSet {
  /**
   * What happens to what no rule keeps: it is allowed (`rules`), it waits
   * for the person (`ask`); or everything is allowed (`allow`), the
   * always-ask list with it, and only what is never allowed is refused.
   */
  readonly mode: 'rules' | 'ask' | 'allow'
  /** The kinds that ask the person. */
  readonly ask: ReadonlyArray<RuleId>
  /** The kinds refused outright, whoever would answer. */
  readonly never: ReadonlyArray<RuleId>
  /** Commands the person named, by how they start (`npm publish`, `terraform *`): asked about, or refused. */
  readonly commands: ReadonlyArray<{ readonly pattern: string; readonly decision: 'ask' | 'never' }>
}

/** A project's rules in a few sentences, for an agent that plans work under them. */
export const sayRules = (rules: ProjectRuleSet): string => {
  const named = (decision: 'ask' | 'never') =>
    rules.commands.flatMap((command) => (command.decision === decision ? [`commands starting \`${command.pattern}\``] : []))
  const asks = [...rules.ask.map((id) => RULE_WORDS[id]), ...named('ask')]
  const never = [...rules.never.map((id) => RULE_WORDS[id]), ...named('never')]
  return [
    rules.mode === 'ask'
      ? "Agents may read anything and change a task's own files; everything else waits for the person."
      : rules.mode === 'allow' || asks.length === 0
        ? 'Agents may do anything.'
        : `Agents may do anything but these, which wait for the person: ${asks.join('; ')}.`,
    ...(never.length === 0 ? [] : [`Never allowed: ${never.join('; ')}.`]),
  ].join(' ')
}

/** The MVP's rules, a project's first: everything allowed but every kind above, which asks. */
export const MVP_RULES: ProjectRuleSet = { mode: 'rules', ask: RULES, never: [], commands: [] }

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
  /** The project's rules; the MVP's without them. */
  readonly project?: ProjectRuleSet
}

const ALLOW: Verdict = { verdict: 'allow' }
const ask = (reason: string): Verdict => ({ verdict: 'ask', reason })

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
    return "Althar opens the task's pull request itself, and the person pushes what you commit to it once they've looked. Commit; read it with read_pull_request."
  if (command === 'issue') return "Althar doesn't change issues from a task. Read one with read_issue, and tell the person what it needs."
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
 * contents, and so no secrets, in the record): the command, the paths, and
 * which files a patch touches, without what it writes. What is left out is
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
}

const SEPARATORS = ['&&', '||', ';', '|', '&', '\n']
const REDIRECTS = ['>>', '&>', '2>', '>', '<']

/** Splits a command line into commands and words, as a POSIX shell would for plain words, quotes and escapes. */
export const parseCommandLine = (text: string): Parsed => {
  const commands: Array<Array<string>> = []
  let words: Array<string> = []
  let word = ''
  let inWord = false
  let opaque = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const rest = text.slice(index)
    if (char === "'") {
      const close = text.indexOf("'", index + 1)
      const end = close === -1 ? text.length : close
      word += text.slice(index + 1, end)
      inWord = true
      index = end
      continue
    }
    if (char === '"') {
      inWord = true
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        const inner = text[index] ?? ''
        if (inner === '\\' && index + 1 < text.length && '"\\$`'.includes(text[index + 1] ?? '')) {
          word += text[index + 1]
          index += 1
        } else {
          if (inner === '`' || (inner === '$' && text[index + 1] === '(')) opaque = true
          word += inner
        }
      }
      continue
    }
    if (char === '\\') {
      word += text[index + 1] ?? ''
      inWord = true
      index += 1
      continue
    }
    if (char === '`' || (char === '$' && text[index + 1] === '(')) opaque = true
    const separator = SEPARATORS.find((candidate) => rest.startsWith(candidate))
    if (separator !== undefined && !(separator === '&' && rest.startsWith('&>'))) {
      endCommand()
      index += separator.length - 1
      continue
    }
    const redirect = REDIRECTS.find((candidate) => rest.startsWith(candidate))
    if (redirect !== undefined) {
      endWord()
      words.push(redirect)
      index += redirect.length - 1
      // `2>&1`, `>&2`: a redirect to another stream, not to a file.
      const stream = /^&[0-9-]+/.exec(text.slice(index + 1))
      if (stream !== null) {
        words.push(stream[0])
        index += stream[0].length
      }
      continue
    }
    if (char === ' ' || char === '\t') {
      endWord()
      continue
    }
    word += char
    inWord = true
  }
  endCommand()
  // A script handed to a shell is read as commands of its own.
  const expanded = commands.flatMap((command): Array<ReadonlyArray<string>> => {
    const inner = unwrap(command)
    const [program, ...args] = inner
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    if (program !== undefined && /^(ba|z|da|k)?sh$/.test(program.split('/').at(-1) ?? '') && flag !== -1 && args[flag + 1] !== undefined) {
      const script = parseCommandLine(args[flag + 1] ?? '')
      if (script.opaque) opaque = true
      return [...script.commands]
    }
    if (program === 'eval' || program === 'xargs' || program === 'source' || program === '.') opaque = true
    return [inner]
  })
  return { commands: expanded, opaque }
}

/** A command without the words that only run it: variable assignments, `sudo`, `env`, `command`, `time`… */
const unwrap = (command: ReadonlyArray<string>): ReadonlyArray<string> => {
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
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ['sudo', 'command', 'exec', 'env', 'nice', 'time', 'nohup', 'caffeinate'].includes(word)) {
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
    if (program === undefined || program === 'cd') continue
    const name = program.slice(program.lastIndexOf('/') + 1)
    return next !== undefined && /^[a-z][a-z-]{0,22}[a-z0-9]?$/.test(next) ? `${name} ${next}` : name
  }
  return undefined
}

// ---- Places ----------------------------------------------------------------

interface Places {
  readonly real: (path: string) => string
  readonly worktrees: ReadonlyArray<string>
  readonly scratch: ReadonlyArray<string>
}

const places = (context: RuleContext): Places => {
  const follow = context.realPath ?? realpathSync
  /** The real path of a place that may not exist yet: its nearest existing folder, with symlinks followed, and the rest. */
  const real = (path: string): string => {
    let existing = path
    const rest: Array<string> = []
    for (;;) {
      try {
        return resolve(follow(existing), ...rest.toReversed())
      } catch {
        const parent = dirname(existing)
        if (parent === existing) return path
        rest.push(existing.slice(parent.length).replace(/^[/\\]/, ''))
        existing = parent
      }
    }
  }
  return {
    real,
    worktrees: (context.worktrees ?? [context.worktree]).map(real),
    scratch: [...(context.scratch ?? [tmpdir(), '/tmp', '/dev/null', '/dev/stdout', '/dev/stderr'])].map(real),
  }
}

const within = (root: string, path: string) => {
  const inner = relative(root, path)
  return inner === '' || (!inner.startsWith(`..${sep}`) && inner !== '..' && !isAbsolute(inner))
}

/** Where a path a command names really is, from the folder the command runs in. */
const locate = (where: Places, cwd: string, path: string) =>
  where.real(resolve(cwd, path.replace(/^~(?=$|\/)/, homedir()).replace(/^\$HOME(?=$|\/)/, homedir())))

const outside = (where: Places, path: string) =>
  !where.worktrees.some((root) => within(root, path)) && !where.scratch.some((root) => within(root, path))

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

const gitCall = (words: ReadonlyArray<string>, cwd: string): GitCall | undefined => {
  if ((words[0] ?? '').split('/').at(-1) !== 'git') return undefined
  let at = cwd
  const elsewhere: Array<string> = []
  let index = 1
  while (index < words.length) {
    const word = words[index] ?? ''
    if (word === '-C') {
      at = resolve(at, words[index + 1] ?? '.')
      index += 2
    } else if (word === '--git-dir' || word === '--work-tree') {
      elsewhere.push(resolve(at, words[index + 1] ?? '.'))
      index += 2
    } else if (word.startsWith('--git-dir=') || word.startsWith('--work-tree=')) {
      elsewhere.push(resolve(at, word.slice(word.indexOf('=') + 1)))
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
      found.push(kept('A force push always asks.', 'force-push'))
    else if (/^(--all|--branches|--mirror)$/.test(arg)) found.push(kept('Pushing every branch always asks.', 'many-branches'))
    else if (/^(--tags|--follow-tags)$/.test(arg))
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
    else if (arg === '--prune') found.push(kept('A push that deletes remote branches always asks.', 'delete-branch'))
    else if (arg === '-d' || arg === '--delete') deleting = true
    else if (PUSH_OPTIONS_WITH_VALUE.includes(arg)) index += 1
    else if (!PUSH_OPTIONS_WITH_VALUE.some((option) => arg.startsWith(`${option}=`)) && !PUSH_FLAGS_HARMLESS.test(arg))
      found.push(kept(`Althar can't tell what \`${arg}\` does to a push, so it asks.`, 'unclear'))
  }
  const [, ...refspecs] = positional
  const destinations: Array<{ readonly branch: string; readonly deletes: boolean }> = []
  if (refspecs.length === 0) {
    if (deleting) found.push(kept(`Althar can't tell which branch this deletes, so it asks.`, 'unclear'))
    else if (context.currentBranch === undefined) found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear'))
    else destinations.push({ branch: context.currentBranch, deletes: false })
  }
  for (const written of refspecs) {
    // A forced refspec still goes somewhere, which counts too.
    if (written.startsWith('+')) found.push(kept('A force push always asks.', 'force-push'))
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
        found.push(kept(`Althar can't tell which branch this pushes, so it asks.`, 'unclear'))
        continue
      }
      destination = context.currentBranch
    }
    if (destination.startsWith('refs/tags/')) {
      found.push(kept('Pushing tags always asks; they often start a release.', 'many-branches'))
      continue
    }
    if (destination.startsWith('refs/') && !destination.startsWith('refs/heads/')) {
      found.push(kept(`Althar can't tell what \`${destination}\` is, so it asks.`, 'unclear'))
      continue
    }
    destinations.push({ branch: destination.replace(/^refs\/heads\//, ''), deletes: deleting || (colon !== -1 && source === '') })
  }
  for (const { branch, deletes } of destinations) {
    if (mains.includes(branch))
      found.push(kept(deletes ? `Deleting ${branch} always asks.` : `A push to ${branch} always asks.`, 'default-branch'))
    else if (deletes && !own(branch)) found.push(kept(`Deleting ${branch}, which isn't this task's branch, always asks.`, 'delete-branch'))
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

/** A command as itself, and as what a package runner or an interpreter runs for it. */
const commandsIn = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  [words, runnerRuns(words), scriptRuns(words)].filter((each): each is ReadonlyArray<string> => each !== undefined && each.length > 0)

/** Programs whose arguments are places they write: all of them, or the last. */
const WRITES_ALL = ['touch', 'mkdir', 'rm', 'rmdir', 'tee', 'truncate', 'chmod', 'chown', 'chgrp', 'unlink', 'shred']
const WRITES_LAST = ['cp', 'mv', 'ln', 'install', 'rsync', 'scp']

/** The places a command writes, as far as its words say. */
const writes = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const targets: Array<string> = []
  words.forEach((word, index) => {
    const target = words[index + 1]
    if (REDIRECTS.slice(0, 4).includes(word) && target !== undefined && !target.startsWith('&')) targets.push(target)
    if (word.startsWith('of=')) targets.push(word.slice(3))
  })
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  const operands = words
    .slice(1)
    .filter((word, index, all) => !word.startsWith('-') && !REDIRECTS.includes(word) && !REDIRECTS.includes(all[index - 1] ?? ''))
  if (WRITES_ALL.includes(program)) targets.push(...operands)
  if (WRITES_LAST.includes(program) && operands.length > 1) targets.push(operands.at(-1) ?? '')
  if (program === 'sed' && words.some((word) => word.startsWith('-i') || word === '--in-place')) targets.push(...operands.slice(1))
  return targets
}

/** What a command line does that the rules keep for the person: every kind, in every command of it. */
const commandKinds = (text: string, context: RuleContext): ReadonlyArray<Kept> => {
  const { commands, opaque } = parseCommandLine(text)
  const found: Array<Kept> = []
  if (opaque && /\bpush\b|\bdeploy\b|\bpublish\b|\bmerge\b/.test(text))
    found.push(kept(`Althar can't tell what this command does until it runs, so it asks.`, 'unclear'))
  const where = places(context)
  let cwd = context.worktree
  for (const words of commands) {
    if (commandsIn(words).some(deploys)) found.push(kept('Deploying or publishing always asks.', 'deploy'))
    if (words[0] === 'cd') {
      cwd = locate(where, cwd, words[1] ?? '~')
      continue
    }
    const git = gitCall(words, cwd)
    if (git !== undefined) {
      const repository = [locate(where, cwd, git.cwd), ...git.elsewhere.map((path) => locate(where, cwd, path))]
      if (repository.some((path) => outside(where, path)))
        found.push(kept(`Git in another folder always asks: ${repository.find((path) => outside(where, path))}`, 'outside'))
      if (git.subcommand === 'push') found.push(...pushKinds(git.args, context))
      if (git.subcommand === 'worktree' || git.subcommand === 'clone') {
        const target = writes([
          'touch',
          ...git.args.filter((arg) => !['add', 'remove', 'prune', 'move', 'lock', 'unlock'].includes(arg)),
        ]).find((path) => outside(where, locate(where, cwd, path)))
        if (target !== undefined) found.push(kept(`Writing outside the task's worktree always asks: ${target}`, 'outside'))
      }
      continue
    }
    const target = writes(words).find((path) => outside(where, locate(where, cwd, path)))
    if (target !== undefined) found.push(kept(`Writing outside the task's worktree always asks: ${target}`, 'outside'))
  }
  return found
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

/**
 * The project's command rule a command line meets, a refusal before an ask:
 * each command in it is read on its own, as a shell would run it, and as
 * what a package runner runs for it (`npx prisma …`). A line whose commands
 * only show when it runs, that names a pattern's program, meets that pattern.
 */
const commandRule = (text: string, rules: ProjectRuleSet['commands']) => {
  const { commands, opaque } = parseCommandLine(text)
  const met = rules.filter(
    (rule) =>
      commands.some((words) => commandsIn(words).some((each) => matchesPattern(rule.pattern, each))) ||
      (opaque && namesProgram(text, rule.pattern.trim().split(/\s+/)[0] ?? '')),
  )
  return met.find((rule) => rule.decision === 'never') ?? met[0]
}

const CHANGES: ReadonlyArray<PermissionRequest['kind']> = ['edit', 'delete', 'move']

/** What the rules keep for the person in a request, whatever the project says of it: every kind it is, and why. */
const keptOf = (request: PermissionRequest, context: RuleContext): ReadonlyArray<Kept> => {
  if (request.kind === 'execute' || request.kind === 'other') return commandKinds(commandOf(request), context)
  if (CHANGES.includes(request.kind)) {
    const paths = pathsOf(request)
    if (paths.length === 0)
      return [kept(`Althar can't tell where this ${request.kind === 'edit' ? 'edit writes' : 'change goes'}, so it asks.`, 'unclear')]
    const where = places(context)
    const escaping = paths.find((path) => outside(where, locate(where, context.worktree, path)))
    if (escaping !== undefined) return [kept(`Writing outside the task's worktree always asks: ${escaping}`, 'outside')]
  }
  return []
}

/** Kinds of request that only look, which even a project that asks about everything lets through. */
const LOOKS: ReadonlyArray<PermissionRequest['kind']> = ['read', 'search', 'think']

/**
 * Decides a permission request from the rules and the project's (ADR-013).
 * What no project can change comes first: a code host is reached only
 * through Althar, and no one reads credentials. A request can be several
 * kinds at once (`git push --force origin main` is a force push and a push to
 * the default branch), and every kind counts. Then, in order:
 * - what the project never allows is refused: any kind it is, or a command
 *   the project named;
 * - with everything allowed, anything else is allowed, short of what the
 *   rules can't read where the project never allows something: that is
 *   refused, with how to run it so they can;
 * - a kind on the always-ask list, one the rules can't tell, or a command
 *   the project asks about, waits for the person;
 * - a project that asks about everything asks about the rest, except reads
 *   and changes to the task's own files, which every agent's sandbox keeps;
 * - anything else is allowed.
 */
export const decide = (request: PermissionRequest, context: RuleContext): Verdict => {
  const project = context.project ?? MVP_RULES
  const named = request.kind === 'execute' || request.kind === 'other' ? commandRule(commandOf(request), project.commands) : undefined
  if (request.kind === 'execute' || request.kind === 'other') {
    // A code host is reached through Althar: `gh` and `glab` only look, and no one reads credentials, wherever they are in the command.
    const refused = parseCommandLine(commandOf(request))
      .commands.map((words) => credentialReason(unwrap(words)) ?? hostReason(unwrap(words)))
      .find((reason) => reason !== undefined)
    if (refused !== undefined) return { verdict: 'deny', reason: refused }
    if (named?.decision === 'never') return { verdict: 'deny', reason: `The project's rules never allow \`${named.pattern.trim()}\`.` }
  }
  const found = keptOf(request, context)
  const never = found.find((each) => each.rule !== 'unclear' && project.never.includes(each.rule))
  if (never !== undefined && never.rule !== 'unclear')
    return { verdict: 'deny', reason: `The project's rules never allow ${RULE_WORDS[never.rule]}.` }
  const unclear = found.find((each) => each.rule === 'unclear')
  if (project.mode === 'allow') {
    // With no one to ask, what the rules can't read can't be let past what is never allowed.
    const neverAny = project.never.length > 0 || project.commands.some((rule) => rule.decision === 'never')
    return unclear !== undefined && neverAny
      ? {
          verdict: 'deny',
          reason: `${unclear.reason.replace(/,? so it asks\.$/, '.')} The project's rules never allow some things, so it's refused: run it with its words spelled out, without \`eval\` or \`$(…)\`, naming the branch or file.`,
        }
      : ALLOW
  }
  const asked = found.find((each) => each.rule === 'unclear' || project.ask.includes(each.rule))
  if (asked !== undefined) return ask(asked.reason)
  if (named !== undefined) return ask(`The project's rules ask before \`${named.pattern.trim()}\`.`)
  // Reads, and changes to the task's own files, go through, as they would in any agent's sandbox.
  const ownFiles = CHANGES.includes(request.kind) && found.length === 0
  if (project.mode === 'ask' && !LOOKS.includes(request.kind) && !ownFiles)
    return ask("This project asks you before anything an agent does beyond the task's own files.")
  return ALLOW
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
 * `find` and `sed` are read more closely below.
 */
const READS: Readonly<Record<string, Flags | 'any' | 'git' | 'find' | 'sed' | 'env'>> = {
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
  printf: 'any',
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
  test: 'any',
  '[': 'any',
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

/** Git's options before the subcommand a reader may use: none that set config or run a program. */
const GIT_GLOBAL_LOOKS =
  /^(-C|--no-pager|-P|--no-optional-locks|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--git-dir(=.*)?|--work-tree(=.*)?)$/

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
const gitReason = (words: ReadonlyArray<string>): string | undefined => {
  const call = gitCall(words, '.')
  if (call === undefined) return undefined
  const before = words.slice(1, words.indexOf(call.subcommand, 1))
  for (let index = 0; index < before.length; index += 1) {
    const word = before[index] ?? ''
    if (!GIT_GLOBAL_LOOKS.test(word)) return `\`git ${word}\` can set git's config or run a program, and this role only reads.`
    if (word === '-C' || word === '--git-dir' || word === '--work-tree') index += 1
  }
  const flag = call.args.find((arg) => GIT_FLAG_WRITES.test(arg))
  if (flag !== undefined) return `\`git ${call.subcommand} ${flag}\` writes a file or runs a program, and this role only reads.`
  if (GIT_LOOKS.has(call.subcommand)) return undefined
  if (GIT_LISTS.has(call.subcommand) && call.args.every((arg) => GIT_LIST_FLAGS.has(arg))) return undefined
  // A stash or the reflog only looks when listed or shown: `git stash` alone stashes the lead's work.
  if ((call.subcommand === 'stash' || call.subcommand === 'reflog') && ['list', 'show'].includes(call.args[0] ?? '')) return undefined
  return `\`git ${call.subcommand}\` can change the repository, and this role only reads.`
}

/** Why a command a reader wants to run would change something, or nothing when it only looks. */
const readerCommandReason = (text: string): string | undefined => {
  const { commands, opaque } = parseCommandLine(text)
  if (opaque) return "Althar can't tell what this command does until it runs, and this role only reads."
  for (const words of commands) {
    const program = (words[0] ?? '').split('/').at(-1) ?? ''
    const written = writes(words).filter((target) => target !== '/dev/null')
    if (written.length > 0) return `It would write to ${written[0]}, and this role only reads.`
    const reads = READS[program]
    if (reads === undefined) return `\`${program}\` isn't on the list of commands that only look, and this role only reads.`
    const args = words.slice(1)
    const reason = ((): string | undefined => {
      switch (reads) {
        case 'any':
          return undefined
        case 'git':
          return gitReason(words)
        case 'env':
          return args.length > 0 ? '`env` runs another command, and this role only reads.' : undefined
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
    if (reason !== undefined) return reason.endsWith('only reads.') ? reason : `${reason.slice(0, -1)}, and this role only reads.`
  }
  return undefined
}

/**
 * Decides a request from a role that only reads. Nothing here asks a person:
 * a reader's request is allowed or refused.
 */
export const decideReader = (request: PermissionRequest): ReaderVerdict => {
  if (ALTHAR_TOOL.test(request.title)) return ALLOW
  switch (request.kind) {
    case 'read':
    case 'search':
    case 'think':
    case 'fetch':
      return ALLOW
    case 'edit':
    case 'delete':
    case 'move':
      return deny('This role only reads: a change is a task.')
    default: {
      const command = commandIn(request.rawInput) ?? (request.kind === 'execute' ? request.title : undefined)
      if (command === undefined || command === '') return deny("Althar can't tell what this does, and this role only reads.")
      const reason =
        parseCommandLine(command)
          .commands.map((words) => credentialReason(unwrap(words)))
          .find((found) => found !== undefined) ?? readerCommandReason(command)
      return reason === undefined ? ALLOW : deny(reason)
    }
  }
}
