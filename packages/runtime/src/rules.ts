import { type GitCall, gitCall, pushKinds, PUSH_OPTIONS_WITH_VALUE } from './gitPermissionRules'
import { mcpActOf } from './mcpActs'
import { readerWordsReason } from './readerRules'
import {
  type Kept,
  kept,
  type ProjectRuleSet,
  type System,
  type RuleContext,
  type Floor,
  MVP_RULES,
  floorOf,
  exactly,
  type AllowRule,
  type RuleId,
  type Verdict,
  systemOf,
  RULE_WORDS,
  ask,
  ALLOW,
  RULES,
} from './ruleContext'
import {
  type Places,
  locate,
  places,
  walkFolders,
  outside,
  type Following,
  unsettled,
  cdTarget,
  checkoutOf,
  within,
  missing,
  changesCheckout,
  pathsInWord,
  envFile,
  envKept,
  literal,
  networkHostOf,
  commandOf,
  pathsOf,
  credentialReason,
  secretOf,
  commandIn,
  field,
  COMMAND_KEPT,
} from './rulePaths'
import {
  lineReadings,
  commandsIn,
  operandsOf,
  copied,
  WRITES_LAST,
  readings,
  redirects,
  writes,
  unwrap,
  xargsRuns,
  withoutQuotedHeredocs,
  onlyRedirects,
  takesScript,
  readsWeb,
  parseCommandLine,
  assignment,
  INTERPRETERS,
} from './shellCommands'
import { hostOf } from '@althar/contracts'
import type { PermissionRequest, McpCall } from '@althar/provider-adapters'
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

export {
  type Verdict,
  RULES,
  type RuleId,
  type CommandRule,
  type AllowRule,
  type ProjectRuleSet,
  sayAllowRule,
  sayRules,
  MVP_RULES,
  type RuleContext,
} from './ruleContext'
export { commandOf, commandIn, essentials, pathsOf } from './rulePaths'
export { type Parsed, parseCommandLine, withoutQuotedHeredocs, programOf, shortCommand, readsWeb } from './shellCommands'
export { type ReaderVerdict, ALTHAR_TOOL, OFFLINE, type ReaderOptions, decideReader } from './readerRules'

/** Visible irreversible code-host actions. Unknown operations run (ADR-097). */
const hostKinds = (words: ReadonlyArray<string>): ReadonlyArray<Kept> => {
  const program = (words[0] ?? '').split('/').at(-1)
  if (program !== 'gh' && program !== 'glab') return []
  const args = words
    .slice(1)
    .filter((word, i, all) => !word.startsWith('-') && !['-R', '--repo', '--hostname', '-H'].includes(all[i - 1] ?? ''))
  const [command, action] = args
  if (words.includes('--help') || words.includes('--version')) return []
  if (command === 'auth' && action === 'token') return [kept('Exporting credentials always asks.', 'outside', 'irreversible')]
  const publish = (reason: string) => [kept(reason, 'deploy', 'irreversible')]
  const speak = () => [kept('Speaking for the person always asks.', 'speak', 'irreversible')]
  if (['pr', 'mr'].includes(command ?? '') && action === 'merge') return publish('Merging always asks.')
  if (command === 'release' && ['create', 'upload', 'delete'].includes(action ?? ''))
    return publish('Publishing or deleting a release always asks.')
  if (['pr', 'mr', 'issue'].includes(command ?? '') && ['create', 'comment', 'review', 'note'].includes(action ?? '')) return speak()
  if (['issue', 'release'].includes(command ?? '') && action === 'delete')
    return [kept('Deleting work on the host always asks.', 'deploy', 'irreversible')]
  if (command === 'release' && action === 'edit' && /(?:^|\s)--draft(?:=|\s+)false(?:\s|$)/.test(words.join(' ')))
    return publish('Publishing a release always asks.')
  if (command === 'repo' && action === 'delete') return publish('Deleting a repository always asks.')
  if (command !== 'api') return []
  const value = (flag: string) =>
    words.find((word) => word.startsWith(flag + '='))?.slice(flag.length + 1) ??
    (words.indexOf(flag) < 0 ? undefined : words[words.indexOf(flag) + 1])
  const explicit = words.some((word) => /^(-X|--method)(=|$)/.test(word))
    ? (value('--method') ?? value('-X'))
    : words.find((word) => /^-X[A-Z]+$/.test(word))?.slice(2)
  const writes = words.some((word) => /^(-[fF]|--field|--raw-field|--input)(=|$)/.test(word))
  const method = explicit?.toUpperCase() ?? (writes ? 'POST' : 'GET')
  if (method === 'GET' || method === 'HEAD') return []
  const input = words.join(' ')
  if (/\/(merge|merges|releases)(?:\/|\s|$)|mergePullRequest|createRelease|deleteRepository/.test(input))
    return publish('Publishing, merging or teardown always asks.')
  if (
    /\/(comments|reviews)(?:\/|\s|$)|addComment|addPullRequestReview|createIssue/.test(input) ||
    (method === 'POST' && /\/(issues|pulls)(?:\s|$)/.test(input))
  )
    return speak()
  // A ref written through the API moves a branch or makes a tag: git's own guard never sees it.
  if (/\brefs\/tags\b/.test(input)) return publish('Publishing a tag always asks.')
  if (/\brefs\b/.test(input) && /\/(git\/)?refs(?:\/|\s|$)/.test(input))
    return [kept('Moving a branch or tag on the host always asks.', 'delete-branch', 'irreversible')]
  if (method === 'DELETE' && /(^|\/|\s)(repos|refs|branches)\//.test(input))
    return [kept('Deleting remote work always asks.', 'delete-branch', 'irreversible')]
  return []
}

/** What an agent never does on the person's code host: approve its own work or widen what the host lets agents do. */
const SELF_APPROVAL_REFUSED = "An agent doesn't approve its own work or widen what the host lets agents do. The person does that."

/** Why a `gh`/`glab` call is refused rather than asked: it would approve the agent's own work or widen access (ADR-097). */
const hostRefusedReason = (words: ReadonlyArray<string>): string | undefined => {
  const program = (words[0] ?? '').split('/').at(-1)
  if (program !== 'gh' && program !== 'glab') return undefined
  if (words.includes('--help') || words.includes('--version')) return undefined
  const args = words
    .slice(1)
    .filter((word, i, all) => !word.startsWith('-') && !['-R', '--repo', '--hostname', '-H'].includes(all[i - 1] ?? ''))
  const [command, action] = args
  const line = words.join(' ')
  if (['pr', 'mr'].includes(command ?? '') && action === 'review' && /(?:^|\s)--approve(?:=|\s|$)/.test(line)) return SELF_APPROVAL_REFUSED
  // GitLab approves with a command of its own, and a merge request's approval is the same self-approval.
  if (command === 'mr' && action === 'approve') return SELF_APPROVAL_REFUSED
  if ((command === 'secret' || command === 'variable') && action === 'set') return SELF_APPROVAL_REFUSED
  if (command === 'repo' && action === 'edit' && /(?:^|\s)--visibility(?:=|\s+)public(?:\s|$)/.test(line)) return SELF_APPROVAL_REFUSED
  if (command !== 'api') return undefined
  const value = (flag: string) =>
    words.find((word) => word.startsWith(flag + '='))?.slice(flag.length + 1) ??
    (words.indexOf(flag) < 0 ? undefined : words[words.indexOf(flag) + 1])
  const explicit = words.some((word) => /^(-X|--method)(=|$)/.test(word))
    ? (value('--method') ?? value('-X'))
    : words.find((word) => /^-X[A-Z]+$/.test(word))?.slice(2)
  const writes = words.some((word) => /^(-[fF]|--field|--raw-field|--input)(=|$)/.test(word))
  const method = (explicit ?? (writes ? 'POST' : 'GET')).toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined
  // An approval, a commit status or a check run is the agent vouching for its own work, by REST, `glab`'s own path or GraphQL.
  if (/\bpulls\/[^/\s]+\/reviews\b/.test(line) && /APPROVE|--approve/.test(line)) return SELF_APPROVAL_REFUSED
  if (/\b(addPullRequestReview|mergeRequestApprove|mergeRequestAccept)\b/.test(line) && /approve/i.test(line)) return SELF_APPROVAL_REFUSED
  if (/\bmerge_requests\/[^/\s]+\/approve\b/.test(line)) return SELF_APPROVAL_REFUSED
  if (/\b(statuses|check-runs|check-suites|createCommitStatus|createCheckRun|commitStatusCreate)\b/.test(line)) return SELF_APPROVAL_REFUSED
  // Protection, collaborators, secrets and a public visibility widen what the host lets agents do.
  if (
    /\bbranches\/[^/\s]+\/protection\b|BranchProtectionRule|\bprotected_(branches|tags|environments)\b/.test(line) ||
    /\bcollaborators\b|\bmembers\b|\bdeploy_(tokens|keys)\b|\baccess_tokens\b|\bvariables\b|\bactions\/(permissions|secrets)\b|\bdependabot\/secrets\b|\bcodespaces\/secrets\b|\bci\/variables\b/.test(
      line,
    ) ||
    /"visibility"\s*:\s*"public"|visibility(?:=|":\s*"?)public|--visibility(?:=|\s+)public/.test(line)
  )
    return SELF_APPROVAL_REFUSED
  return undefined
}

/**
 * A rule's pattern as a host, where it is one: a URL's host, a name with a
 * wildcard for the hosts under it (`*.example.com`), or a bare host. A word
 * that reads as a file a command runs (`deploy.sh`, `release.yml`) is a
 * command, not a host, though `hostOf` can read either as a name.
 */
const hostPatternOf = (pattern: string): { readonly host: string; readonly under: boolean } | undefined => {
  const typed = pattern.trim().toLowerCase()
  const under = typed.startsWith('*.')
  const name = under ? typed.slice(2) : typed
  const host = hostOf(name)
  if (host === null) return undefined
  // A file name is what a command rule names more often than a host: its last label is an extension.
  const extension = name.slice(name.lastIndexOf('.') + 1)
  if (!typed.includes('://') && FILE_EXTENSIONS.has(extension)) return undefined
  return { host, under }
}

/** The last labels of names that are files a command runs, not hosts. */
const FILE_EXTENSIONS = new Set([
  'bash',
  'c',
  'cfg',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'cts',
  'env',
  'fish',
  'go',
  'h',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'less',
  'lock',
  'log',
  'lua',
  'md',
  'mjs',
  'mts',
  'php',
  'pl',
  'py',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

/** Whether a host is the one a rule names, or one under it: its own name, or a name that ends in `.` and it. */
const hostMatches = (rule: { readonly host: string }, host: string): boolean => host === rule.host || host.endsWith(`.${rule.host}`)

/** The host a command's word names, where it names one: a URL's host, or a bare host that isn't a file name. */
const namedHostOf = (word: string): string | undefined => {
  const typed = word.trim()
  if (typed === '') return undefined
  const url = typed.includes('://')
  const host = hostOf(url ? typed : typed.replace(/^['"]|['"]$/g, ''))
  if (host === null) return undefined
  // A path, an option or a file a command names isn't a host: `./deploy.sh`, `--host=x`, `cat deploy.sh`.
  if (!url && (typed.startsWith('-') || /[/\\]/.test(typed) || typed.startsWith('.'))) return undefined
  if (!url && FILE_EXTENSIONS.has(typed.slice(typed.lastIndexOf('.') + 1).toLowerCase())) return undefined
  return host
}

/** The host a command names, where one of the person's own host rules matches it. */
const hostRuleOf = (text: string, rules: ProjectRuleSet['commands'], system: System) => {
  const named = new Set<string>()
  for (const line of lineReadings(text, system))
    for (const words of line.commands.flatMap((words) => [words, ...commandsIn(words)]))
      for (const word of words) {
        const host = namedHostOf(word)
        if (host !== undefined) named.add(host)
      }
  if (named.size === 0) return undefined
  const met = rules.filter((rule) => {
    const pattern = hostPatternOf(rule.pattern)
    return pattern !== undefined && [...named].some((host) => hostMatches(pattern, host))
  })
  return met.find((rule) => rule.decision === 'never') ?? met[0]
}

/**
 * Whether a never rule kept for this pattern refuses more than its own words: one that reads as a host meets a request
 * for that host or any host under it, and a command naming them, however it was kept (`hostRuleOf`). An allow rule
 * meets only its own words.
 */
export const refusesHostsUnder = (pattern: string): boolean => hostPatternOf(pattern) !== undefined

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

/**
 * What a deploy tool does that can't be undone, by its subcommand: tearing
 * down what it deployed, deleting it, or publishing a package, whose version
 * a registry never takes again.
 */
const DESTROYERS: Readonly<Record<string, RegExp>> = {
  cdk: /^destroy$/,
  terraform: /^destroy$/,
  tofu: /^destroy$/,
  pulumi: /^destroy$/,
  kubectl: /^delete$/,
  helm: /^(uninstall|delete|del)$/,
  wrangler: /^delete$/,
  vercel: /^(remove|rm)$/,
  netlify: /^sites:delete$/,
  flyctl: /^destroy$/,
  fly: /^destroy$/,
  npm: /^publish$/,
  bun: /^publish$/,
  pnpm: /^publish$/,
  yarn: /^publish$/,
  cargo: /^publish$/,
  gem: /^(publish|push)$/,
  twine: /^upload$/,
  poetry: /^publish$/,
}

/** What a dry-run flag may say and still only try: kubectl's `client` and `server`, a boolean's yes. */
const DRY_RUN_VALUES = /^(client|server|true|1|yes)$/i

/** Whether the words ask for a dry run: the bare flag, or one set to a value that only tries (`--dry-run=client`, `--dry-run server`), not `none` or `false`. */
const dryRun = (words: ReadonlyArray<string>): boolean =>
  words.some((word, index) => {
    const flag = /^--?dry-?run(?:=(.*))?$/.exec(word)
    if (flag === null) return false
    if (flag[1] !== undefined) return DRY_RUN_VALUES.test(flag[1])
    const next = words[index + 1] ?? ''
    return !/^(none|false|0|no)$/i.test(next)
  })

/** Whether a command tears down, deletes or publishes, as its program and subcommand say: not a dry run, which does neither. */
const destroys = (words: ReadonlyArray<string>): boolean => {
  const [first = '', ...rest] = words
  const program = first.slice(first.lastIndexOf('/') + 1)
  if (dryRun(rest)) return false
  const [sub = '', next = ''] = rest.filter((word) => !word.startsWith('-'))
  if (DESTROYERS[program]?.test(sub) === true) return true
  // `terraform apply -destroy`, `fly apps destroy`.
  if ((program === 'terraform' || program === 'tofu') && sub === 'apply' && rest.includes('-destroy')) return true
  return (program === 'fly' || program === 'flyctl') && sub === 'apps' && next === 'destroy'
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
  const branchKept = (how: string, branches: ReadonlyArray<string | undefined>, floor: Floor | 'none' = 'irreversible') =>
    others(branches)
      .slice(0, 1)
      .map((branch) =>
        kept(
          `${how} ${branch}, which isn't this task's branch, always asks: its commits may be nowhere else.`,
          'delete-branch',
          floor === 'none' ? undefined : floor,
        ),
      )
  const named = git.args.filter((arg) => !arg.startsWith('-'))
  switch (git.subcommand) {
    case 'branch': {
      // Git refuses `-d` for a branch whose work isn't merged: only a forced deletion can lose commits.
      if (hasFlag(git.args, '-D') || (hasFlag(git.args, '-d', '--delete') && hasFlag(git.args, '-f', '--force')))
        return branchKept('Deleting the branch', named)
      // So it doesn't ask, but a project that never allows deleting branches still refuses it.
      if (hasFlag(git.args, '-d', '--delete'))
        return (context.project ?? MVP_RULES).never.includes('delete-branch') ? branchKept('Deleting the branch', named, 'none') : []
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
      if (how === undefined || ownStash(git, context)) return []
      return [kept(`${how} always asks: every checkout of the repository shares the stash, the person's too.`, 'outside', 'floor')]
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

/**
 * A repository's stash entries' messages, `stash@{0}` first, from git's own
 * record of them (the stash's reflog in the git folder its worktrees share);
 * none where it can't be read.
 */
const stashesOf = (folder: string): ReadonlyArray<string> => {
  try {
    let at = folder
    while (!existsSync(join(at, '.git'))) {
      if (dirname(at) === at) return []
      at = dirname(at)
    }
    const dotGit = join(at, '.git')
    const linked = statSync(dotGit).isFile() ? /^gitdir: (.*)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim() : undefined
    const own = linked === undefined ? dotGit : resolve(at, linked)
    const common = existsSync(join(own, 'commondir')) ? resolve(own, readFileSync(join(own, 'commondir'), 'utf8').trim()) : own
    return readFileSync(join(common, 'logs', 'refs', 'stash'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.slice(line.indexOf('\t') + 1))
      .reverse()
  } catch {
    return []
  }
}

/**
 * Whether a `git stash pop` or `drop` takes an entry the task made itself:
 * one stashed on its branch, as git names it in the entry (`On
 * althar/retry: wip`), found by its place (`stash@{2}`, `2`, or the newest
 * where none is named). Clearing the stash takes every entry, so never.
 */
const ownStash = (git: GitCall, context: RuleContext): boolean => {
  if (context.taskBranch === undefined || git.args[0] === 'clear') return false
  const named = git.args.slice(1).filter((arg) => !arg.startsWith('-'))
  if (named.length > 1) return false
  const place = /^(?:stash@\{(\d+)\}|(\d+))$/.exec(named[0] ?? 'stash@{0}')
  if (place === null) return false
  const message = (context.stashes ?? stashesOf)(git.cwd)[Number(place[1] ?? place[2])]
  return message !== undefined && (message.startsWith(`On ${context.taskBranch}: `) || message.startsWith(`WIP on ${context.taskBranch}: `))
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
  const following = followingOf(where, context)
  const { start, known } = shellOf(where, context)
  for (const line of lines)
    walkFolders(
      line,
      start,
      following,
      (written, folders) => {
        const kinds: Array<Kept> = []
        const redirected: Array<Kept> = []
        const unseenKinds: Array<Kept> = []
        for (const { at = start, blind: unseen, guessed } of folders)
          for (const words of readings(written)) {
            const found = kindsOf(words, at, where, context, guessed === true)
            // Blind only where it is the folder that makes it so: `rm -rf ~/Documents` is that from anywhere.
            const anywhere = unseen ? kindsOf(words, start, where, context).kinds.map((one) => JSON.stringify(one)) : []
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
      },
      known,
    )
  return { opaque: lines.some((line) => line.opaque), commands: each }
}

/**
 * Where a line starts: the folder the agent's shell is in, where its own
 * record says and it is the task's or a temp folder, else the worktree's
 * top, which is only a guess (`Folder`'s `guessed`).
 */
const shellOf = (where: Places, context: RuleContext): { readonly start: string; readonly known: boolean } =>
  context.shell !== undefined && !outside(where, where.real(context.shell))
    ? { start: where.real(context.shell), known: true }
    : { start: context.worktree, known: false }

/** How to follow a line's `cd`s from the task's worktree. */
const followingOf = (where: Places, context: RuleContext): Following => ({
  resolve: (from, path) => locate(where, from ?? context.worktree, path),
  paths: where.system.paths,
  folder: where.folder,
  unknown: where.system.paths.parse(where.system.home).root,
  unsettled: (word) => unsettled(word, where),
})

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
  kinds.push(...commandsIn(words).flatMap(hostKinds))
  if (commandsIn(words).some(destroys))
    kinds.push(
      kept(
        'Tearing down, deleting or publishing always asks: once it is gone or published, it can’t be taken back.',
        'deploy',
        'irreversible',
      ),
    )
  else if (commandsIn(words).some(deploys)) kinds.push(kept('Deploying or publishing always asks.', 'deploy'))
  if (words[0] === 'cd') return done(locate(where, cwd, cdTarget(words) ?? '~'))
  const git = gitCall(words, cwd, where.system.paths)
  if (git !== undefined) {
    const repository = [locate(where, cwd, git.cwd), ...git.elsewhere.map((path) => locate(where, cwd, path))]
    const elsewhere = repository.find((path) => outside(where, path))
    if (elsewhere !== undefined) {
      // A read of another repository changes nothing; a write there is a visible outside write the coordinator refuses.
      if (context.readOnly !== true || !gitReadsElsewhere(git.subcommand, git.args))
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
    // A Local task's folder is the person's own checkout (ADR-091): what isn't committed there may be theirs, so throwing it
    // away asks there too.
    const shared =
      elsewhere === undefined ? repository.find((path) => where.shared.some((root) => within(where.system, root, path))) : undefined
    if (shared !== undefined) {
      const isPath = (name: string) => where.exists(where.system.paths.resolve(shared, name))
      if (discards(git, isPath))
        kinds.push(
          kept(
            `\`git ${git.subcommand}\` in your checkout always asks: it could throw away your own uncommitted work: ${shared}`,
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
/** Git's subcommands that only look, wherever they run; `branch`, `tag`, `remote`, `worktree` and `stash` also have writing forms. */
const GIT_READS_ELSEWHERE = new Set([
  'status',
  'log',
  'show',
  'diff',
  'grep',
  'ls-files',
  'rev-parse',
  'blame',
  'cat-file',
  'for-each-ref',
  'describe',
  'shortlog',
  'show-ref',
  'ls-tree',
  'ls-remote',
  'name-rev',
  'merge-base',
  'help',
  'version',
  'whatchanged',
  'count-objects',
  'verify-commit',
  'verify-tag',
  'fsck',
  'check-ignore',
  'check-attr',
  'check-ref-format',
  'diff-tree',
  'diff-files',
  'diff-index',
  'rev-list',
  'symbolic-ref',
])

/** Whether a git call in another folder only reads it: the coordinator may do that without asking, and nothing else. */
const gitReadsElsewhere = (subcommand: string, args: ReadonlyArray<string>): boolean => {
  if (GIT_READS_ELSEWHERE.has(subcommand)) return true
  const words = args.filter((arg) => !arg.startsWith('-'))
  const flags = args.filter((arg) => arg.startsWith('-'))
  if (subcommand === 'config')
    return (
      flags.some((flag) => /^(--get(?:-all|-regexp|-urlmatch)?|--list|-l|--show-(origin|scope|name-only))$/.test(flag)) ||
      words.length === 0
    )
  if (subcommand === 'reflog') return words.length === 0 || words[0] === 'show'
  if (subcommand === 'worktree') return words[0] === 'list'
  // `git stash` with no arguments saves the working tree; only its listing forms read.
  if (subcommand === 'stash') return ['list', 'show'].includes(words[0] ?? '')
  if (subcommand === 'notes') return words.length === 0 || ['list', 'show'].includes(words[0] ?? '')
  if (subcommand === 'submodule') return words.length === 0 || ['status', 'summary'].includes(words[0] ?? '')
  if (subcommand === 'bisect') return words.length === 0 || ['log', 'view'].includes(words[0] ?? '')
  if (subcommand === 'replace') return flags.some((flag) => ['-l', '--list'].includes(flag))
  if (subcommand === 'remote')
    return (
      words.length === 0 ||
      ['show', 'get-url'].includes(words[0] ?? '') ||
      (flags.some((flag) => ['-v', '--verbose'].includes(flag)) && words.length === 0)
    )
  if (subcommand === 'branch')
    return (
      (words.length === 0 && !flags.some((flag) => /^-(d|D|m|M|c|C|f)$/.test(flag))) ||
      (flags.some((flag) =>
        [
          '--list',
          '-l',
          '-a',
          '-r',
          '-v',
          '--verbose',
          '--show-current',
          '--contains',
          '--merged',
          '--no-merged',
          '--points-at',
          '--format',
        ].includes(flag),
      ) &&
        !flags.some(
          (flag) => /^-(d|D|m|M|c|C|f)$/.test(flag) || /^--(delete|move|copy|set-upstream-to|unset-upstream|edit-description)$/.test(flag),
        ))
    )
  if (subcommand === 'tag')
    return (
      (words.length === 0 && !flags.some((flag) => /^-[adfsm]$/.test(flag))) ||
      (flags.some((flag) =>
        ['--list', '-l', '-n', '--contains', '--points-at', '--merged', '--no-merged', '--sort', '--format'].includes(flag),
      ) &&
        !flags.some((flag) => /^-[adfsm]$/.test(flag) || /^--(delete|force)$/.test(flag)))
    )
  return false
}

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
  const text = networkHostOf(request) ?? commandOf(request)
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
  // A call to one of the person's MCP servers is read by its tool and arguments, not as a command (ADR-097).
  if (request.mcp !== undefined) return mcpKept(request.mcp, request.rawInput)
  if (request.kind === 'execute' || request.kind === 'other') {
    // A network request names a host: none of the command kinds (a deploy, a push) are what it does.
    if (networkHostOf(request) !== undefined) return []
    return commandKinds(commandOf(request), context)
  }
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

/** What of an MCP call the rules keep for the person: one of the kinds that can't be undone, by what its tool does. */
const mcpKept = (call: McpCall, input: unknown): ReadonlyArray<Kept> => {
  const act = mcpActOf(call, input)
  if (act.kind === undefined) return []
  const rule: RuleId =
    act.kind === 'publish' ? 'deploy' : act.kind === 'speak' ? 'speak' : call.tool.includes('force') ? 'force-push' : 'delete-branch'
  return [kept(`${act.verb} through ${call.server} always asks: it can't be undone.`, rule, 'irreversible')]
}

/**
 * What can't be undone in a request, as the rules read it: the kind it is
 * and why it asks, for the card that says so (`irreversible.ts`); undefined
 * where nothing in it is that, or only what the rules can't tell.
 */
export const lastingKept = (
  request: PermissionRequest,
  context: RuleContext,
): { readonly rule: RuleId; readonly reason: string } | undefined => {
  const found = keptOf(request, context).find((each) => each.irreversible === true && each.rule !== 'unclear' && each.blind !== true)
  return found === undefined || found.rule === 'unclear' ? undefined : { rule: found.rule, reason: found.reason }
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
  if (request.mcp !== undefined || (request.kind !== 'execute' && request.kind !== 'other')) return lasting(keptOf(request, context))
  // A host is no command, so none of what a command could do that can't be undone.
  if (networkHostOf(request) !== undefined) return undefined
  return lasting(commandKinds(withoutQuotedHeredocs(commandOf(request), takesScript), context))
}

/** Kinds whose floor is only part of them, so a choice about the kind isn't one about what could lose work: writes outside are mostly harmless. */
const BROADER_THAN_FLOOR: ReadonlyArray<Kept['rule']> = ['outside', 'unclear']

/** Kinds of request that only look, which even a project that asks about everything lets through. */
const LOOKS: ReadonlyArray<PermissionRequest['kind']> = ['read', 'search', 'think']

/**
 * Decides a permission request from the rules and the project's (ADR-013).
 * Secret protections come first: no one reads credentials, in the keychain or in the
 * files people keep them in. A request can be several kinds at once (`git
 * push --force origin main` is a force push and a push to the default
 * branch), and every kind counts. Then, in order:
 * - what the project never allows is refused: any kind it is, or a command
 *   the project named;
 * - with everything allowed, opaque commands run; visible irreversible
 *   operations (`lastingOf`) and the person's own Ask rules ask;
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
  const network = networkHostOf(request)
  // A network request meets the person's named rules by its host, as a command meets them by its words.
  const named =
    network !== undefined
      ? (commandRule(network, project.commands, system) ?? hostRuleOf(network, project.commands, system))
      : request.kind === 'execute' || request.kind === 'other'
        ? (commandRule(commandOf(request), project.commands, system) ?? hostRuleOf(commandOf(request), project.commands, system))
        : undefined
  if (network === undefined && (request.kind === 'execute' || request.kind === 'other')) {
    // Explicit credential reads are refused, wherever they appear in the command.
    const refused = lineReadings(commandOf(request), system)
      .flatMap((line) => line.commands.flatMap((words) => readings(unwrap(words))))
      .map(credentialReason)
      .find((reason) => reason !== undefined)
    if (refused !== undefined) return { verdict: 'deny', reason: refused }
    // Approving the agent's own work or widening access is refused, whoever asks.
    const widened = lineReadings(commandOf(request), system)
      .flatMap((line) => line.commands.flatMap((words) => [words, ...commandsIn(words)]))
      .map(hostRefusedReason)
      .find((reason) => reason !== undefined)
    if (widened !== undefined) return { verdict: 'deny', reason: widened }
  }
  // Nor the files people keep keys and sign-ins in, whatever the request does with them.
  const secret = secretOf(request, context, system)
  if (secret !== undefined) return { verdict: 'deny', reason: secret }
  if (named?.decision === 'never') return { verdict: 'deny', reason: `The project's rules never allow \`${named.pattern.trim()}\`.` }
  const found = keptOf(request, context)
  if (context.readOnly === true && found.some((each) => each.rule === 'outside'))
    return { verdict: 'deny', reason: "This command visibly writes outside the coordinator's folder." }
  const never = found.find((each) => each.rule !== 'unclear' && project.never.includes(each.rule))
  if (never !== undefined && never.rule !== 'unclear')
    return { verdict: 'deny', reason: `The project's rules never allow ${RULE_WORDS[never.rule]}.` }
  if (project.mode === 'allow') {
    // What can't be undone from the task still asks, where the rules read it as that: allowing everything is for what the person
    // could take back if it went wrong, and trusts the agent with what the rules can't read.
    const lasting = lastingOf(request, context)
    if (lasting !== undefined) return ask(evenAllowed(lasting.reason), false)
    // The person's own Ask me holds with everything allowed too: it is their answer given ahead (ADR-097).
    if (named?.decision === 'ask') return ask(`The project's rules ask before \`${named.pattern.trim()}\`.`, true)
    return ALLOW
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
  const routine =
    LOOKS.includes(request.kind) ||
    ownFiles ||
    (network === undefined && project.web === true && found.length === 0 && readsWeb(commandOf(request)))
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

// ---- Inside a sandbox ------------------------------------------------------

/*
 * Where a session's sandbox holds its shell commands (ADR-071), it is the
 * boundary, not these words: a command it holds runs without the rules
 * reading what it does, whatever the line is, a loop, `$(…)`, a heredoc or a
 * script. What it can't do there it can't do at all: write outside the task's
 * worktree or the coordinator's folder, read where the person keeps keys,
 * read a secret file. What crosses (a
 * command that runs outside it, an edit outside, a host it asks for) still
 * meets the rules as it did.
 */

/** How a session's sandbox holds its shell commands: what runs outside it from the start, and whether a command may ask to. */
export interface Hold {
  /** The commands that run outside it from the start, by how they start (Claude Code's `excludedCommands`). */
  readonly outside: ReadonlyArray<string>
  /** Whether a request may ask to run outside it (`dangerouslyDisableSandbox`); the coordinator's never may. */
  readonly unsandboxed: boolean
}

/**
 * Whether a request is a shell command its session's sandbox holds: one that
 * doesn't ask to run outside it, where it may, and of whose commands none
 * starts as one that runs outside from the start. A line runs outside only
 * where every command in it does, but one is enough to read it.
 */
export const runsInside = (request: PermissionRequest, hold: Hold): boolean => {
  if (request.kind !== 'execute') return false
  const command = commandIn(request.rawInput)
  if (command === undefined || command.trim() === '') return false
  if (hold.unsandboxed && field(request.rawInput, 'dangerouslyDisableSandbox') === true) return false
  const parts = command.split(/&&|\|\||[;|\n()]/).map((part) => part.trim().replace(/\s+/g, ' '))
  return !hold.outside.some((start) => parts.some((part) => part === start || part.startsWith(`${start} `)))
}

/**
 * Decides a shell command its session's sandbox holds (ADR-071). Nothing is
 * read for what it does but what the person and the irreversible list said:
 * a command they never allow, or a kind they never allow that the line plainly
 * is, is refused; a command they ask about asks; and an operation that can't
 * be undone still asks, sandbox or not (ADR-097). Approving the agent's own
 * work or widening access is refused. The rest runs.
 */
export const decideInside = (request: PermissionRequest, context?: RuleContext): Verdict => {
  const system = systemOf(context)
  const command = commandOf(request)
  const credentials = lineReadings(command, system)
    .flatMap((line) => line.commands.flatMap((words) => readings(unwrap(words))))
    .map(credentialReason)
    .find((reason) => reason !== undefined)
  if (credentials !== undefined) return { verdict: 'deny', reason: credentials }
  const widened = lineReadings(command, system)
    .flatMap((line) => line.commands.flatMap((words) => [words, ...commandsIn(words)]))
    .map(hostRefusedReason)
    .find((reason) => reason !== undefined)
  if (widened !== undefined) return { verdict: 'deny', reason: widened }
  const project = context?.project
  if (context === undefined) return ALLOW
  const secret = secretOf(request, context, system)
  if (secret !== undefined) return { verdict: 'deny', reason: secret }
  if (project === undefined) return ALLOW
  const named = commandRule(command, project.commands, system) ?? hostRuleOf(command, project.commands, system)
  if (named?.decision === 'never') return { verdict: 'deny', reason: `The project's rules never allow \`${named.pattern.trim()}\`.` }
  const kinds = commandKinds(command, context)
  const never = kinds.find((each) => each.rule !== 'unclear' && project.never.includes(each.rule))
  if (never !== undefined && never.rule !== 'unclear')
    return { verdict: 'deny', reason: `The project's rules never allow ${RULE_WORDS[never.rule]}.` }
  // The irreversible list asks in every role, sandbox or not (ADR-097).
  const lasting = lastingOf(request, context)
  if (lasting !== undefined) return ask(evenAllowed(lasting.reason), false)
  if (named?.decision === 'ask') return ask(`The project's rules ask before \`${named.pattern.trim()}\`.`, true)
  return ALLOW
}

/** A git command of a line: what a pass from the person lets past git's guard, and no other (pushGuard.ts). */
export interface GitRun {
  /** Git's own words, as `ps` shows them: its program by name, its words unquoted, one space between. */
  readonly words: string
  /** The folder it runs in, after the line's `cd`s and its `-C`; none where Althar can't tell. */
  readonly folder: string | undefined
  /** For a push, the remote it names (`origin`, a URL), or none where it names none. */
  readonly push?: { readonly remote: string | undefined }
}

/** The git commands of a line, from where the agent's shell is, or the task's worktree where that isn't known. */
export const gitRunsOf = (command: string, context: RuleContext): ReadonlyArray<GitRun> => {
  const where = places(context)
  const runs: Array<GitRun> = []
  const { start, known } = shellOf(where, context)
  walkFolders(
    parseCommandLine(command),
    start,
    followingOf(where, context),
    (written, folders) => {
      const words = written.filter((word, at) => !written.slice(0, at + 1).every((each) => assignment.test(each)))
      if (words.length === 0 || words[0]!.slice(words[0]!.lastIndexOf('/') + 1) !== 'git') return
      // Its redirects, which the parse puts last, are the shell's, not git's.
      const own = ['git', ...words.slice(1, words.findIndex((word, at) => at > 0 && /^(\d*|&)[<>]/.test(word)) >>> 0)]
      const known = folders.length === 1 && folders[0]!.blind !== true ? folders[0]!.at : undefined
      const call = known === undefined ? undefined : gitCall(own, known, where.system.paths)
      runs.push({
        words: own.join(' ').replace(/\s+/g, ' ').trim(),
        folder: call !== undefined && call.elsewhere.length === 0 ? call.cwd : undefined,
        ...(call?.subcommand === 'push' ? { push: { remote: pushRemoteOf(call.args) } } : {}),
      })
    },
    known,
  )
  return runs
}

/** The remote a push names: `--repo`'s, or its first word that isn't an option. */
const pushRemoteOf = (args: ReadonlyArray<string>): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg.startsWith('--repo=')) return arg.slice('--repo='.length)
    if (arg === '--repo') return args[index + 1]
    if (PUSH_OPTIONS_WITH_VALUE.includes(arg)) index += 1
    else if (!arg.startsWith('-')) return arg
  }
  return undefined
}

// ---- What each ask and refusal is counted as ------------------------------

/**
 * The kinds an ask or a refusal is counted as (ADR-071), so the person sees
 * which mostly get worked around: one of the project's kinds, what the rules
 * can't read, a command the project named, what no project can change
 * (credentials and keys, the code host), what a role that only reads may not
 * do, and the rest (a project that asks about everything).
 */
export const TALLY_KINDS = [...RULES, 'unclear', 'command', 'credentials', 'code-host', 'reader', 'other'] as const

export type TallyKind = (typeof TALLY_KINDS)[number]

/**
 * What an ask or a refusal of a task's request is counted as: what decided
 * it, in the order `decide` meets them, the firmest of the kinds it is.
 */
export const tallyKindOf = (request: PermissionRequest, context: RuleContext): TallyKind => {
  const system = systemOf(context)
  const network = networkHostOf(request)
  const runs = (request.kind === 'execute' || request.kind === 'other') && network === undefined
  if (runs) {
    const words = lineReadings(commandOf(request), system).flatMap((line) => line.commands.flatMap((each) => readings(unwrap(each))))
    if (words.some((each) => credentialReason(each) !== undefined)) return 'credentials'
  }
  if (secretOf(request, context, system) !== undefined) return 'credentials'
  const project = context.project ?? MVP_RULES
  const named =
    network !== undefined
      ? commandRule(network, project.commands, system)
      : runs
        ? commandRule(commandOf(request), project.commands, system)
        : undefined
  if (named !== undefined) return 'command'
  const found = keptOf(request, context)
  const firmest = found.find((each) => each.irreversible === true) ?? found.find((each) => each.floor === true) ?? found[0]
  return firmest?.rule ?? 'other'
}

/** Whether a request is, as the rules read it, one of what can't be undone from the task (ADR-067): what a lead's git guard stops. */
export const lasting = (request: PermissionRequest, context: RuleContext): boolean =>
  keptOf(request, context).some((each) => each.irreversible === true)

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
  const text = networkHostOf(request) ?? (runs ? commandOf(request).trim() : '')
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
