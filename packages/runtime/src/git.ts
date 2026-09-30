import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { Effect } from 'effect'

import { GitFailed } from './errors'

/*
 * The git commands the runtime runs itself, outside any agent. They never
 * prompt: a command that would ask for a password fails instead. They run
 * with the repository's hooks off (docs/architecture/07): adding a worktree
 * would otherwise run its `post-checkout` hook, code from the repository, on
 * the person's machine.
 */

export const git = (cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> => gitWithin(60_000, cwd, ...args)

/** A git command that gives up after `timeout` milliseconds, for those that reach the network. */
export const gitWithin = (timeout: number, cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> =>
  run(timeout, cwd, args)

const run = (
  timeout: number,
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
): Effect.Effect<string, GitFailed> =>
  Effect.callback<string, GitFailed>((resume) => {
    execFile(
      'git',
      ['-c', 'core.hooksPath=/dev/null', ...args],
      { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env } },
      (error, stdout, stderr) =>
        resume(
          error === null
            ? Effect.succeed(stdout.trim())
            : Effect.fail(new GitFailed({ args: [...args], cwd, stderr: stderr.trim() || error.message })),
        ),
    )
  })

/**
 * What a worktree holds, as a tree id: tracked and untracked files alike,
 * ignored ones aside, so any edit changes it. It stages into a copy of the
 * index, leaving the agent's own staging as it was.
 */
export const treeOf = (cwd: string): Effect.Effect<string, GitFailed> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const index = resolve(cwd, yield* git(cwd, 'rev-parse', '--git-path', 'index'))
      return yield* Effect.try({
        try: () => {
          const copy = join(mkdtempSync(join(tmpdir(), 'charrette-index-')), 'index')
          if (existsSync(index)) copyFileSync(index, copy)
          return copy
        },
        catch: (error) => new GitFailed({ args: ['add', '-A'], cwd, stderr: String(error) }),
      })
    }),
    (copy) =>
      Effect.andThen(run(60_000, cwd, ['add', '-A'], { GIT_INDEX_FILE: copy }), run(60_000, cwd, ['write-tree'], { GIT_INDEX_FILE: copy })),
    (copy) => Effect.sync(() => rmSync(dirname(copy), { recursive: true, force: true })),
  )

/** Commits a tree on top of a parent without touching any branch, as Charrette: a snapshot a worktree can check out. */
export const commitTree = (cwd: string, tree: string, parent: string, message: string): Effect.Effect<string, GitFailed> =>
  run(60_000, cwd, ['commit-tree', tree, '-p', parent, '-m', message], {
    GIT_AUTHOR_NAME: 'Charrette',
    GIT_AUTHOR_EMAIL: 'charrette@localhost',
    GIT_COMMITTER_NAME: 'Charrette',
    GIT_COMMITTER_EMAIL: 'charrette@localhost',
  })

/** The top of the repository a path is in. */
export const topLevel = (path: string) => git(path, 'rev-parse', '--show-toplevel')

/** The commit a ref points at. */
export const commitOf = (cwd: string, ref: string) => git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)

/** Whether a local branch exists. */
export const branchExists = (cwd: string, branch: string) =>
  git(cwd, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/** The branch checked out, or undefined when HEAD is detached. */
export const currentBranch = (cwd: string) =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').pipe(
    Effect.map((branch): string | undefined => branch),
    Effect.orElseSucceed(() => undefined),
  )

const COMMON_DEFAULTS = ['main', 'master', 'trunk', 'develop']

/**
 * The repository's default branch: what origin says (as git last saw it, or
 * by asking it), else the first of the usual names that exists here, else
 * `main`. Never the branch the person happens to have checked out, which may
 * be a feature branch the push rules would then protect instead.
 */
export const defaultBranch = (cwd: string) =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD').pipe(
    Effect.map((ref) => ref.replace(/^origin\//, '')),
    Effect.catch(() =>
      gitWithin(15_000, cwd, 'ls-remote', '--symref', 'origin', 'HEAD').pipe(
        Effect.flatMap((output) => {
          const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1]
          return branch === undefined ? Effect.fail(new GitFailed({ args: ['ls-remote'], cwd, stderr: 'no HEAD' })) : Effect.succeed(branch)
        }),
      ),
    ),
    Effect.catch(() =>
      Effect.gen(function* () {
        for (const branch of COMMON_DEFAULTS) if (yield* branchExists(cwd, branch)) return branch
        return 'main'
      }),
    ),
  )

/** Brings a remote branch up to date locally; false when that can't be done, as offline. */
export const fetchBranch = (cwd: string, branch: string) =>
  gitWithin(60_000, cwd, 'fetch', '--quiet', '--no-tags', 'origin', branch).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/**
 * A remote URL without the credentials it may carry: `https://user:token@host/…`
 * becomes `https://host/…`. The record never holds a secret (docs/architecture/07).
 */
export const redactUrl = (url: string) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')

/** Every remote's fetch URL, without credentials. */
export const remoteUrls = (cwd: string) =>
  Effect.map(git(cwd, 'remote', '-v'), (output) => [
    ...new Set(
      output
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => redactUrl(line.split(/\s+/)[1] ?? ''))
        .filter((url) => url !== ''),
    ),
  ])

/** Adds a worktree on a new branch from a base. */
export const addWorktree = (repository: string, path: string, branch: string, base: string) =>
  git(repository, 'worktree', 'add', '-b', branch, path, base)
