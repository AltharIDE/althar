import { type System, systemOf, type RuleContext, kept } from './ruleContext'
import { lineReadings, readings, REDIRECTS, type Parsed, NO_SCOPE } from './shellCommands'
import { PATH_KEYS, commandIn, field } from './toolCalls'
import { SECRET_PLACES, type PermissionRequest } from '@althar/provider-adapters'
import { realpathSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { posix } from 'node:path'

// ---- Code hosts --------------------------------------------------------------

/*
 * Agents inherit the person's code-host identity (ADR-097). Direct commands
 * meet the same irreversible rules as Althar's tools. Explicit credential
 * reads, including the keychain, remain refused in every role.
 */

const CREDENTIALS_REFUSED =
  "Agents don't read the person's credentials or the keychain. Althar reaches the code host for the task; tell the person what's needed."

/**
 * What of `security` reads no secret, and changes nothing: the identities a
 * build signs with (`find-identity`), certificates, which are public, which
 * keychains there are, and decoding a signed file (`cms -D`, a provisioning
 * profile). Any other subcommand, or any word before it, may read a password
 * or a key, or change the keychain.
 */
const SECURITY_LOOKS = /^(find-identity|find-certificate|list-keychains|show-keychain-info|verify-cert|cms|error|help)$/

/** Whether `security`'s words only look: a subcommand that reads no secret, and none of its options that set or sign. */
const securityLooks = (args: ReadonlyArray<string>): boolean => {
  const [subcommand = '', ...rest] = args
  if (!SECURITY_LOOKS.test(subcommand)) return false
  // `list-keychains -s` sets the search list; `cms -S` signs with a key from the keychain.
  if (subcommand === 'list-keychains') return !rest.some((arg) => /^-[a-z]*s/.test(arg))
  if (subcommand === 'cms') return !rest.some((arg) => /^-[a-zA-Z]*S/.test(arg))
  return true
}

/** Why an agent may not run a command that reads credentials: the keychain's `security`, or git's credential helpers. */
export const credentialReason = (words: ReadonlyArray<string>): string | undefined => {
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  if (program === 'security') return securityLooks(words.slice(1)) ? undefined : CREDENTIALS_REFUSED
  if ((program === 'gh' || program === 'glab') && words[1] === 'auth' && (words[2] === 'token' || words.includes('--show-token')))
    return CREDENTIALS_REFUSED
  if (program.startsWith('git-credential')) return CREDENTIALS_REFUSED
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
export const HOME_WORD = /^(~|\$HOME|\$\{HOME\}|\$env:(USERPROFILE|HOME)|%USERPROFILE%)(?=$|[/\\])/i

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
export const pathsInWord = (word: string): ReadonlyArray<string> =>
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
export const secretCommandReason = (text: string, cwd?: string, system: System = systemOf()): string | undefined => {
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
export const secretReason = (request: PermissionRequest, cwd?: string, system: System = systemOf()): string | undefined => {
  // A sandbox's network request names a host, not a command: nothing in it runs.
  const command =
    (request.kind === 'execute' || request.kind === 'other') && networkHostOf(request) === undefined
      ? (commandIn(request.rawInput) ?? request.title)
      : undefined
  if (command !== undefined && secretCommandReason(command, cwd, system) !== undefined) return SECRETS_REFUSED
  const { paths } = system
  return pathsOf(request).some(
    (path) => (cwd !== undefined || HOME_WORD.test(path) || paths.isAbsolute(path)) && secretPath(path, cwd ?? paths.sep, system),
  )
    ? SECRETS_REFUSED
    : undefined
}

/**
 * Why a request reads a secret, its paths read from the worktree's top and
 * from where the agent says its shell is, either of which may be where it
 * runs: a false or stale record of the shell can't hide a key it reads.
 */
export const secretOf = (request: PermissionRequest, context: RuleContext, system: System): string | undefined =>
  [context.worktree, ...(context.shell === undefined ? [] : [context.shell])]
    .map((cwd) => secretReason(request, cwd, system))
    .find((reason) => reason !== undefined)

/** A `.env` file, which holds a project's secrets; not one that only shows what goes in it (`.env.example`). */
export const envFile = (path: string) => {
  const name = path.split(/[/\\]/).at(-1) ?? ''
  return /^\.env(\.[\w.-]+)?$/.test(name) && !/\.(example|sample|template|dist|defaults?)$/.test(name)
}

/** A `.env` file outside the task's worktree, which the person keeps: it asks, whoever else would answer. */
export const envKept = (path: string) =>
  kept(`Reading ${path}, outside the task's worktree, always asks: a .env file holds the person's secrets.`, 'outside', 'floor')

/** The command an execute request runs: from its raw input where the agent gives one, else its title. */
export const commandOf = (request: PermissionRequest): string => commandIn(request.rawInput) ?? request.title

/**
 * The host a sandbox's network request is for (Claude Code's
 * `SandboxNetworkAccess`), or none. Its raw input names a host and no
 * command, and the request's title is that host: claude-agent-acp's
 * presentation gives a network request the host as its subject
 * (permissions/presentation.ts), where a tool that merely takes a `host`
 * argument keeps its own title and is read as what it says it does. A host is
 * never read as a shell command, however it is spelled (a port, an
 * underscore); a line that does name a command is read as one.
 */
export const networkHostOf = (request: PermissionRequest): string | undefined => {
  if (request.kind !== 'execute' && request.kind !== 'other') return undefined
  if (commandIn(request.rawInput) !== undefined) return undefined
  const host = field(request.rawInput, 'host')
  if (typeof host !== 'string') return undefined
  const name = host.trim()
  return name !== '' && request.title.trim() === name ? name : undefined
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

// ---- Places ----------------------------------------------------------------

export interface Places {
  readonly system: System
  /** Whether something is at a path. */
  readonly exists: (path: string) => boolean
  /** Whether a path is a folder that's there. */
  readonly folder: (path: string) => boolean
  /** The names in a folder that's there; none where it isn't. */
  readonly names: (path: string) => ReadonlyArray<string>
  readonly real: (path: string) => string
  readonly worktrees: ReadonlyArray<string>
  /** The person's own checkouts among them (`RuleContext`'s `shared`). */
  readonly shared: ReadonlyArray<string>
  readonly scratch: ReadonlyArray<string>
  /** The folder `$TMPDIR` names in the agent's commands, where the rules know it (`RuleContext`'s `temp`). */
  readonly temp: string | undefined
}

export const places = (context: RuleContext): Places => {
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
    shared: (context.shared ?? []).map(real),
    scratch: temp === undefined ? scratch : [...scratch, temp],
    temp,
  }
}

export const within = ({ paths }: System, root: string, path: string) => {
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
export const locate = (where: Places, cwd: string, path: string) => {
  const { paths, home } = where.system
  const temp = where.temp ?? where.scratch[0]
  const written = path
    .replace(HOME_WORD, home)
    .replace(HERE_WORD, cwd)
    .replace(TEMP_WORD, (word) => temp ?? word)
  return where.real(paths.resolve(cwd, written))
}

export const outside = (where: Places, path: string) =>
  !where.worktrees.some((root) => within(where.system, root, path)) && !where.scratch.some((root) => within(where.system, root, path))

/**
 * The git checkout an existing file outside the task is in: the person's
 * own, another task's. What isn't committed there is nowhere else, so
 * changing it could throw that away. None for a file that isn't there yet.
 */
export const checkoutOf = (where: Places, path: string): string | undefined => {
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
      pattern += `[${negated ? '^' : ''}${listed.replace(/[\\^]/g, '\\$&')}]`
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
export const missing = (where: Places, word: string, path: string, guessed: boolean) => {
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

export const changesCheckout = (path: string) =>
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
export const unsettled = (word: string, where?: Places) =>
  (where?.temp === undefined && leavesTemp(word)) || /[$`]|%\w+%/.test(word.replace(HOME_WORD, '').replace(KNOWN_START, ''))

/** Where a `cd` goes, as its words say, past its options (`cd -P x`, cmd's `cd /d D:\\x`); none for home. */
export const cdTarget = (words: ReadonlyArray<string>): string | undefined => {
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
export interface Following {
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
export const walkFolders = (
  { commands, scopes }: Parsed,
  start: string | undefined,
  following: Following,
  visit: (written: ReadonlyArray<string>, folders: ReadonlyArray<Folder>) => void,
  /** Whether `start` is where the shell is, as its agent says, rather than a guess. */
  known = false,
): ReadonlyArray<Folder> => {
  const unknown: Folder = { at: following.unknown, blind: true }
  // Where the command before succeeded and where it failed, which `&&` and `||` pick between.
  let ok: ReadonlyArray<Folder> = [{ at: start, blind: false, guessed: !known }]
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

/** Escapes a string for a regular expression. */
export const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
