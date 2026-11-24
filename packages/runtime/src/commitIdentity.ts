import { resolve } from 'node:path'

import { Effect } from 'effect'

import { gitOutcome, gitOutcomeWith } from './git'

/*
 * Who a commit Althar makes for a task is written as. A repository's own config
 * wins over the person's global one, so a test identity (`T <t@t.test>`) that
 * was ever written into a repository's `.git/config`, which every worktree of it
 * shares, is the author of every later commit of every task there, and the code
 * host shows it on the pull requests instead of the person. Where git resolves
 * to what is plainly a test's, Althar says so in the task's thread, naming the
 * key, the value and the file it came from, and commits as itself instead:
 * never as the test's name, and never by changing the person's config.
 *
 * Git resolves the author and the committer each on its own, and in this order:
 * the environment (`GIT_AUTHOR_EMAIL`), then the role's own config key
 * (`author.email`), then `user.email`. Each is resolved the same way here, and
 * Althar's own identity goes in through the environment, the one place nothing
 * else outranks.
 */

/** A value git resolved, and where it read it: which key or variable, and the config file's path or the environment. */
export interface Source {
  readonly value: string
  readonly key: string
  readonly origin: string
}

export type Role = 'author' | 'committer'

/** What git itself writes one role of a commit as (`git var GIT_AUTHOR_IDENT`): null where it refuses to. */
export interface Resolved {
  readonly name: string
  readonly email: string
}

/**
 * One role of a commit in a folder: what git resolves it to, which is what is judged, and where each of its name and
 * email came from, which is what is said.
 */
export interface Person {
  readonly resolved: Resolved | null
  readonly name: Source | null
  readonly email: Source | null
}

/** Both roles of a commit, as git would write them in a folder. */
export type Identity = Readonly<Record<Role, Person>>

/** The environment for a commit Althar makes: empty where git writes the person, Althar's own where it would write no one or a test. */
export type Committer = Readonly<Record<string, string>>

const ROLES: ReadonlyArray<Role> = ['author', 'committer']

/** Althar's own name, for one role of a commit, as the environment that outranks every config. */
export const altharAs = (role: Role): Committer => {
  const upper = role.toUpperCase()
  return { [`GIT_${upper}_NAME`]: 'Althar', [`GIT_${upper}_EMAIL`]: 'althar@localhost' }
}

/** Althar's own name, for both roles. */
export const ALTHAR: Committer = { ...altharAs('author'), ...altharAs('committer') }

const fromEnvironment = (env: NodeJS.ProcessEnv, role: Role, field: 'name' | 'email'): Source | null => {
  const key = `GIT_${role.toUpperCase()}_${field.toUpperCase()}`
  const value = env[key]
  // Set though empty, it is still git's word for the role, over any config: so it is here.
  return value === undefined ? null : { value, key, origin: 'the environment' }
}

/**
 * Every identity key in `git config --show-origin --get-regexp` output, with the file each came from: the last of a
 * key wins, as in git. A file in the folder's own repository is named from it (`.git/config`): said whole, so the
 * person can open it.
 */
export const configuredIn = (path: string, output: string): ReadonlyMap<string, Source> => {
  const keys = new Map<string, Source>()
  for (const found of output.matchAll(/^([^\t\n]*)\t(\S+) ?(.*)$/gm)) {
    // Every group takes part in each match.
    const named = String(found[1])
    const key = String(found[2]).toLowerCase()
    const origin = named.startsWith('file:') ? resolve(path, named.slice('file:'.length)) : named
    keys.set(key, { value: String(found[3]), key, origin })
  }
  return keys
}

const configured = (path: string) =>
  Effect.map(gitOutcome(path, 'config', '--show-origin', '--get-regexp', '^(user|author|committer)\\.(name|email)$'), (found) =>
    configuredIn(path, found.code === 0 ? found.stdout : ''),
  )

const IDENTITY_VARIABLES = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const

/** `Name <email> 1700000000 +0100`, as `git var` writes an identity. */
const IDENT = /^(.*?) <([^>]*)> \d+ [+-]\d{4}$/

/** What git writes one role as here, with `env`'s identity words over Althar's own: null where it refuses (an empty name). */
const resolvedIn = (path: string, role: Role, env: NodeJS.ProcessEnv) => {
  const words = Object.fromEntries(
    IDENTITY_VARIABLES.flatMap((name) => {
      const value = env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
  return Effect.map(gitOutcomeWith(words, path, 'var', `GIT_${role.toUpperCase()}_IDENT`), ({ code, stdout }): Resolved | null => {
    const [, name, email] = (code === 0 ? IDENT.exec(stdout) : null) ?? []
    return name === undefined || email === undefined ? null : { name, email }
  })
}

/**
 * Who git would write a commit as in a folder, each role as git itself resolves it, and where each value came from:
 * the environment, the role's key, then `user.*`, as git reads them.
 */
export const identityIn = (path: string, env: NodeJS.ProcessEnv = process.env): Effect.Effect<Identity> =>
  Effect.map(
    Effect.all([configured(path), resolvedIn(path, 'author', env), resolvedIn(path, 'committer', env)], { concurrency: 3 }),
    ([keys, author, committer]) => {
      const field = (role: Role, name: 'name' | 'email') =>
        fromEnvironment(env, role, name) ?? keys.get(`${role}.${name}`) ?? keys.get(`user.${name}`) ?? null
      return {
        author: { resolved: author, name: field('author', 'name'), email: field('author', 'email') },
        committer: { resolved: committer, name: field('committer', 'name'), email: field('committer', 'email') },
      }
    },
  )

const isTest = (value: string, field: 'name' | 'email') => (field === 'name' ? value.trim() === 'T' : /@[^@\s]*\.test$/i.test(value.trim()))

/**
 * What of one role is plainly a test's, judged on what git resolves it to (`<t@t.test>` in a config is `t@t.test`):
 * the name `T`, or an address on a `.test` domain. Each is said by where it came from.
 */
const testIn = ({ resolved, ...sources }: Person): ReadonlyArray<Source> =>
  resolved === null
    ? []
    : (['name', 'email'] as const).flatMap((field) => {
        const value = resolved[field]
        if (!isTest(value, field)) return []
        return [sources[field] ?? { value, key: `user.${field}`, origin: 'git’s own default' }]
      })

/** Whether git would write one role as no one Althar can stand behind: it refuses, or has no address for it. */
const unnamed = (person: Person) => person.resolved === null || person.resolved.email === '' || person.email === null

/** Whatever of an identity is plainly a test's, each value once, though both roles read it. */
export const testIdentityIn = (identity: Identity): ReadonlyArray<Source> => {
  const seen = new Map<string, Source>()
  for (const role of ROLES) for (const source of testIn(identity[role])) seen.set(`${source.key}\0${source.origin}`, source)
  return [...seen.values()]
}

/**
 * What to tell the person, where git's identity is a test's: each value with its key and where it came from, and how
 * to remove it. Null where it is fine.
 */
export const testIdentityWarning = (identity: Identity): string | null => {
  const bad = testIdentityIn(identity)
  if (bad.length === 0) return null
  const where = bad
    .map((source) =>
      source.origin === 'the environment'
        ? `“${source.value}” from ${source.key} in Althar’s environment`
        : `“${source.value}” (${source.key}) from ${source.origin}`,
    )
    .join(' and ')
  return `Git here would write commits as a test’s identity (${where}), not as you, so Althar commits as itself. Remove it with git config --unset in that file; your own, in ~/.gitconfig, stays.`
}

/**
 * The environment for a commit Althar makes in a folder, and what to say about it: for each role git would write a
 * person as, nothing, so it is the person, as their own git commits are; for a role it would write a test as, or no
 * one, Althar's own.
 */
export const committerIdentity = (
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<{ readonly as: Committer; readonly warning: string | null }> =>
  Effect.map(identityIn(path, env), (identity) => {
    const as = Object.assign(
      {},
      ...ROLES.map((role) => (unnamed(identity[role]) || testIn(identity[role]).length > 0 ? altharAs(role) : {})),
    ) as Committer
    return { as, warning: testIdentityWarning(identity) }
  })
