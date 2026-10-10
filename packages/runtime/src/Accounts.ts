import { mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

import { Ids, newId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { type AgentDefinition, signInCommand, signOut } from '@althar/provider-adapters'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents, RuntimeConfig } from './Config'
import { NotFound, UnknownAgent } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'

/*
 * Several accounts per agent (ADR-012, docs/architecture/03): each one sign-in
 * of an agent, kept by the agent in a folder of its own, its home. The
 * agent's usual folder is its first account, made the first time the agent
 * is asked for. Althar points the agent at a home through its environment
 * and never opens what the agent keeps there: a home it makes gets the
 * person's settings linked in and the agent's own sign-in opened in it, and
 * one another tool made is adopted as it is.
 */

/** One sign-in of an agent on this device. */
export interface Account {
  readonly id: string
  readonly agentId: string
  readonly name: string
  /** Its folder; null for the agent's usual one, its first account. */
  readonly home: string | null
  readonly position: number
  /** What made its home, when Althar didn't. */
  readonly adoptedFrom: string | null
}

/** A folder a known switcher keeps an account in, not yet an account here. */
export interface Found {
  readonly path: string
  /** What it is called there, as a name for the account. */
  readonly name: string
  readonly tool: string
}

/** What the usual folder's account is called until the person names it. */
export const USUAL = 'main'

/** The agent didn't sign an account out, so it and its folder stay: the line that signs it out by hand. */
export class SignOutFailed extends Schema.TaggedError<SignOutFailed>()('SignOutFailed', { line: Schema.String }) {}

export class AccountRefused extends Schema.TaggedError<AccountRefused>()('AccountRefused', {
  reason: Schema.Literals(['no_room', 'not_a_folder', 'usual', 'taken', 'no_name']),
}) {}

/**
 * Where switchers people use keep each account in a folder of its own, by
 * agent: read by name only. Swapping switchers keep no such folders, and
 * rotating ones work inside a single home (docs/architecture/03).
 */
const switchers = (
  agentId: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): ReadonlyArray<{ readonly tool: string; readonly within: string; readonly prefix?: string }> => {
  switch (agentId) {
    case 'claude-code':
      // ccam and the like: ~/.claude-work beside ~/.claude.
      return [{ tool: '~/.claude-*', within: home, prefix: '.claude-' }]
    case 'codex':
      return [
        // codex-profiles: ~/.codex-work beside ~/.codex; its app keeps new ones in Application Support.
        { tool: 'codex-profiles', within: home, prefix: '.codex-' },
        { tool: 'codex-profiles', within: join(home, 'Library', 'Application Support', 'Codex Profiles', 'accounts') },
        {
          tool: 'codex-account-switcher',
          within: join(env.CODEX_ACCOUNTS_HOME ?? join(home, '.local', 'share', 'codex-accounts'), 'accounts'),
        },
      ]
    default:
      return []
  }
}

/** Folders named like an account's that aren't one. */
const NOT_HOMES = new Set(['.claude-code-router'])

/** A word quoted for a POSIX shell. */
const quoted = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Instance | Agents | RuntimeConfig
type Failure = SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict

export class Accounts extends Context.Service<
  Accounts,
  {
    /** An agent's accounts on this device, in the person's order, its usual one made if it has none. */
    of(agentId: string): Effect.Effect<ReadonlyArray<Account>, SqlError.SqlError>
    get(accountId: string): Effect.Effect<Account, NotFound | SqlError.SqlError>
    /** What points the agent at the account's home: nothing for its usual folder. */
    env(account: Account): Readonly<Record<string, string>>
    /** Readies a home Althar made for a session: what came to the usual folder since is linked in too. */
    prepare(account: Account): Effect.Effect<void>
    /** Adds an account: in the folder given, as another tool made it, or in a home Althar makes. */
    add(input: {
      readonly agentId: string
      readonly name: string
      readonly folder?: string
    }): Effect.Effect<Account, AccountRefused | UnknownAgent | SqlError.SqlError | Schema.SchemaError>
    rename(accountId: string, name: string): Effect.Effect<void, AccountRefused | NotFound | Failure>
    /**
     * Stops using an account. One in a folder Althar made is signed out
     * with the agent's own tool and its folder deleted; one another tool made
     * stays as it is, signed in, that tool's.
     */
    remove(
      accountId: string,
      options?: { readonly anyway?: boolean },
    ): Effect.Effect<void, AccountRefused | SignOutFailed | NotFound | Failure>
    /** Puts an agent's accounts in the order given; any left out keep theirs, after. */
    order(agentId: string, accountIds: ReadonlyArray<string>): Effect.Effect<void, Failure>
    /** Folders known switchers keep the agent's accounts in that aren't accounts here yet. */
    found(agentId: string): Effect.Effect<ReadonlyArray<Found>, SqlError.SqlError>
    /** The line that signs the account in with the agent's own tool, in its home. */
    login(accountId: string): Effect.Effect<string, NotFound | UnknownAgent | SqlError.SqlError>
  }
>()('@althar/runtime/Accounts') {
  static readonly layer: Layer.Layer<Accounts, never, Store> = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const agents = yield* Agents
      const config = yield* RuntimeConfig
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const definitionOf = (agentId: string): AgentDefinition | undefined =>
        agents.list.find((entry) => entry.definition.id === agentId)?.definition
      /** Where the agent keeps its usual sign-in on this Mac. */
      const usualOf = (definition: AgentDefinition) => definition.home.usual(process.env, homedir())
      const real = (path: string) => {
        try {
          return realpathSync(path)
        } catch {
          return path
        }
      }

      const rows = (agentId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<Account>`
            SELECT id, agent_id, name, home, position, adopted_from FROM agent_accounts
            WHERE device_id = ${instance.deviceId} AND agent_id = ${agentId} AND removed_at IS NULL
            ORDER BY position, created_at`
        })

      const record = (account: Account, type: string, revision: number, payload: unknown) =>
        fact({ aggregateType: 'agent_account', aggregateId: account.id, revision, type, payload, actorId: instance.personId })

      const insert = (input: Omit<Account, 'id' | 'position'>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const id = yield* newId(Ids.agentAccount)
          const [last] = yield* sql<{ position: number | null }>`
            SELECT max(position) AS position FROM agent_accounts
            WHERE device_id = ${instance.deviceId} AND agent_id = ${input.agentId} AND removed_at IS NULL`
          const account: Account = { ...input, id, position: last?.position === null || last === undefined ? 0 : last.position + 1 }
          yield* sql`INSERT INTO agent_accounts ${sql.insert({
            id,
            agentId: account.agentId,
            deviceId: instance.deviceId,
            name: account.name,
            home: account.home,
            position: account.position,
            adoptedFrom: account.adoptedFrom,
            createdAt: yield* timestamp,
          })}`
          return account
        })

      const of = (agentId: string) =>
        Effect.gen(function* () {
          const known = yield* rows(agentId)
          if (known.some((account) => account.home === null)) return known
          const sql = yield* SqlClient.SqlClient
          // The agent's usual folder is its first account; who it was seen as before accounts were kept goes with it.
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const usual = yield* insert({ agentId, name: USUAL, home: null, adoptedFrom: null })
              yield* sql`UPDATE principals SET account_id = ${usual.id}
                WHERE agent_id = ${agentId} AND device_id = ${instance.deviceId} AND account_id IS NULL`
            }),
          )
          return yield* rows(agentId)
        })

      const get = (accountId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [account] = yield* sql<Account>`
            SELECT id, agent_id, name, home, position, adopted_from FROM agent_accounts
            WHERE id = ${accountId} AND device_id = ${instance.deviceId} AND removed_at IS NULL`
          return account === undefined ? yield* new NotFound({ kind: 'account', id: accountId }) : account
        })

      /** The folder of an account Althar made, where it is still under the runtime's own: never one another tool made. */
      const madeHere = (account: Account): string | undefined => {
        const root = config.accountsRoot
        if (account.home === null || account.adoptedFrom !== null || root === undefined) return undefined
        // One folder right under the root, named by the account: never the root itself, nor anything above or deeper.
        const inside = relative(root, account.home)
        return inside === '' || isAbsolute(inside) || inside.startsWith('..') || inside.includes(sep) ? undefined : account.home
      }

      /**
       * Signs the account out with its agent's own tool, in its home, then
       * deletes the folder. Where the agent didn't sign it out, the folder
       * stays, so no sign-in is left with nothing pointing at it: Claude
       * Code's Keychain item is named after the folder's path.
       */
      const forget = (account: Account, folder: string) =>
        Effect.gen(function* () {
          const definition = definitionOf(account.agentId)
          const logout = definition?.signIn.logout
          if (definition !== undefined && logout !== undefined && !(yield* signOut(definition, process.execPath, env(account))))
            return yield* new SignOutFailed({
              line: `${definition.home.variable}=${quoted(folder)} ${logout.line}`,
            })
          yield* Effect.sync(() => rmSync(folder, { recursive: true, force: true }))
        })

      const env = (account: Account): Readonly<Record<string, string>> => {
        const definition = definitionOf(account.agentId)
        return account.home === null || definition === undefined ? {} : { [definition.home.variable]: account.home }
      }

      const found = (agentId: string) =>
        Effect.gen(function* () {
          const definition = definitionOf(agentId)
          if (definition === undefined) return []
          const taken = new Set([
            real(usualOf(definition)),
            ...(yield* of(agentId)).flatMap((account) => (account.home === null ? [] : [real(account.home)])),
          ])
          const seen: Array<Found> = []
          for (const place of switchers(agentId, process.env, homedir())) {
            for (const entry of listing(place.within)) {
              if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
              if (place.prefix !== undefined && (!entry.name.startsWith(place.prefix) || NOT_HOMES.has(entry.name))) continue
              const path = join(place.within, entry.name)
              if (taken.has(real(path)) || !isFolder(path)) continue
              taken.add(real(path))
              seen.push({ path, name: place.prefix === undefined ? entry.name : entry.name.slice(place.prefix.length), tool: place.tool })
            }
          }
          return seen
        })

      const named = (name: string) =>
        Effect.succeed(name.trim()).pipe(
          Effect.filterOrFail(
            (trimmed) => trimmed !== '',
            () => new AccountRefused({ reason: 'no_name' }),
          ),
        )

      const add = (input: { readonly agentId: string; readonly name: string; readonly folder?: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const definition = definitionOf(input.agentId)
          if (definition === undefined) return yield* new UnknownAgent({ agentId: input.agentId })
          const name = yield* named(input.name)
          const accounts = yield* of(input.agentId)
          const folder = input.folder
          if (folder !== undefined) {
            if (!isFolder(folder)) return yield* new AccountRefused({ reason: 'not_a_folder' })
            if (real(folder) === real(usualOf(definition))) return yield* new AccountRefused({ reason: 'usual' })
            if (accounts.some((account) => account.home !== null && real(account.home) === real(folder)))
              return yield* new AccountRefused({ reason: 'taken' })
            const known = (yield* found(input.agentId)).find((place) => real(place.path) === real(folder))
            const tool = known === undefined ? 'a folder you chose' : known.tool
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                const account = yield* insert({ agentId: input.agentId, name, home: folder, adoptedFrom: tool })
                yield* record(account, 'agent_account.adopted', 1, { agentId: account.agentId, name, home: folder, tool })
                return account
              }),
            )
          }
          if (config.accountsRoot === undefined) return yield* new AccountRefused({ reason: 'no_room' })
          const id = yield* newId(Ids.agentAccount)
          // Named by the account, so it never moves: Claude Code ties its sign-in to the folder's path.
          const home = join(config.accountsRoot, id)
          yield* Effect.sync(() => mkdirSync(home, { recursive: true, mode: 0o700 }))
          link(definition, home)
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const account = yield* insert({ agentId: input.agentId, name, home, adoptedFrom: null })
              yield* record(account, 'agent_account.added', 1, { agentId: account.agentId, name, home })
              return account
            }),
          )
        })

      return Accounts.of({
        of: (agentId) => provide(of(agentId)),
        get: (accountId) => provide(get(accountId)),
        env,
        prepare: (account) =>
          Effect.sync(() => {
            const definition = definitionOf(account.agentId)
            const made = madeHere(account)
            if (definition !== undefined && made !== undefined) link(definition, made)
          }),
        add: (input) => provide(add(input)),
        rename: (accountId, name) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const account = yield* get(accountId)
              const trimmed = yield* named(name)
              if (trimmed === account.name) return
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const revision = yield* change('agent_accounts', account.id, { name: trimmed })
                  yield* record(account, 'agent_account.renamed', revision, { name: trimmed })
                }),
              )
            }),
          ),
        remove: (accountId, options = {}) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const account = yield* get(accountId)
              if (account.home === null) return yield* new AccountRefused({ reason: 'usual' })
              // A folder Althar made is signed out with the agent's own tool, then goes; one another tool made stays its.
              const made = madeHere(account)
              // Anyway, as when the agent's tool is gone: the folder goes even where its sign-out didn't happen.
              if (made !== undefined)
                yield* forget(account, made).pipe(
                  Effect.catchTag('SignOutFailed', (failed) =>
                    options.anyway === true ? Effect.sync(() => rmSync(made, { recursive: true, force: true })) : Effect.fail(failed),
                  ),
                )
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const revision = yield* change('agent_accounts', account.id, { removedAt: yield* timestamp })
                  yield* record(account, 'agent_account.removed', revision, { signedOutAndDeleted: made !== undefined })
                }),
              )
            }),
          ),
        order: (agentId, accountIds) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const accounts = yield* of(agentId)
              const ordered = [
                ...accountIds.flatMap((id) => accounts.filter((account) => account.id === id)),
                ...accounts.filter((account) => !accountIds.includes(account.id)),
              ]
              yield* sql.withTransaction(
                Effect.forEach(ordered, (account, position) =>
                  account.position === position
                    ? Effect.void
                    : Effect.gen(function* () {
                        const revision = yield* change('agent_accounts', account.id, { position })
                        yield* record(account, 'agent_account.moved', revision, { position })
                      }),
                ),
              )
            }),
          ),
        found: (agentId) => provide(found(agentId)),
        login: (accountId) =>
          provide(
            Effect.gen(function* () {
              const account = yield* get(accountId)
              const definition = definitionOf(account.agentId)
              if (definition === undefined) return yield* new UnknownAgent({ agentId: account.agentId })
              // Terminal has its own environment and PATH. Preserve the account here,
              // and use the bundled executable where the agent supplies one.
              return signInCommand(definition, account.home ?? process.env[definition.home.variable])
            }),
          ),
      })
    }),
  )
}

/**
 * Links into a home Althar made what of the agent's usual folder isn't
 * the account's own (the registry's `shared`), where the home hasn't it
 * yet: the person's settings, or other tools' data. Never a sign-in.
 */
const link = (definition: AgentDefinition, home: string) => {
  const usual = definition.home.usual(process.env, homedir())
  const names = listing(usual).map((entry) => entry.name)
  for (const name of definition.home.shared(names)) {
    try {
      symlinkSync(join(usual, name), join(home, name))
    } catch {
      // There already, as the home's own or linked before.
    }
  }
}

/** A folder's entries, by name and kind; none where it can't be read. */
const listing = (path: string) => {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
