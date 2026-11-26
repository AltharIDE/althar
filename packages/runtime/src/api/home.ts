import { API_VERSION, type ApiHandlers, ApiError, type AgentStatus, type WatchEvent } from '@althar/contracts'
import { Ledger } from '@althar/persistence-sqlite'
import { Effect, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../Accounts'
import { contained } from '../Failures'
import { type AgentEntry, Agents, RuntimeConfig } from '../Config'
import { machineFacts } from '../homeFolders'
import { Instance } from '../Instance'
import { MachineLoad } from '../MachineLoad'
import { deltasFor, Live, newestOf, watchedKey, watchedOf } from '../Live'
import { missedReports } from '../missedReports'
import { Models } from '../Models'
import { Installs } from '../Installs'
import { Queries } from '../Queries'
import { Busy } from '../Busy'
import { timestamp } from '../records'
import { afterOpen, startup } from '../startup'
import { anyOf } from '../SignIns'
import type { ApiKit } from './kit'

/** How often the change feed is read when nothing says it grew: a fallback, not the way changes arrive. */
const FEED_FALLBACK = '1 second'

/**
 * The home as a whole: its status, the change feed (Watch, WatchFrom), the home screen, and this computer.
 * Machine, load, places and missed reports; leaving the home screen.
 */
export const homeHandlers = ({ identity, api, personHome, cursorNow, accountStatus }: ApiKit) =>
  Effect.gen(function* () {
    const machine = yield* MachineLoad
    const queries = yield* Queries
    const live = yield* Live
    const accounts = yield* Accounts
    const installs = yield* Installs
    const models = yield* Models
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const ledger = yield* Ledger
    const agents = yield* Agents
    const config = yield* RuntimeConfig
    const busy = yield* Busy
    /*
     * An agent, with its accounts: each check starts the agent's own status
     * command, in the account's home. An agent that couldn't be looked at
     * says so on its own, and every other agent is shown as it is.
     */
    const signIn = (entry: AgentEntry, recheck: boolean) =>
      Effect.gen(function* () {
        const statuses = yield* Effect.forEach(
          yield* accounts.of(entry.definition.id),
          (account) =>
            // Checked again, one being signed in in Terminal is asked its models afresh: the sign-in may be done now.
            recheck ? Effect.andThen(models.signInChecked(account.id), accountStatus(account, recheck)) : accountStatus(account, recheck),
          { concurrency: 'unbounded' },
        )
        const install = yield* installs.state(entry.definition)
        return {
          id: entry.definition.id,
          name: entry.definition.name,
          installed: entry.definition.cli === undefined || install.located !== null,
          kept: install.located?.whose === 'althar',
          download:
            install.downloadable && install.size !== null
              ? { size: install.size, installing: install.installing, pinned: install.pinned }
              : null,
          signIn: anyOf(statuses.map((account) => account.signIn)),
          login: entry.definition.signIn.login,
          version: yield* installs.version(entry.definition).pipe(contained('Status.version', () => null, entry.definition.id)),
          ways: entry.definition.signIn.inApp?.ways ?? [],
          accounts: statuses,
          addsAccounts: entry.definition.home.accounts !== 'one',
          ...(entry.definition.native === undefined && entry.definition.signIn.logout !== undefined ? { signsOut: true } : {}),
          guide: entry.definition.cli?.guide ?? null,
          problem: null,
        } satisfies AgentStatus
      }).pipe(
        contained(
          'Status.agent',
          (): AgentStatus => ({
            id: entry.definition.id,
            name: entry.definition.name,
            installed: true,
            kept: false,
            download: null,
            signIn: 'unknown',
            login: entry.definition.signIn.login,
            version: null,
            ways: entry.definition.signIn.inApp?.ways ?? [],
            accounts: [],
            addsAccounts: entry.definition.home.accounts !== 'one',
            // Nothing that might be what failed: its command is read no more here.
            guide: null,
            problem: `Althar couldn't check ${entry.definition.name}. Its log has the details.`,
          }),
          entry.definition.id,
        ),
      )
    /*
     * Changes from the store's feed after `since`, or from now: the window
     * reads again what shows them. It reads when the ledger says the feed grew,
     * so it is quick when something happens and idle when nothing does, and
     * once a second in case a signal is ever missed.
     */
    const changes = (since: number | undefined, checked = false): Stream.Stream<WatchEvent, ApiError> =>
      Stream.unwrap(
        api(
          Effect.gen(function* () {
            // Listening starts before the first read, so nothing added in between is missed.
            const grown = yield* ledger.listen
            const start = since ?? (yield* queries.cursor)
            return Stream.paginate(start, (cursor) =>
              api(
                Effect.gen(function* () {
                  const batch = yield* queries.changesSince(cursor, 500)
                  if (batch.length === 0) yield* Effect.raceFirst(grown, Effect.sleep(FEED_FALLBACK))
                  const events: ReadonlyArray<WatchEvent> = batch.map(({ checkpoint, renamedTo, renamedByAgent, ...change }) => ({
                    _tag: 'Changed',
                    ...change,
                    ...(renamedTo === null ? {} : { renamedTo, renamedByAgent: renamedByAgent === 1 }),
                    ...(checked ? { checkpoint } : {}),
                  }))
                  return [events, Option.some(batch.at(-1)?.cursor ?? cursor)] as const
                }),
              ),
            )
          }),
        ),
      )
    /*
     * What is happening now, for one watch: an agent's message or thought as
     * far as it has streamed, before the store has all of it; how full its
     * context is, as it says; a command's output; and what the runtime sends
     * whole as it changes. Each is whole, so a watch that falls behind is sent
     * the newest of each (`newestOf`), and nothing piles up for a window that
     * stopped reading. With `deltas`, a message comes as what was added since
     * this watch last sent it, not whole every time to every window.
     */
    const streaming = (deltas: boolean): Stream.Stream<WatchEvent> =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Listening first, then what is being drafted now: nothing between is missed, and a newer draft takes its place.
          const subscribed = yield* live.subscribe
          const now = yield* live.drafting
          const events = Stream.flatMap(Stream.concat(Stream.fromIterable(now), subscribed), (event) => {
            const shown = watchedOf(event)
            return shown === undefined ? Stream.empty : Stream.make(shown)
          })
          const newest = yield* newestOf(events, watchedKey)
          if (!deltas) return newest
          const sent = deltasFor()
          return Stream.flatMap(newest, (event) => {
            const delta = sent(event)
            return delta === undefined ? Stream.empty : Stream.make(delta)
          })
        }),
      )
    return {
      WatchFrom: ({ position }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const latest = yield* api(cursorNow)
            if (position.homeId !== instance.homeId || position.cursor > latest)
              return yield* new ApiError({
                reason: 'SnapshotRequired',
                message: 'This saved position belongs to another home or a newer database. Read a fresh snapshot before watching again.',
              })
            const [entry] = yield* api(sql<{ checkpoint: string }>`SELECT checkpoint FROM change_log WHERE cursor = ${position.cursor}`)
            if (
              (position.cursor === 0 && position.checkpoint !== null) ||
              (position.cursor > 0 && (position.checkpoint === null || entry === undefined || entry.checkpoint !== position.checkpoint))
            )
              return yield* new ApiError({
                reason: 'SnapshotRequired',
                message: 'The saved position does not match this home’s current history. Read a fresh snapshot before watching again.',
              })
            const [oldest] = yield* api(sql<{ cursor: number }>`SELECT min(cursor) AS cursor FROM change_log`)
            if (oldest?.cursor != null && position.cursor < oldest.cursor - 1)
              return yield* new ApiError({
                reason: 'SnapshotRequired',
                message: 'This saved position is older than the available change history. Read a fresh snapshot before watching again.',
              })
            return Stream.merge(changes(position.cursor, true), streaming(false))
          }),
        ),
      Status: ({ recheck }) =>
        Effect.map(
          api(
            afterOpen(
              startup(
                'agent-checks',
                Effect.forEach(agents.list, (entry) => startup(`agent-${entry.definition.id}`, signIn(entry, recheck === true)), {
                  concurrency: 'unbounded',
                }),
              ),
            ),
          ),
          (statuses) => ({
            apiVersion: API_VERSION,
            appVersion: config.appVersion,
            agents: statuses,
          }),
        ),
      GetMachine: () => api(machineFacts(personHome)),
      GetHome: ({ since, cached }) => api(queries.home(since, identity.deviceId, cached)),
      LeftHome: () =>
        api(
          Effect.gen(function* () {
            yield* sql`UPDATE devices SET home_looked_at = ${yield* timestamp} WHERE id = ${identity.deviceId}`
          }),
        ),
      GetLoad: () => api(machine.now),
      GetPlaces: () => api(busy.places),
      GetMissedReports: () => api(missedReports),
      Watch: ({ since, deltas }) => Stream.merge(changes(since), streaming(deltas === true)),
    } satisfies Partial<ApiHandlers>
  })
