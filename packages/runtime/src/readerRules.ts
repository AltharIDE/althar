import { gitCall } from './gitPermissionRules'
import { type System, systemOf, ALLOW } from './ruleContext'
import {
  HOME_WORD,
  pathsOf,
  field,
  envFile,
  pathsInWord,
  credentialReason,
  secretCommandReason,
  secretReason,
  commandIn,
} from './rulePaths'
import {
  parseCommandLine,
  REDIRECTS,
  splitCommandLine,
  SHELL_KEYWORDS,
  withoutQuotedHeredocs,
  writes,
  onlyRedirects,
  unwrap,
  redirectsLast,
  readsWeb,
} from './shellCommands'
import type { PermissionRequest } from '@althar/provider-adapters'
import { realpathSync } from 'node:fs'
import { posix } from 'node:path'

// ---- Roles that only read ----------------------------------------------------

/*
 * Review roles that only read (workspaces/tool lists deferred to task-as-parts)
 * are never asked about and never asks: what it may do, it does, and
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
 * `find`, `sed`, `awk`, `printf` and `test` are read more closely below.
 */
const READS: Readonly<Record<string, Flags | 'any' | 'git' | 'find' | 'sed' | 'env' | 'printf' | 'test' | 'awk'>> = {
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
  seq: 'any',
  test: 'test',
  '[': 'test',
  '[[': 'test',
  awk: 'awk',
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

/** A `sed` script that only prints lines: `1,40p`, `$p`, `/re/p`, `12,+8p`. Anything else (`w`, `e`, `r`) is refused. */
const SED_PRINTS = /^((\d+|\$|\/[^/]*\/)(,(\d+|\$|\/[^/]*\/|[+~]\d+))?)?p$/

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

/** What `[[` works out as arithmetic besides, which can run a command through a subscript: its numeric comparisons. */
const DOUBLE_TEST_EVALUATES = new Set([...TEST_EVALUATES, '-eq', '-ne', '-lt', '-le', '-gt', '-ge'])

/**
 * What in an `awk` program writes or runs a command: `system()`, a pipe to or
 * from one (`print | "sort"`, `"date" | getline`), `print` or `printf` to a
 * file, and gawk's `@load` and `@include`. A comparison inside a `print`
 * (`print ($1 > 2)`) reads as one too, which only refuses more.
 */
const AWK_RUNS = /\bsystem\s*\(|\|&|\|\s*getline\b|\bprintf?\b[^;{}\n]*[|>]|@(load|include)\b/

/** `awk`'s flags that only say how it reads: a field separator, a variable set for its program. */
const AWK_FLAGS = /^(-F.*|-v.*|--)$/

/** Why an `awk` command would write a file or run a command, or nothing where its program only prints what it reads. */
const awkReason = (args: ReadonlyArray<string>): string | undefined => {
  let at = 0
  for (; at < args.length && (args[at] ?? '').startsWith('-'); at += 1) {
    const flag = args[at] ?? ''
    if (!AWK_FLAGS.test(flag)) return `\`awk ${flag}\` reads its program from a file or loads more, and this role only reads.`
    if (flag === '--') {
      at += 1
      break
    }
    if (flag === '-F' || flag === '-v') at += 1
  }
  const program = args[at] ?? ''
  return AWK_RUNS.test(program.replaceAll('||', ''))
    ? '`awk` may only print what it reads here: `system()`, a pipe or `print > file` runs a command or writes, and this role only reads.'
    : undefined
}

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
])

/** How a listing is laid out, which takes a value: `--format=%(refname:short)`, `--sort -committerdate`. */
const GIT_LIST_LAYOUT = /^(--format|--sort|--points-at|--column)(=.*)?$/

/**
 * Whether `git branch`, `tag` or `remote` only lists: every word a flag that
 * lists, or, for `git branch`, lays out the list, and the values those take.
 * A trusted reader's `git tag` is read more closely (`gitTagReason`).
 */
const onlyLists = (subcommand: string, args: ReadonlyArray<string>): boolean => {
  const laidOut = subcommand === 'branch'
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    // `show` is a subcommand of `git remote`'s; to `git branch` or `git tag` it is the name of one to make.
    if (GIT_LIST_FLAGS.has(arg) || (arg === 'show' && subcommand === 'remote')) continue
    if (!laidOut) return false
    if (arg === '--no-column' || arg === '-i' || arg === '--ignore-case' || arg === '--omit-empty') continue
    if (!GIT_LIST_LAYOUT.test(arg)) return false
    if (!arg.includes('=') && arg !== '--column') index += 1
  }
  return true
}

/**
 * How far a reader is trusted: not at all, as a review's lead; `true`, as the
 * coordinator in its own copies (ADR-058); `'contained'`, as the coordinator
 * whose every command runs in a sandbox held to its folder and no network,
 * where what writes its copies writes only what is thrown away.
 */
type Trust = boolean | 'contained'

/** `git fetch`'s flags a contained reader may use: none that names a program, a file to write or a remote of its own. */
const GIT_FETCH_FLAGS =
  /^(-q|--quiet|-v|--verbose|--all|-p|--prune|-P|--prune-tags|-t|--tags|-n|--no-tags|--dry-run|--progress|--no-progress)$/

/**
 * Why a contained reader's `git fetch` would do more than bring its copy's
 * only remote, the mirror Althar fetched before the turn (ADR-058): a flag
 * beyond those, a remote or URL but `origin`, or a refspec that names where
 * it writes.
 */
const gitFetchReason = (args: ReadonlyArray<string>): string | undefined => {
  const flag = args.find((arg) => arg.startsWith('-') && !GIT_FETCH_FLAGS.test(arg))
  if (flag !== undefined) return `\`git fetch ${flag}\` goes beyond bringing a copy's remote, and this role only reads.`
  const [remote, ...refs] = args.filter((arg) => !arg.startsWith('-'))
  if (remote !== undefined && remote !== 'origin')
    return "`git fetch` here brings only a copy's own remote, `origin`; name no other, as this role only reads."
  const ref = refs.find((each) => !/^[\w./-]+$/.test(each))
  return ref === undefined
    ? undefined
    : `\`git fetch\` with \`${ref}\` names where it writes; fetch the branch by its name alone, as this role only reads.`
}

/** Why a git command a reader wants to run would change something or run a program, or nothing when it only looks. */
const gitReason = (words: ReadonlyArray<string>, trusted: Trust): string | undefined => {
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
  if (GIT_LISTS.has(call.subcommand) && onlyLists(call.subcommand, call.args)) return undefined
  if (trusted && call.subcommand === 'tag') return gitTagReason(call.args)
  // Its sandbox keeps a fetch in its copy, from the mirror, whatever runs it: so it may fetch in a loop, as it may on a line of its own.
  if (trusted === 'contained' && call.subcommand === 'fetch') return gitFetchReason(call.args)
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

/**
 * What stands for the output of a substitution that prints only digits
 * (`numbersOnly`), and for an arithmetic expansion's: a number, as any it
 * prints is to every rule here, among a command's words, in a `sed` script
 * or in arithmetic.
 */
const NUMBER = '1'

/** What stands for an arithmetic expansion until `variantsOf` reads it: `${ALTHAR_ARITH0}`, by its number. */
const arithmeticStandIn = (number: number) => `\${ALTHAR_ARITH${number}}`

const ARITHMETIC_STAND_IN = /^\$\{ALTHAR_ARITH(\d+)\}$/

/** Patterns that match a run of digits and nothing else. */
const DIGIT_RUNS = new Set(['[0-9]+', '[[:digit:]]+', '[0-9][0-9]*', '[[:digit:]][[:digit:]]*'])

/** A command's words without its redirects and what they name: `wc -l < notes.md` is `wc -l`. */
const withoutAnyRedirects = (words: ReadonlyArray<string>, operators: ReadonlySet<number>): ReadonlyArray<string> =>
  words.filter((word, index) => !operators.has(index) && !(operators.has(index - 1) && REDIRECTS.includes(words[index - 1] ?? '')))

/**
 * Whether a command prints only digits, with spaces or new lines between,
 * whatever it reads: a count from `wc`, or what `grep -o` or `tr -cd`
 * keeps of it.
 */
const printsDigits = (words: ReadonlyArray<string>): boolean => {
  const [program, ...args] = words
  const flags = args.filter((arg) => arg.startsWith('-'))
  const operands = args.filter((arg) => !arg.startsWith('-'))
  if (program === 'wc') return operands.length === 0 && flags.every((flag) => /^-[lcwm]+$/.test(flag))
  if (program === 'tr') return args.length === 2 && /^-(cd|dc)$/.test(args[0] ?? '') && ['0-9', '[:digit:]'].includes(args[1] ?? '')
  if (program !== 'grep' || operands.length !== 1 || !flags.every((flag) => /^-[oxE]+$/.test(flag))) return false
  const letters = flags.join('')
  const pattern = operands[0] ?? ''
  const anchored = pattern.startsWith('^') && pattern.endsWith('$')
  const run = anchored ? pattern.slice(1, -1) : pattern
  // `+` repeats only in an extended pattern; in a basic one it is a `+` to match.
  return DIGIT_RUNS.has(run) && (!run.endsWith('+') || letters.includes('E')) && (anchored || /[ox]/.test(letters))
}

/** Whether a command prints only some of the lines it reads, unchanged: `head -1`, `sort -n`. */
const keepsLines = (words: ReadonlyArray<string>): boolean => {
  const [program, ...args] = words
  if (program === 'head' || program === 'tail') return args.every((arg) => /^(-n?\d*|\d+)$/.test(arg))
  return program === 'sort' && args.every((arg) => /^-[nru]+$/.test(arg))
}

/**
 * Whether a substitution's command prints only digits: one pipeline whose
 * last command that changes what it prints is a count or keeps only digits
 * (`grep -n x f | head -1 | cut -d: -f1 | grep -oE '[0-9]+'`), or `git
 * rev-list --count`. What it prints is then a number, never a flag, nor a
 * `sed` command, nor arithmetic that could run one.
 */
const numbersOnly = (script: string): boolean => {
  const { commands, ends, operators, opaque, grouped, evaluated } = splitCommandLine(script)
  if (opaque || grouped || evaluated || commands.length === 0 || ends.slice(0, -1).some((end) => end !== '|')) return false
  const stages = commands.map((words, index) => withoutAnyRedirects(words, operators[index] ?? new Set()))
  let last = stages.length - 1
  while (last > 0 && keepsLines(stages[last] ?? [])) last -= 1
  const producer = stages[last] ?? []
  if (printsDigits(producer)) return true
  return stages.length === 1 && producer[0] === 'git' && producer[1] === 'rev-list' && producer.includes('--count') && namesOnly(script)
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

/** What a process substitution stands for once its command is read: a file descriptor's path. */
const PROCESS_FILE = '/dev/fd/63'

/**
 * The commands a line's substitutions run, `$(…)` and backticks, and the
 * line with each one's output standing as `OUTPUT`, outside quotes, so it
 * is read as words the shell expands; or why it can't be read so. For a
 * trusted reader: each command is read as a line of its own. An arithmetic
 * expansion, `$((…))`, stands as `${ALTHAR_ARITH0}`, by its number, for
 * `variantsOf` to read once it knows what the line's variables hold.
 */
const substitutionsIn = (
  text: string,
): { readonly scripts: ReadonlyArray<string>; readonly text: string; readonly arithmetic: ReadonlyArray<string> } | string => {
  const scripts: Array<string> = []
  const arithmetic: Array<string> = []
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
      const stands = numbersOnly(script) ? NUMBER : namesOnly(script) ? NAMES : OUTPUT
      return quoted ? `"${stands}"` : stands
    }
    if (char === '$' && text[index + 1] === '(' && text[index + 2] === '(') {
      const end = closingOf(text, index + 2)
      if (end === -1 || text[end - 1] !== ')' || closingOf(text, index + 3) !== end - 1)
        return "Althar can't tell where this `$((…))` ends, and this role only reads."
      out += arithmeticStandIn(arithmetic.length)
      arithmetic.push(text.slice(index + 3, end - 1))
      index = end
      continue
    }
    // `<(…)` and `>(…)` run a command of their own too, which stands as a file: read like `$(…)`, never refused for being one.
    if ((char === '<' || char === '>') && text[index + 1] === '(' && !quoted) {
      const end = closingOf(text, index + 2)
      if (end === -1) return "Althar can't tell where this process substitution ends, and this role only reads."
      scripts.push(text.slice(index + 2, end))
      out += PROCESS_FILE
      index = end
      continue
    }
    if (char === '$' && text[index + 1] === '(') {
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
  return { scripts, text: out, arithmetic }
}

/** Whether all a word's shell expands is the output of substitutions that print only names (`NAMES`): it can't become a flag. */
const onlyNames = (word: string) => {
  if (!word.includes(NAMES)) return false
  const rest = word.replaceAll(NAMES, 'x')
  return !/[*?[$]/.test(rest) && !/\{[^{}]*(,|\.\.)[^{}]*\}/.test(rest)
}

/*
 * A trusted reader's line may set variables of its own and use them later in
 * it (`for r in a b; do git -C "$r" status -sb; done`, `n=$(…); sed -n
 * "${n},+8p" f`), and work out arithmetic. What each variable may hold is
 * read from what sets it: a word as written, what a substitution prints
 * (`OUTPUT`, `NAMES`, `NUMBER`), or, where what sets it may not have run,
 * whatever the environment holds too, as `OUTPUT`. The line is then read
 * once for each value, with the value in place of the variable, by every
 * rule a line without variables meets: so a variable is never more than what
 * it stands for written out.
 */

/**
 * zsh's own variables with lower-case names, which change what runs or what
 * the shell does (`path=.` sets `PATH`): none a line may set. Every variable
 * either shell reads for itself otherwise has an upper-case name.
 */
const ZSH_OWN = new Set([
  'path',
  'fpath',
  'cdpath',
  'manpath',
  'mailpath',
  'module_path',
  'fignore',
  'psvar',
  'watch',
  'histchars',
  'prompt',
  'argv',
  'status',
  'pipestatus',
  'signals',
  'options',
  'parameters',
  'commands',
  'functions',
  'aliases',
  'galiases',
  'saliases',
  'builtins',
  'modules',
  'nameddirs',
  'userdirs',
  'usergroups',
  'reswords',
  'patchars',
  'widgets',
  'keymaps',
  'dirstack',
  'history',
  'historywords',
  'jobdirs',
  'jobstates',
  'jobtexts',
  'funcstack',
  'functrace',
  'funcfiletrace',
  'funcsourcetrace',
  'mapfile',
  'termcap',
  'terminfo',
  'errnos',
  'sysparams',
  'match',
  'mbegin',
  'mend',
  'reply',
])

/** Whether a line may set a variable of this name: a lower-case one that neither shell reads for itself. */
const settable = (name: string) => /^[a-z][a-z0-9_]*$/.test(name) && !ZSH_OWN.has(name) && !/^(zsh|zle|dis_)/.test(name)

/** A value written out that reads the same wherever it stands, unquoted or quoted: nothing in it the shell expands or splits. */
const PLAIN_VALUE = /^[\w@%+=:,./~-]*$/

/** What a command of a trusted reader's line does to its variables, past the keywords before it. */
type Sets =
  | { readonly _tag: 'keywords' }
  | { readonly _tag: 'for'; readonly name: string; readonly words: ReadonlyArray<string> | undefined }
  | { readonly _tag: 'read'; readonly names: ReadonlyArray<string> }
  | { readonly _tag: 'assign'; readonly pairs: ReadonlyArray<readonly [string, string]> }

/** The keywords a command may start with, past which its words are what it runs: `do`, `then`, `while`, a closing `done`. */
const HEAD_WORDS = new Set([...SHELL_KEYWORDS, 'fi', 'done', '}'])

/**
 * What a command, as words without its redirects, does to its variables:
 * only keywords (`done`, `fi`), `for name in …`, `read -r name…` (with an
 * `IFS=` of its own), or setting variables and nothing else. Otherwise
 * undefined: it runs something, and is read as any command is.
 */
const setsOf = (bare: ReadonlyArray<string>): Sets | undefined => {
  let index = 0
  while (index < bare.length && HEAD_WORDS.has(bare[index] ?? '')) index += 1
  const rest = bare.slice(index)
  if (rest.length === 0) return { _tag: 'keywords' }
  const [first = '', name = '', inWord, ...words] = rest
  if (first === 'for')
    return settable(name) && (inWord === undefined || inWord === 'in')
      ? { _tag: 'for', name, words: inWord === undefined ? undefined : words }
      : undefined
  const ifs = rest.findIndex((word) => !word.startsWith('IFS='))
  if (rest[ifs] === 'read') {
    const args = rest.slice(ifs + 1)
    const names = args[0] === '-r' ? args.slice(1) : args
    return names.length > 0 && names.every(settable) ? { _tag: 'read', names } : undefined
  }
  const pairs = rest.map((word) => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word))
  if (pairs.every((pair) => pair !== null && settable(pair[1] ?? '')))
    return { _tag: 'assign', pairs: pairs.map((pair) => [pair?.[1] ?? '', pair?.[2] ?? ''] as const) }
  return undefined
}

/** Where a variable is set: by which command, to what, and the commands after it that surely see it so (`[from, to]`). */
interface Binding {
  readonly name: string
  readonly at: number
  readonly values: ReadonlyArray<string>
  sure: readonly [number, number] | undefined
}

/** Why arithmetic would run a command, set a variable or read what isn't known to be a number; nothing when it only works out a number. */
const arithmeticReason = (expression: string, valuesOf: (name: string) => ReadonlyArray<string> | undefined): string | undefined => {
  const plain = expression.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, '$1$2')
  if (!/^[\w\s+\-*/%<>=!&|^~?:,()]*$/.test(plain))
    return 'This arithmetic, `$((…))`, holds more than numbers, variables and operators, and this role only reads.'
  if (plain.replace(/[=!<>]=/g, '').includes('=') || /\+\+|--/.test(plain))
    return 'This arithmetic, `$((…))`, sets a variable, which changes what runs; work the number out without setting one, as this role only reads.'
  for (const name of plain.match(/\b[0-9]\w*|[A-Za-z_]\w*/g) ?? []) {
    if (/^[0-9]/.test(name)) continue
    const values = valuesOf(name)
    if (values === undefined || !values.every((value) => /^\d+$/.test(value)))
      return `Arithmetic, \`$((…))\`, works out what \`${name}\` holds as arithmetic too, which can run a command where it holds what a command printed, and Althar can't tell it holds a number. Keep only its digits as you set it (\`n=$(… | grep -oE '[0-9]+')\`), as this role only reads.`
  }
  return undefined
}

/** A `$name` or `${name}` the shell expands, outside single quotes: where it is, and whether it is inside double ones. */
interface Use {
  readonly from: number
  readonly to: number
  readonly name: string
  readonly quoted: boolean
}

/** Every variable a text expands, by name, outside single quotes and `$'…'`, with where it stands. */
const usesIn = (text: string): ReadonlyArray<Use> => {
  const uses: Array<Use> = []
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char === '\\') index += 1
    else if (char === "'" && !quoted) {
      const close = text.indexOf("'", index + 1)
      index = close === -1 ? text.length : close
    } else if (char === '$' && text[index + 1] === "'" && !quoted) {
      let end = index + 2
      while (end < text.length && text[end] !== "'") end += text[end] === '\\' ? 2 : 1
      index = end
    } else if (char === '"') quoted = !quoted
    else if (char === '$') {
      const found = /^\{([A-Za-z_][A-Za-z0-9_]*)\}|^([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(index + 1))
      if (found === null) continue
      const to = index + 1 + found[0].length
      uses.push({ from: index, to, name: found[1] ?? found[2] ?? '', quoted })
      index = to - 1
    }
  }
  return uses
}

/** How many ways a line may be read, one for each value its variables may hold, before Althar stops trying. */
const MOST_VARIANTS = 64

/**
 * A trusted reader's line, after `substitutionsIn`, as many times over as
 * its variables may hold different values, each with the values in place of
 * the variables it sets and its arithmetic worked out as `NUMBER`; or why it
 * can't be read so. A line that sets none, and works out nothing, is itself.
 */
const variantsOf = (line: string, arithmetic: ReadonlyArray<string>): ReadonlyArray<string> | string => {
  const text = withoutQuotedHeredocs(line)
  const { commands, ends, operators, starts } = splitCommandLine(text)
  const bare = commands.map((written, at) => withoutAnyRedirects(written, operators[at] ?? new Set()))
  /** Each loop's first and last command, `for`, `while` or `until` to its `done`: what it runs again. */
  const loops: Array<readonly [number, number]> = []
  const blocks: Array<number | undefined> = []
  for (const [at, words] of bare.entries())
    for (const word of words) {
      if (word === 'for') {
        blocks.push(at)
        break
      }
      if (['fi', 'done', '}'].includes(word)) {
        const start = blocks.pop()
        if (start !== undefined) loops.push([start, at])
      } else if (['while', 'until'].includes(word)) blocks.push(at)
      else if (['if', '{'].includes(word)) blocks.push(undefined)
      else if (!SHELL_KEYWORDS.includes(word)) break
    }
  const setBy = bare.map((words) => {
    const sets = setsOf(words)
    if (sets === undefined || sets._tag === 'keywords') return []
    return sets._tag === 'for' ? [sets.name] : sets._tag === 'read' ? sets.names : sets.pairs.map(([name]) => name)
  })
  /** Whether a loop that runs command `at` again sets the variable at or after it, so `at` may see that on the loop's next pass. */
  const carried = (name: string, at: number) =>
    loops.some(([start, end]) => start <= at && at <= end && setBy.some((names, by) => by >= at && by <= end && names.includes(name)))
  const bindings: Array<Binding> = []
  /** What a variable may hold where command `at` reads it: undefined where nothing before it set it, so the environment's is. */
  const valuesAt = (name: string, at: number): ReadonlyArray<string> | undefined => {
    const seen = bindings.filter((binding) => binding.name === name && binding.at < at)
    // Set again later in a loop, it may hold anything on the next pass: what it holds there is read as what a command printed.
    if (carried(name, at)) return [...new Set([...seen.flatMap((binding) => binding.values), OUTPUT])]
    if (seen.length === 0) return undefined
    const values = [...new Set(seen.flatMap((binding) => binding.values))]
    const sure = seen.some(({ sure: range }) => range !== undefined && at > range[0] && at <= range[1])
    return sure || values.includes(OUTPUT) ? values : [...values, OUTPUT]
  }
  const arithmeticAt = (word: string, at: number) => {
    const number = ARITHMETIC_STAND_IN.exec(word)?.[1]
    return number === undefined ? undefined : (arithmeticReason(arithmetic[Number(number)] ?? '', (name) => valuesAt(name, at)) ?? NUMBER)
  }
  /** What a word holds once the shell has expanded it, as `valuesAt` says it; or why that can't be told. */
  const valuesOfWord = (word: string, at: number): ReadonlyArray<string> | string => {
    const worked = arithmeticAt(word, at)
    if (worked !== undefined) return worked === NUMBER ? [NUMBER] : worked
    if (word.includes('ALTHAR_ARITH')) return [OUTPUT]
    if (word === NAMES) return [NAMES]
    const named = /^\$\{?([a-z][a-z0-9_]*)\}?$/.exec(word)?.[1]
    const held = named === undefined ? undefined : valuesAt(named, at)
    if (held !== undefined) return held
    return PLAIN_VALUE.test(word) ? [word] : [OUTPUT]
  }
  /** The `for`s, `while`s, `if`s and groups open at each command, each with the variables it set for its body. */
  const open: Array<{ readonly word: string; readonly bound: Array<Binding> }> = []
  for (const [at, words] of bare.entries()) {
    for (const word of words) {
      if (word === 'for') break
      if (['fi', 'done', '}'].includes(word)) {
        for (const binding of open.pop()?.bound ?? []) if (binding.sure !== undefined) binding.sure = [binding.sure[0], at]
      } else if (['if', 'while', 'until', '{'].includes(word)) open.push({ word, bound: [] })
      else if (!SHELL_KEYWORDS.includes(word)) break
    }
    const sets = setsOf(words)
    if (sets === undefined || sets._tag === 'keywords') continue
    // Set where it surely runs, for every command after: not in a block, after `&&` or `||`, or on a side of a pipe or in the background.
    const plain = open.length === 0 && ['', ';', '\n'].includes(ends[at - 1] ?? '') && !['|', '&'].includes(ends[at] ?? '')
    const after: readonly [number, number] | undefined = plain ? [at, Number.POSITIVE_INFINITY] : undefined
    if (sets._tag === 'for') {
      const values: Array<string> = []
      for (const word of sets.words ?? [OUTPUT]) {
        const held = valuesOfWord(word, at)
        if (typeof held === 'string') return held
        values.push(...held)
      }
      const binding: Binding = {
        name: sets.name,
        at,
        values: values.length === 0 ? [OUTPUT] : values,
        sure: [at, Number.POSITIVE_INFINITY],
      }
      bindings.push(binding)
      open.push({ word: 'for', bound: [binding] })
    } else if (sets._tag === 'read') {
      // What `while read` reads is surely set in the loop's body.
      const loop = open.at(-1)
      const inLoop = loop?.word === 'while' && words[0] === 'while'
      for (const name of sets.names) {
        const binding: Binding = { name, at, values: [OUTPUT], sure: inLoop ? [at, Number.POSITIVE_INFINITY] : after }
        bindings.push(binding)
        if (inLoop) loop.bound.push(binding)
      }
    } else
      for (const [name, value] of sets.pairs) {
        const held = valuesOfWord(value, at)
        if (typeof held === 'string') return held
        bindings.push({ name, at, values: held, sure: after })
      }
  }
  const commandAt = (offset: number) => starts.findLastIndex((start) => start <= offset)
  const groups = new Map<string, { readonly values: ReadonlyArray<string>; readonly uses: Array<Use> }>()
  for (const use of usesIn(text)) {
    const at = commandAt(use.from)
    const worked = arithmeticAt(`\${${use.name}}`, at)
    if (worked !== undefined && worked !== NUMBER) return worked
    const values = worked === NUMBER ? [NUMBER] : settable(use.name) ? valuesAt(use.name, at) : undefined
    if (values === undefined) continue
    const key = `${use.name}\u0000${values.join('\u0000')}`
    const group = groups.get(key) ?? { values, uses: [] }
    group.uses.push(use)
    groups.set(key, group)
  }
  const unread = "Althar can't tell what this `$((…))` works out, and this role only reads."
  if (bindings.length === 0 && groups.size === 0) return line.includes('ALTHAR_ARITH') ? unread : [line]
  const all = [...groups.values()]
  if (all.reduce((count, group) => count * group.values.length, 1) > MOST_VARIANTS)
    return "This line's variables may hold more values than Althar reads through; run it in parts, as this role only reads."
  let variants: Array<ReadonlyArray<readonly [Use, string]>> = [[]]
  for (const group of all)
    variants = variants.flatMap((chosen) => group.values.map((value) => [...chosen, ...group.uses.map((use) => [use, value] as const)]))
  const read = variants.map((chosen) =>
    [...chosen]
      .sort(([a], [b]) => b.from - a.from)
      .reduce((written, [use, value]) => {
        // What a command printed stands unquoted, so it is read as words the shell expands, as a substitution's is.
        const put = use.quoted && value.startsWith('$') ? `"${value}"` : value
        return written.slice(0, use.from) + put + written.slice(use.to)
      }, text),
  )
  // Every arithmetic is read above, wherever it stands; one left would be worked out unread.
  return read.some((variant) => variant.includes('ALTHAR_ARITH')) ? unread : read
}

/** Why `sed` would run what a command printed as its script: it could be any `sed` command, `w` among them, which writes. */
const SED_OUTPUT =
  "`sed` would run what a command printed as its script, which could be any `sed` command, `w` among them, which writes. Keep only its digits as you set it (`n=$(… | grep -oE '[0-9]+')`), as this role only reads."

/** Why one command would change something or run another program, or nothing when it only looks. */
export const readerWordsReason = (words: ReadonlyArray<string>, trusted: Trust = false): string | undefined => {
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
      case 'awk':
        return awkReason(args)
      case 'test': {
        const operator = args.find((arg) => (program === '[[' ? DOUBLE_TEST_EVALUATES : TEST_EVALUATES).has(arg))
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
const readerCommandReason = (
  text: string,
  trusted: Trust = false,
  // How a shell's script is read: a trusted reader's as a line of its own, its variables and loops with it.
  scriptReason: (text: string) => string | undefined = (inner) => readerCommandReason(inner, trusted),
): string | undefined => {
  const { commands, operators, expanded, opaque, grouped, evaluated, substituted } = splitCommandLine(text)
  // Only outside quotes: inside them `<(` is text. A trusted reader's are read before this, as `$(…)` is (`substitutionsIn`).
  if (substituted) return 'A process substitution, `<(…)`, runs a command of its own, and this role only reads.'
  if (opaque) return "Althar can't tell what this command does until it runs, and this role only reads."
  if (grouped)
    return 'Parentheses start a subshell, define a function or qualify a pattern, any of which can run a command of its own; quote them where they are text, as this role only reads.'
  if (evaluated)
    return 'An expansion such as `${X:=…}`, `$[…]` or `$a[…]` can set a variable or work out arithmetic, which changes what runs; name a variable plainly, as `$X`, as this role only reads.'
  for (const [index, written] of commands.entries()) {
    // Redirects after the rest, as the shell reads them: `> /dev/null security …` runs `security`.
    const { words, at: movedTo } = redirectsLast(written, operators[index] ?? new Set())
    // A trusted reader's `for`, `read`, assignment or closing keyword runs nothing; `variantsOf` read what it sets.
    if (trusted && setsOf(withoutAnyRedirects(written, operators[index] ?? new Set())) !== undefined) {
      const targets = writes(words).filter((target) => target !== '/dev/null')
      if (targets.length > 0) return `It would write to ${targets[0]}, and this role only reads.`
      continue
    }
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
      const reason = scriptReason(args[script + 1] ?? '')
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
      // As `sed`'s script it is worse than a flag; digits alone are neither.
      if (
        at !== undefined &&
        program === 'sed' &&
        at === 1 + args.findIndex((arg) => !arg.startsWith('-')) &&
        SUBSTITUTED.test(inner[at] ?? '')
      )
        return SED_OUTPUT
      if (at !== undefined && SUBSTITUTED.test(inner[at] ?? ''))
        return `What \`$(…)\` prints, or a variable set from it, could start with a dash, which \`${program}\` would take for a flag: run it on its own and name what it prints, or put it after \`--\`, as this role only reads.`
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
  readonly web?: boolean
  readonly offline?: boolean
  readonly cwd?: string
  readonly trusted?: boolean
  /**
   * A trusted reader whose agent runs its commands in a sandbox held to its
   * folder (ADR-058): what a command writes stays in its copies, so it may
   * `git fetch` there wherever the command asks, as in a loop. A read the
   * sandbox cannot run may retry outside, against the reader's rules.
   */
  readonly contained?: boolean
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
    const variants = variantsOf(found.text, found.arithmetic)
    if (typeof variants === 'string') return variants
    for (const script of found.scripts) {
      const reason = readerLineReason(script, options)
      if (reason !== undefined) return reason
    }
    return variants.map((line) => plainReaderLineReason(line, options)).find((reason) => reason !== undefined)
  }
  return plainReaderLineReason(command, options)
}

/** Why a line, its substitutions and variables read already, would do more than look: the rules every reader's line meets. */
const plainReaderLineReason = (command: string, options: ReaderOptions): string | undefined => {
  if (options.trusted === true && options.cwd !== undefined && envOutsideIn(command, options.cwd)) return ENV_REFUSED
  return (
    parseCommandLine(command)
      .commands.map((words) => credentialReason(unwrap(words)))
      .find((found) => found !== undefined) ??
    secretCommandReason(command, options.cwd) ??
    readerCommandReason(command, options.trusted === true ? (options.contained === true ? 'contained' : true) : false, (script) =>
      readerLineReason(script, options),
    )
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
      if (options.web === true && options.offline !== true && readsWeb(command)) return ALLOW
      const reason = readerLineReason(command, options)
      return reason === undefined ? ALLOW : deny(reason)
    }
  }
}
