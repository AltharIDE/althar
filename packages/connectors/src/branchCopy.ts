import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'

import type { PushTarget } from './model'

/*
 * Bringing a branch up to date in a copy of Althar's own (ADR-081): the hosts
 * that have no call for it (GitLab's only rebases, Bitbucket has none) get
 * the target branch merged into the change's branch here, in a throwaway
 * clone made for it, and pushed plainly. Never a rebase and never forced: a
 * branch that moved since is left alone and said so, and a conflict is only
 * read, never settled. The clone has no hooks and none of the person's git
 * configuration, so nothing in the repository runs on their machine and no
 * signing key or credential helper is asked for.
 */

/** One branch to fetch from a repository, as a push is signed in. */
export interface BranchAt {
  readonly target: PushTarget
  readonly branch: string
}

/** What to merge, and where it is. */
export interface CopyMerge {
  /** The change's branch, which is brought up to date: its own repository's, or a fork's. */
  readonly into: BranchAt & { readonly head: string }
  /** The branch it goes into, in the repository the change is on, which is merged in. */
  readonly from: BranchAt
  /** Whether to push the merge. Without, only to find whether it conflicts, and in which files. */
  readonly push: boolean
}

/** How a merge in a copy ended. */
export type CopyMerged =
  | { readonly outcome: 'updated'; readonly head: string }
  | { readonly outcome: 'current' }
  | { readonly outcome: 'conflict'; readonly files: ReadonlyArray<string> }
  /** The branch is not where it was read: another push got there first. Its head now, where it could be read. */
  | { readonly outcome: 'moved'; readonly head: string | null }
  /** Git could not read or write the branch, or the host refused the push: its words. */
  | { readonly outcome: 'refused'; readonly message: string }

/** Merges one branch into another in a copy, as a function of its own so a test can stand in for git. */
export type MergeInCopy = (merge: CopyMerge) => Effect.Effect<CopyMerged>

const IDENTITY = { name: 'Althar', email: 'althar@users.noreply.github.com' }

const signedIn = (target: PushTarget): Record<string, string> =>
  target.header === null ? {} : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: target.header }

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const git = (cwd: string, args: ReadonlyArray<string>, env: Record<string, string> = {}): Promise<Ran> =>
  new Promise((resolve) => {
    execFile(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'submodule.recurse=false',
        '-c',
        'core.fsmonitor=false',
        ...args,
      ],
      {
        cwd,
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: IDENTITY.name,
          GIT_AUTHOR_EMAIL: IDENTITY.email,
          GIT_COMMITTER_NAME: IDENTITY.name,
          GIT_COMMITTER_EMAIL: IDENTITY.email,
          LC_ALL: 'C',
          ...env,
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : 128,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        }),
    )
  })

const said = (ran: Ran) => ran.stderr.split('\n').find((line) => line.trim() !== '') ?? 'git failed'

/** The commit a branch of a remote is on now, by URL; null where there is none or it can't be asked. */
const tipOf = async (cwd: string, at: BranchAt): Promise<string | null> => {
  const listed = await git(cwd, ['ls-remote', '--heads', at.target.url, `refs/heads/${at.branch}`], signedIn(at.target))
  return listed.code === 0 ? (/^[0-9a-f]{40,64}/.exec(listed.stdout)?.[0] ?? null) : null
}

const merging = async (dir: string, merge: CopyMerge): Promise<CopyMerged> => {
  const started = await git(dir, ['init', '--quiet'])
  if (started.code !== 0) return { outcome: 'refused', message: said(started) }
  const own = await git(
    dir,
    ['fetch', '--quiet', '--no-tags', merge.into.target.url, `+refs/heads/${merge.into.branch}:refs/althar/branch`],
    signedIn(merge.into.target),
  )
  if (own.code !== 0) return { outcome: 'refused', message: `Althar could not read the branch ${merge.into.branch}: ${said(own)}` }
  const read = (await git(dir, ['rev-parse', '--verify', 'refs/althar/branch^{commit}'])).stdout
  if (read !== merge.into.head) return { outcome: 'moved', head: read }
  const other = await git(
    dir,
    ['fetch', '--quiet', '--no-tags', merge.from.target.url, `+refs/heads/${merge.from.branch}:refs/althar/target`],
    signedIn(merge.from.target),
  )
  if (other.code !== 0) return { outcome: 'refused', message: `Althar could not read the branch ${merge.from.branch}: ${said(other)}` }
  const target = (await git(dir, ['rev-parse', '--verify', 'refs/althar/target^{commit}'])).stdout
  if ((await git(dir, ['merge-base', '--is-ancestor', target, read])).code === 0) return { outcome: 'current' }
  const checkedOut = await git(dir, ['checkout', '--quiet', '--detach', read])
  if (checkedOut.code !== 0) return { outcome: 'refused', message: said(checkedOut) }
  // A merge commit, as a person's `git merge` makes: never a rebase, and never fast-forwarded past the branch's own commits.
  const merged = await git(dir, [
    'merge',
    '--no-edit',
    '--no-ff',
    '--quiet',
    '-m',
    `Merge branch '${merge.from.branch}' into ${merge.into.branch}`,
    target,
  ])
  if (merged.code !== 0) {
    const conflicted = await git(dir, ['diff', '--name-only', '--diff-filter=U'])
    const files = conflicted.stdout === '' ? [] : conflicted.stdout.split('\n')
    if (files.length === 0) return { outcome: 'refused', message: said(merged) === 'git failed' ? merged.stdout : said(merged) }
    return { outcome: 'conflict', files }
  }
  const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout
  if (!merge.push) return { outcome: 'updated', head }
  // Plain: git refuses it unless it adds to the branch as the host has it, so another push meanwhile is never overwritten.
  const pushed = await git(
    dir,
    ['push', '--quiet', '--no-verify', merge.into.target.url, `${head}:refs/heads/${merge.into.branch}`],
    signedIn(merge.into.target),
  )
  if (pushed.code === 0) return { outcome: 'updated', head }
  const now = await tipOf(dir, merge.into)
  if (now !== null && now !== read) return { outcome: 'moved', head: now }
  return { outcome: 'refused', message: said(pushed) }
}

/** The real merge in a copy: a temporary clone, removed after. */
export const mergeInCopy: MergeInCopy = (merge) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-update-'))),
    (dir) => Effect.promise(() => merging(dir, merge)),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  )
