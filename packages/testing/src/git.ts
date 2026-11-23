import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

/**
 * Where a test's git may never look for a repository above: the temporary folder tests make theirs in. A folder a
 * test makes there that isn't a repository (its `git init` failed, or never ran) is then no repository at all, rather
 * than part of whichever one the temporary folder sits in, such as a task's worktree: `git config` there would write
 * into that repository's own `.git/config`, shared by all its worktrees, and every later commit would carry it.
 * Git takes each as a symlink-resolved path, so both spellings are listed.
 */
export const gitCeiling = (temporary: string = tmpdir()): string => {
  const given = resolve(temporary)
  const real = realpathSync(given)
  return given === real ? real : `${given}${delimiter}${real}`
}

/** Sets git's ceiling for this process, and every git it starts (setup.ts): kept where one is set already. */
export const isolateGit = (env: NodeJS.ProcessEnv = process.env): void => {
  const ceiling = gitCeiling()
  env.GIT_CEILING_DIRECTORIES =
    env.GIT_CEILING_DIRECTORIES === undefined || env.GIT_CEILING_DIRECTORIES === ''
      ? ceiling
      : `${ceiling}${delimiter}${env.GIT_CEILING_DIRECTORIES}`
}

const revParse = (folder: string, ...args: Array<string>) =>
  execFileSync('git', ['rev-parse', ...args], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/**
 * Whether the folder is the top level of a repository of its own, whose config is its own `.git/config`, and not a
 * folder inside another. A linked worktree's root is its own top level too, but its config is its main repository's
 * (`--git-common-dir`), shared by every worktree of it, such as a task's of the person's own repository: it never
 * counts, wherever it is, so a test sets its config at the main repository it made.
 */
export const isOwnRepository = (folder: string): boolean => {
  try {
    const real = realpathSync(folder)
    if (realpathSync(revParse(folder, '--show-toplevel')) !== real) return false
    const common = realpathSync(revParse(folder, '--path-format=absolute', '--git-common-dir'))
    const own = realpathSync(revParse(folder, '--path-format=absolute', '--git-dir'))
    return common === own && common === join(real, '.git')
  } catch {
    return false
  }
}

/**
 * Sets one of a repository's own config entries, for a test's repository only: it throws where the folder is not the
 * top level of a repository of its own, rather than let git walk up and write to the one around it.
 */
export const setConfig = (folder: string, key: string, value: string): void => {
  if (!isOwnRepository(folder)) {
    throw new Error(
      `Refusing to set ${key} in ${folder}: it is not the top level of a repository of its own, so git would write to the one around it.`,
    )
  }
  execFileSync('git', ['config', '--local', key, value], { cwd: folder, stdio: 'ignore' })
}

/** Gives a test's repository an identity of its own, as the person's has (see `setConfig`). */
export const identify = (folder: string, name: string, email: string): void => {
  setConfig(folder, 'user.name', name)
  setConfig(folder, 'user.email', email)
}
