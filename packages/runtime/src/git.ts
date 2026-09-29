import { execFile } from 'node:child_process'

import { Effect } from 'effect'

import { GitFailed } from './errors'

/*
 * The git commands the runtime runs itself, outside any agent. They never
 * prompt: a command that would ask for a password fails instead.
 */

export const git = (cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> =>
  Effect.callback<string, GitFailed>((resume) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) =>
        resume(
          error === null
            ? Effect.succeed(stdout.trim())
            : Effect.fail(new GitFailed({ args: [...args], cwd, stderr: stderr.trim() || error.message })),
        ),
    )
  })

/** The top of the repository a path is in. */
export const topLevel = (path: string) => git(path, 'rev-parse', '--show-toplevel')

/** The commit a ref points at. */
export const commitOf = (cwd: string, ref: string) => git(cwd, 'rev-parse', '--verify', `${ref}^{commit}`)

/** The branch checked out, or undefined when HEAD is detached. */
export const currentBranch = (cwd: string) =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').pipe(
    Effect.map((branch): string | undefined => branch),
    Effect.orElseSucceed(() => undefined),
  )

/** The remote's default branch where git knows it, else the branch checked out, else `main`. */
export const defaultBranch = (cwd: string) =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD').pipe(
    Effect.map((ref) => ref.replace(/^origin\//, '')),
    Effect.catch(() => Effect.map(currentBranch(cwd), (branch) => branch ?? 'main')),
  )

/** Every remote's fetch URL. */
export const remoteUrls = (cwd: string) =>
  Effect.map(git(cwd, 'remote', '-v'), (output) => [
    ...new Set(
      output
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => line.split(/\s+/)[1] ?? '')
        .filter((url) => url !== ''),
    ),
  ])

/** Adds a worktree on a new branch from a base. */
export const addWorktree = (repository: string, path: string, branch: string, base: string) =>
  git(repository, 'worktree', 'add', '-b', branch, path, base)
