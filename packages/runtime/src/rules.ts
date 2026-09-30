import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { PermissionRequest } from '@charrette/provider-adapters'

/*
 * The project rules for the MVP (docs/plans/mvp.md): everything is allowed and
 * recorded, except what the always-ask list keeps for the person. Pushes to
 * the default branch, force pushes and pushes of every branch or of tags,
 * deleting branches other than the task's, merges, deploy and publish
 * commands, and writes outside the task's worktree.
 *
 * Commands are read as a shell would split them, into commands and words, so
 * `cd x && git -C y push origin HEAD:refs/heads/main` is understood. Where
 * the rules can't tell where a push goes or where an edit writes, they ask.
 *
 * The agents' own sandboxes are the boundary for what commands write
 * (docs/architecture/03): Codex's and Claude Code's keep a command inside the
 * worktree, and a command that has to leave reaches Charrette as a request.
 * Such a request is allowed unless its words name a place outside the
 * worktree, or it is on the list above; git's own writes for the task, such
 * as `git add` and `git commit`, are allowed, since a worktree's git data
 * lives in the main repository, outside the sandbox.
 */

export type Verdict = { readonly verdict: 'allow' } | { readonly verdict: 'ask'; readonly reason: string }

export interface RuleContext {
  /** The task's worktree, where the agent works. */
  readonly worktree: string
  /** The branch pushes to which always ask. */
  readonly defaultBranch: string
  /** The task's branch, which the agent may push to and delete. */
  readonly taskBranch?: string
  /** The branch checked out in the worktree now, where a push without a destination goes. */
  readonly currentBranch?: string
  /** Follows symlinks; the file system's own unless a test gives one. */
  readonly realPath?: (path: string) => string
  /** Folders anything may write to, such as the temp folder. */
  readonly scratch?: ReadonlyArray<string>
}

const ALLOW: Verdict = { verdict: 'allow' }
const ask = (reason: string): Verdict => ({ verdict: 'ask', reason })

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

// ---- Places ----------------------------------------------------------------

interface Places {
  readonly real: (path: string) => string
  readonly worktree: string
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
    worktree: real(context.worktree),
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

const outside = (where: Places, path: string) => !within(where.worktree, path) && !where.scratch.some((root) => within(root, path))

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

/** Why a push asks, or nothing when it goes only where the task may push. */
const pushReason = (args: ReadonlyArray<string>, context: RuleContext): string | undefined => {
  const main = context.defaultBranch
  const own = (branch: string) => branch === context.taskBranch
  const positional: Array<string> = []
  let deleting = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg)
      continue
    }
    if (/^(-f|--force|--force-with-lease(=.*)?|--force-if-includes)$/.test(arg) || /^-[a-z]*f[a-z]*$/.test(arg))
      return 'A force push always asks.'
    if (/^(--all|--branches|--mirror)$/.test(arg)) return 'Pushing every branch always asks.'
    if (/^(--tags|--follow-tags)$/.test(arg)) return 'Pushing tags always asks; they often start a release.'
    if (arg === '--prune') return 'A push that deletes remote branches always asks.'
    if (arg === '-d' || arg === '--delete') {
      deleting = true
      continue
    }
    if (PUSH_OPTIONS_WITH_VALUE.includes(arg)) {
      index += 1
      continue
    }
    if (PUSH_OPTIONS_WITH_VALUE.some((option) => arg.startsWith(`${option}=`)) || PUSH_FLAGS_HARMLESS.test(arg)) continue
    return `Charrette can't tell what \`${arg}\` does to a push, so it asks.`
  }
  const [, ...refspecs] = positional
  const destinations: Array<{ readonly branch: string; readonly deletes: boolean }> = []
  if (refspecs.length === 0) {
    if (deleting) return `Charrette can't tell which branch this deletes, so it asks.`
    if (context.currentBranch === undefined) return `Charrette can't tell which branch this pushes, so it asks.`
    destinations.push({ branch: context.currentBranch, deletes: false })
  }
  for (const refspec of refspecs) {
    if (refspec.startsWith('+')) return 'A force push always asks.'
    if (refspec.includes('*')) return 'A push to a pattern of branches always asks.'
    const colon = refspec.lastIndexOf(':')
    const source = colon === -1 ? refspec : refspec.slice(0, colon)
    let destination = colon === -1 ? refspec : refspec.slice(colon + 1)
    if (colon !== -1 && destination === '') return 'A push of matching branches always asks.'
    if (destination === 'HEAD' || (colon === -1 && source === 'HEAD')) {
      if (context.currentBranch === undefined) return `Charrette can't tell which branch this pushes, so it asks.`
      destination = context.currentBranch
    }
    if (destination.startsWith('refs/tags/')) return 'Pushing tags always asks; they often start a release.'
    if (destination.startsWith('refs/') && !destination.startsWith('refs/heads/'))
      return `Charrette can't tell what \`${destination}\` is, so it asks.`
    destinations.push({ branch: destination.replace(/^refs\/heads\//, ''), deletes: deleting || (colon !== -1 && source === '') })
  }
  for (const { branch, deletes } of destinations) {
    if (branch === main) return deletes ? `Deleting ${main} always asks.` : `A push to ${main} always asks.`
    if (deletes && !own(branch)) return `Deleting ${branch}, which isn't this task's branch, always asks.`
  }
  return undefined
}

// ---- Commands --------------------------------------------------------------

const DEPLOY =
  /\bdeploy\b|\b(wrangler|vercel|netlify|flyctl|fly|firebase|serverless|cdk|sam)\s+(deploy|publish)\b|\bvercel\b.*--prod\b|\bkubectl\s+(apply|delete|rollout|replace|patch)\b|\bterraform\s+(apply|destroy)\b|\bpulumi\s+(up|destroy)\b|\bhelm\s+(install|upgrade|uninstall)\b|\b(npm|bun|pnpm|yarn|cargo|gem|twine|poetry)\s+publish\b|\bgh\s+release\s+create\b/

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

const commandReason = (text: string, context: RuleContext): string | undefined => {
  const { commands, opaque } = parseCommandLine(text)
  if (opaque && /\bpush\b|\bdeploy\b|\bpublish\b|\bmerge\b/.test(text))
    return `Charrette can't tell what this command does until it runs, so it asks.`
  const where = places(context)
  let cwd = context.worktree
  for (const words of commands) {
    const joined = words.join(' ')
    if (DEPLOY.test(joined)) return 'Deploying or publishing always asks.'
    if (/^(gh\s+pr\s+merge|glab\s+mr\s+merge)\b/.test(joined)) return 'A merge always asks.'
    if (words[0] === 'cd') {
      cwd = locate(where, cwd, words[1] ?? '~')
      continue
    }
    const git = gitCall(words, cwd)
    if (git !== undefined) {
      const repository = [locate(where, cwd, git.cwd), ...git.elsewhere.map((path) => locate(where, cwd, path))]
      if (repository.some((path) => outside(where, path)))
        return `Git in another folder always asks: ${repository.find((path) => outside(where, path))}`
      if (git.subcommand === 'push') {
        const reason = pushReason(git.args, context)
        if (reason !== undefined) return reason
      }
      if (git.subcommand === 'worktree' || git.subcommand === 'clone') {
        const target = writes([
          'touch',
          ...git.args.filter((arg) => !['add', 'remove', 'prune', 'move', 'lock', 'unlock'].includes(arg)),
        ]).find((path) => outside(where, locate(where, cwd, path)))
        if (target !== undefined) return `Writing outside the task's worktree always asks: ${target}`
      }
      continue
    }
    const target = writes(words).find((path) => outside(where, locate(where, cwd, path)))
    if (target !== undefined) return `Writing outside the task's worktree always asks: ${target}`
  }
  return undefined
}

/**
 * Decides a permission request from the rules. A command is checked against
 * the always-ask list and the places it names; an edit, against the worktree.
 * Anything the rules don't keep for the person is allowed.
 */
export const decide = (request: PermissionRequest, context: RuleContext): Verdict => {
  if (request.kind === 'execute' || request.kind === 'other') {
    const reason = commandReason(commandOf(request), context)
    if (reason !== undefined) return ask(reason)
  }
  if (request.kind === 'edit' || request.kind === 'delete' || request.kind === 'move') {
    const paths = pathsOf(request)
    if (paths.length === 0)
      return ask(`Charrette can't tell where this ${request.kind === 'edit' ? 'edit writes' : 'change goes'}, so it asks.`)
    const where = places(context)
    const escaping = paths.find((path) => outside(where, locate(where, context.worktree, path)))
    if (escaping !== undefined) return ask(`Writing outside the task's worktree always asks: ${escaping}`)
  }
  return ALLOW
}

// ---- Roles that only read ----------------------------------------------------

/*
 * A role that only reads, such as the coordinator (docs/architecture/04) or a
 * reviewer, is never asked about and never asks: what it may do, it does, and
 * the rest is refused with a reason it reads. It may read anything, search,
 * fetch from the web, and run commands that only look. It may call
 * Charrette's own tools, which are how it changes anything. Every write, and
 * every command that could write, is refused. A change is a task.
 */

export type ReaderVerdict = { readonly verdict: 'allow' } | { readonly verdict: 'deny'; readonly reason: string }

const deny = (reason: string): ReaderVerdict => ({ verdict: 'deny', reason })

/** Charrette's own tools, as each agent names them: `mcp__charrette__…` (Claude Code), `mcp.charrette.…` (Codex), `charrette_…` (OpenCode). */
export const CHARRETTE_TOOL = /^(mcp__charrette__|mcp\.charrette\.|charrette_)/

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
  if (opaque) return "Charrette can't tell what this command does until it runs, and this role only reads."
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
  if (CHARRETTE_TOOL.test(request.title)) return ALLOW
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
      if (command === undefined || command === '') return deny("Charrette can't tell what this does, and this role only reads.")
      const reason = readerCommandReason(command)
      return reason === undefined ? ALLOW : deny(reason)
    }
  }
}
