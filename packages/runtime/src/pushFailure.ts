import type { GitFailed, PushRefused } from './errors'

/*
 * Why a push failed, read from what git wrote: the common refusals each by
 * name, for the window to say in a sentence with its way out, and the
 * server's own one line where it gave one. Hosts word these differently
 * (GitHub, GitLab, Bitbucket, a plain SSH server), so each is matched on the
 * phrases they share. Checked in order: a protected branch before a missing
 * permission, a refused sign-in before either, as their words overlap.
 */

/** The branch is protected there: GitHub's GH006, GitLab's protected branches, a hook saying so. */
const PROTECTED = /protected branch|GH006|protected ref/i

/** The sign-in was missing or not taken: no password to give, a key or token refused. */
const SIGN_IN =
  /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \((publickey|password|keyboard-interactive)|HTTP Basic: Access denied|invalid (username|credentials)|returned error: 401|bad credentials|password authentication was removed/i

/** Signed in, but the account may not push there. */
const FORBIDDEN =
  /permission to \S+ denied|not allowed to push|permission denied|returned error: 403|(do not|don't) have permission|write access to repository not granted|access denied/i

/** The host couldn't be reached at all. */
const UNREACHABLE =
  /could not resolve host|could not resolve hostname|failed to connect to|connection (refused|timed out|reset)|network is unreachable|operation timed out|no route to host|temporary failure in name resolution|name or service not known|nodename nor servname/i

/** What the remote said, line by line, without git's `remote:` and the host's own prefixes. */
const remoteLines = (stderr: string) =>
  stderr
    .split('\n')
    .flatMap((line) => {
      const said = /^remote:\s*(.*)$/i.exec(line.trim())?.[1]
      return said === undefined ? [] : [said.replace(/^(GitLab:|error:|GH\d+:)\s*/gi, '').trim()]
    })
    .filter((line) => /[a-z]/i.test(line))

/** Why a push failed, where git's output says so: null where it says something else, for git's own failure to stand. */
export const pushFailureOf = (
  failed: Pick<GitFailed, 'stderr' | 'timedOut'>,
): { readonly why: PushRefused['why']; readonly said?: string } | null => {
  const { stderr } = failed
  const said = remoteLines(stderr)[0]
  if (PROTECTED.test(stderr)) return { why: 'protected', ...(said === undefined ? {} : { said }) }
  if (SIGN_IN.test(stderr)) return { why: 'denied' }
  if (FORBIDDEN.test(stderr)) return { why: 'forbidden', ...(said === undefined ? {} : { said }) }
  if (/! \[rejected\].*\((fetch first|non-fast-forward)\)/i.test(stderr)) return { why: 'behind' }
  // The remote said no on its own terms, as a hook does: its one line, else git's note of which hook it was.
  const rejected = /\[remote rejected\][^(]*\(([^)]*)\)/i.exec(stderr)
  if (rejected !== null) return { why: 'refused', said: said ?? rejected[1] ?? '' }
  if (UNREACHABLE.test(stderr)) return { why: 'unreachable' }
  // Stopped with no answer: git was likely waiting on a sign-in it had no way to ask for.
  if (failed.timedOut === true) return { why: 'unanswered' }
  return null
}

/** All git said and how it ended, for a quiet Details: what the sentence leaves out. */
export const pushDetailOf = (failed: Pick<GitFailed, 'stderr' | 'code' | 'signal' | 'timedOut' | 'timeout'>): string =>
  [failed.stderr.trim(), endedOf(failed)].filter((line) => line !== '').join('\n')

/** How a git command ended, where it failed: past its time, stopped by a signal, or its exit code. */
export const endedOf = (failed: Pick<GitFailed, 'code' | 'signal' | 'timedOut' | 'timeout'>): string =>
  failed.timedOut === true
    ? `Stopped after ${secondsOf(failed.timeout)} with no answer.`
    : failed.signal !== undefined
      ? `Stopped by ${failed.signal}.`
      : failed.code !== undefined
        ? `Exit code ${failed.code}.`
        : ''

/** A time limit in words: a second, 15 seconds, a minute, 2 minutes. */
export const secondsOf = (timeout: number | undefined): string => {
  if (timeout === undefined) return 'its time'
  const seconds = Math.round(timeout / 1000)
  if (seconds <= 1) return 'a second'
  if (seconds === 60) return 'a minute'
  return seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds`
}
