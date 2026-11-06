import { homedir } from 'node:os'

import { Cause, Option } from 'effect'

/*
 * What git said when it failed, in a line a person can read and a log can
 * keep: the subcommand, and the most telling line of what it wrote to
 * stderr, the home folder shortened to `~`. Nothing that signs Althar in
 * reaches either: fetches carry a token in an `http.extraHeader`, which git
 * may echo, and a remote's URL may hold credentials, so headers, URLs'
 * credentials and anything shaped like a token are blanked first.
 */

/** What a secret is replaced with. */
const HIDDEN = '[redacted]'

/** A git failure as it is kept (`GitFailed`): only the fields read here, so this module needs nothing of errors.ts. */
export interface GitFailure {
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly stderr: string
  readonly reason?: string | undefined
  readonly code?: number | undefined
  readonly signal?: string | undefined
  readonly timedOut?: boolean | undefined
  readonly timeout?: number | undefined
}

/**
 * Tokens by the shape their issuers give them: GitHub's, GitLab's, Bitbucket's,
 * Linear's, Slack's, JWTs and a Basic or Bearer credential. Then anything long
 * that mixes upper and lower case with digits, as random tokens do, and
 * names, paths and commit ids (lower-case hex) don't.
 */
const TOKENS: ReadonlyArray<RegExp> = [
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bATBB[A-Za-z0-9_-]{16,}/g,
  /\blin_(?:api|oauth)_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(Basic|Bearer|token)\s+[A-Za-z0-9+/=._~-]{8,}/gi,
  /(?<![A-Za-z0-9_+=-])(?=[A-Za-z0-9_+=-]*[A-Z])(?=[A-Za-z0-9_+=-]*[a-z])(?=[A-Za-z0-9_+=-]*\d)[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_+=-])/g,
]

/**
 * Text with no secret left in it: an `Authorization` header's value, an
 * `extraHeader`'s, the credentials in a URL (`https://user:token@host`), and
 * anything shaped like a token.
 */
export const redacted = (text: string): string => {
  let out = text
    // A header as git or curl writes it, or as config sets it, to the end of its line: whatever scheme, whatever token.
    .replace(/((?:^|[\s"'])(?:proxy-)?authorization\s*[:=]\s*)[^\n"']*/gim, `$1${HIDDEN}`)
    .replace(/((?:http\.)?(?:[^\s.=]+\.)?extraheader\s*[:=]?\s*)[^\n"']*/gim, `$1${HIDDEN}`)
    .replace(/(GIT_CONFIG_VALUE_\d+\s*[:=]\s*)[^\n"']*/g, `$1${HIDDEN}`)
    // Credentials in a URL: whoever and whatever, the host stays.
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, `$1${HIDDEN}@`)
  for (const token of TOKENS)
    out = out.replace(token, (found, scheme?: string) => (typeof scheme === 'string' && scheme !== '' ? `${scheme} ${HIDDEN}` : HIDDEN))
  return out
}

/** A path, or text with paths in it, with the home folder shortened to `~`. */
export const homeShortened = (text: string, home: string = homedir()): string => {
  if (home === '' || home === '/') return text
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`${escaped}(?=[/\\\\]|$|[\\s'":)])`, 'g'), '~')
}

/** The longest line kept of what git said: past it, the line ends in an ellipsis. */
const LONGEST = 240

/** The advice git ends a remote it couldn't read with, which says nothing alone. */
const ADVICE =
  /(fatal: )?Could not read from remote repository\.\s*(Please make sure you have the correct access rights\s*and the repository exists\.\s*)?/i

/**
 * The line of git's stderr that says most: its first `fatal:`, else its first
 * `error:`, else its last line before any usage, without the prefix, trimmed, redacted and with
 * the home folder as `~`. Empty where git said nothing.
 */
export const gitLine = (stderr: string, home?: string): string => {
  const all = stderr
    .replace(ADVICE, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  // The usage git prints after a command it couldn't run says nothing of why: what came before it does.
  const usage = all.findIndex((line) => /^usage:/i.test(line))
  const lines = usage > 0 ? all.slice(0, usage) : all
  const telling = lines.find((line) => /^fatal:/i.test(line)) ?? lines.find((line) => /^error:/i.test(line)) ?? lines.at(-1) ?? ''
  const said = homeShortened(redacted(telling.replace(/^(fatal|error|warning):\s*/i, '')), home)
  return said.length > LONGEST ? `${said.slice(0, LONGEST - 1).trimEnd()}…` : said
}

/** The git subcommand a failure ran: `rev-parse`, `fetch`; past any `-c key=value` before it. */
export const subcommandOf = (args: ReadonlyArray<string>): string => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? ''
    if (arg === '-c' || arg === '-C' || arg === '--git-dir' || arg === '--work-tree') {
      index++
      continue
    }
    if (!arg.startsWith('-') && !arg.includes('=')) return arg
  }
  return ''
}

/** Seconds, for a person: `90 s`. */
const seconds = (milliseconds: number | undefined) => (milliseconds === undefined ? 'time' : `${Math.round(milliseconds / 1000)} s`)

/**
 * A git failure in a line, with no full stop: `git rev-parse: gitfile does not
 * point to a valid repository: ~/…/orchy/.git`. Where git said nothing, how it
 * ended: Althar stopping it, its time running out, a signal or its exit code.
 */
export const gitSummary = (failure: GitFailure, home?: string): string => {
  const sub = subcommandOf(failure.args)
  const command = sub === '' ? 'git' : `git ${sub}`
  const said = gitLine(failure.stderr, home)
  if (said !== '') return `${command}: ${said}`
  if (failure.reason !== undefined && failure.reason !== '') return `${command}: ${redacted(failure.reason).replace(/\.$/, '')}`
  if (failure.timedOut === true) return `${command}: no answer in ${seconds(failure.timeout)}`
  if (failure.signal !== undefined && failure.signal !== '') return `${command}: stopped by ${failure.signal}`
  if (failure.code !== undefined) return `${command}: failed with code ${failure.code}`
  return `${command}: failed`
}

const isGitFailure = (error: unknown): error is GitFailure & { readonly _tag: 'GitFailed' } =>
  typeof error === 'object' && error !== null && (error as { readonly _tag?: unknown })._tag === 'GitFailed'

/** The git failure a cause holds, where it holds one. */
export const gitFailureOf = (cause: Cause.Cause<unknown>): GitFailure | undefined => {
  const error = Cause.findErrorOption(cause)
  return Option.isSome(error) && isGitFailure(error.value) ? error.value : undefined
}

/**
 * What a log line keeps of a git failure, besides its stack: the command's
 * arguments, where it ran and all it said, redacted. Empty for any other
 * cause.
 */
export const gitFields = (cause: Cause.Cause<unknown>): Readonly<Record<string, string>> => {
  const failure = gitFailureOf(cause)
  if (failure === undefined) return {}
  return {
    git_args: redacted(failure.args.join(' ')),
    git_cwd: failure.cwd,
    git_stderr: redacted(failure.stderr),
    ...(failure.code === undefined ? {} : { git_code: String(failure.code) }),
  }
}
