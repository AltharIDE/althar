import { resolve } from 'node:path'

import { Effect } from 'effect'

import { gitOutcome } from './git'

/*
 * Who a commit Althar makes for a task is written as. A repository's own config
 * wins over the person's global one, so a test identity (`T <t@t.test>`) that
 * was ever written into a repository's `.git/config`, which every worktree of it
 * shares, is the author of every later commit of every task there, and the code
 * host shows it on the pull requests instead of the person. Where git resolves
 * to what is plainly a test's, Althar says so in the task's thread, naming the
 * file and the value it came from, and commits as itself instead: never as the
 * test's name, and never by changing the person's config.
 */

/** A value git resolved, and where it read it: a config file's path, or the environment variable. */
export interface Source {
  readonly value: string
  readonly origin: string
}

/** The name and email git would write a commit as in a folder, where it has them. */
export interface Identity {
  readonly name: Source | null
  readonly email: Source | null
}

/** What a commit is written as where this Mac names no one, or only a test: Althar's own. */
export const ALTHAR_IDENTITY: ReadonlyArray<string> = ['-c', 'user.name=Althar', '-c', 'user.email=althar@localhost']

const FROM_ENVIRONMENT = { name: ['GIT_COMMITTER_NAME', 'GIT_AUTHOR_NAME'], email: ['GIT_COMMITTER_EMAIL', 'GIT_AUTHOR_EMAIL'] } as const

const fromEnvironment = (names: ReadonlyArray<string>): Source | null => {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') return { value, origin: `the environment variable ${name}` }
  }
  return null
}

/** One config key as git resolves it here, with the file it came from (`git config --show-origin`). */
const configured = (path: string, key: 'user.name' | 'user.email') =>
  Effect.map(gitOutcome(path, 'config', '--show-origin', '--get', key), (found): Source | null => {
    if (found.code !== 0 || found.stdout === '') return null
    const at = found.stdout.indexOf('\t')
    if (at < 0) return null
    // A file in the folder's own repository is named from it (`.git/config`): said whole, so the person can open it.
    const named = found.stdout.slice(0, at)
    const origin = named.startsWith('file:') ? resolve(path, named.slice('file:'.length)) : named
    return { value: found.stdout.slice(at + 1), origin }
  })

/** Who git would write a commit as in a folder: the environment's words first, as git reads them, then its config's. */
export const identityIn = (path: string): Effect.Effect<Identity> =>
  Effect.all(
    {
      name: Effect.map(configured(path, 'user.name'), (found) => fromEnvironment(FROM_ENVIRONMENT.name) ?? found),
      email: Effect.map(configured(path, 'user.email'), (found) => fromEnvironment(FROM_ENVIRONMENT.email) ?? found),
    },
    { concurrency: 2 },
  )

/** Whether an identity is plainly a test's: an address on a `.test` domain, or the name `T`. */
export const testIdentityIn = (identity: Identity): ReadonlyArray<Source> => {
  const bad: Array<Source> = []
  if (identity.name !== null && identity.name.value.trim() === 'T') bad.push(identity.name)
  if (identity.email !== null && /@[^@\s]*\.test$/i.test(identity.email.value.trim())) bad.push(identity.email)
  return bad
}

/**
 * What to tell the person, where git's identity is a test's: each value with the file it came from, and how to remove
 * it. Null where it is fine.
 */
export const testIdentityWarning = (identity: Identity): string | null => {
  const bad = testIdentityIn(identity)
  if (bad.length === 0) return null
  const where = bad.map((source) => `“${source.value}” from ${source.origin}`).join(' and ')
  return `Git here would write commits as a test’s identity (${where}), not as you, so Althar commits as itself. Remove it with git config --unset in that file (the person’s own, in ~/.gitconfig, stays).`
}

/**
 * The `-c` arguments for a commit Althar makes in a folder: none where git has a person's identity (theirs, as their own
 * git commits are), Althar's own where it has none or a test's, and with the latter, what to say about it.
 */
export const committerIdentity = (path: string): Effect.Effect<{ readonly as: ReadonlyArray<string>; readonly warning: string | null }> =>
  Effect.map(identityIn(path), (identity) => {
    const warning = testIdentityWarning(identity)
    if (warning !== null) return { as: ALTHAR_IDENTITY, warning }
    // Git writes the committer from the environment's committer words or its config; an author's alone gives it none.
    const named =
      process.env.GIT_COMMITTER_EMAIL !== undefined || (identity.email !== null && !identity.email.origin.startsWith('the environment'))
    return { as: named ? [] : ALTHAR_IDENTITY, warning: null }
  })
