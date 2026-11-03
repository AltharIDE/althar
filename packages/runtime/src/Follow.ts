import { randomUUID } from 'node:crypto'

import { type Allowance, type Check, type CodeHost, ConnectorFailed, type ListedChange, type Repository } from '@althar/connectors'
import { Ledger } from '@althar/persistence-sqlite'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Connections } from './Connections'
import { Errands } from './Errands'
import { Instance } from './Instance'
import { easing, FAILED_READ_FOR, listEvery, makeSpending } from './followBudget'
import { type Place, placesOf } from './pullRequestList'
import { checksOf } from './pullRequestWords'
import { change, fact, timestamp } from './records'

/*
 * Every open pull request in a project's repositories, whoever opened it, for
 * news (ADR-081). Not a second poller: Changes' listening turn calls `tick`
 * each time it runs, and this decides what is due.
 *
 * A pull request followed so has no task, no lead and no card. What is kept of
 * it is facts, in Althar's words: its state, its head, how its checks stand.
 * Never its title, its description or what anyone said on it, whoever opened
 * it: the coordinator hears of a stranger's pull request only what the host
 * says in numbers and states, and a title is the author's to word.
 *
 * What it asks of a host:
 * - the open list, every five minutes, by ETag where the host has them;
 * - a pull request's checks when its head moved or a check still runs, and, at
 *   an unchanged head, for a day after they failed, so a rerun without a push
 *   still comes as news;
 * - one an errand waits on as a task's own is read, every turn, and ten times
 *   slower once it has been quiet;
 * and all of it within a fifth of the host's hourly allowance, backing off as
 * what is left falls (`followBudget.ts`).
 */

export type FollowStore = SqlClient.SqlClient | Instance | Ledger | Connections | Errands

/** How often a running check is read again. */
const RUNNING_EVERY = Duration.minutes(2)

/** How long the repositories of a project are kept before they are looked up again. */
const PLACES_KEPT = Duration.minutes(5)

/** How long a repository's description is kept: what it allows doesn't change by the minute. */
const REPOSITORY_KEPT = Duration.hours(1)

/** How many open pull requests a repository's list is read for. A list this long may hold more, so none missing from it is taken as gone. */
const OPEN_LISTED = 100

export interface Row {
  readonly id: string
  readonly projectId: string
  readonly connectionId: string
  readonly repository: string
  readonly number: number
  readonly url: string
  readonly state: 'open' | 'merged' | 'closed'
  readonly headSha: string | null
  readonly fromFork: number
  readonly baseline: number
  readonly checksSha: string | null
  readonly checksOutcome: 'passed' | 'failed' | 'running' | null
  readonly checksRevision: number
  readonly failedAt: string | null
  readonly checksReadAt: string | null
}

/** Whether some words name the pull request: its link, or its repository and number (`owner/repo#12`, `group/project!4`). */
export const namesPull = (text: string, pull: { readonly url: string; readonly repository: string; readonly number: number }): boolean => {
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const lower = text.toLowerCase()
  const url = pull.url.toLowerCase().replace(/\/+$/, '')
  return (
    new RegExp(`${escaped(url)}(?![0-9a-z])`).test(lower) ||
    new RegExp(`${escaped(pull.repository.toLowerCase())}[#!]${pull.number}(?![0-9])`).test(lower)
  )
}

/** The news one followed pull request brings the coordinator: facts only, as `coordinatorNews` words them. */
export type FollowedNews =
  | { readonly kind: 'opened' }
  | { readonly kind: 'checks'; readonly outcome: 'passed' | 'failed'; readonly sha: string }
  | { readonly kind: 'merged' }
  | { readonly kind: 'closed' }

/**
 * Whether a followed pull request's checks are due to be read now, and how
 * soon: 0 for one an errand waits on, when it is due as a task's own pull
 * request would be (`awaitedDue`, null where none waits); 1 for one whose
 * head moved since its checks were read, or whose checks still run (every
 * few minutes); 2 for one whose checks failed, at its unchanged head, for a
 * day after: each time the list is read, so a rerun without a push still
 * comes as news. Null for the rest: checks that passed, or that it can't see.
 */
export const dueRank = (input: {
  readonly row: Pick<Row, 'headSha' | 'checksSha' | 'checksOutcome' | 'failedAt'>
  readonly awaitedDue: boolean | null
  readonly now: number
  readonly polledAt: number | undefined
  readonly every: number
}): 0 | 1 | 2 | null => {
  const { row, now, polledAt } = input
  if (input.awaitedDue !== null) return input.awaitedDue ? 0 : null
  if (row.headSha !== null && row.checksSha !== row.headSha) return 1
  if (row.checksOutcome === 'running') return polledAt === undefined || now - polledAt >= Duration.toMillis(RUNNING_EVERY) ? 1 : null
  if (
    row.checksOutcome === 'failed' &&
    row.failedAt !== null &&
    now - Date.parse(row.failedAt) < FAILED_READ_FOR &&
    (polledAt === undefined || now - polledAt >= input.every)
  )
    return 2
  return null
}

export const makeFollowing = (options: {
  /** How often a task's own pull request is asked. */
  readonly every: Duration.Duration
  /** Whether something polled at `polledAt`, whose last news was at `newsAt`, is due as a task's own pull request is. */
  readonly due: (input: {
    readonly now: number
    readonly polledAt: number | undefined
    readonly newsAt: number
    readonly every: Duration.Duration
  }) => boolean
}) => {
  const spending = makeSpending()
  /** When each repository's list was last read, by connection and path. */
  const listedAt = new Map<string, number>()
  /** What the last round of reading each repository cost, in requests. */
  const costed = new Map<string, number>()
  /** Repositories whose first list was read: what was open then is a baseline, not news. */
  const baselined = new Set<string>()
  /** Where a repository, or a whole connection, is left alone until: a host that asked to wait, or failed. */
  const leftUntil = new Map<string, number>()
  const checkedAt = new Map<string, number>()
  const newsAt = new Map<string, number>()
  const repositories = new Map<string, { readonly at: number; readonly repository: Repository }>()
  const placesKept = new Map<string, { readonly at: number; readonly places: ReadonlyArray<Place> }>()

  const placesFor = (projectId: string, now: number) =>
    Effect.gen(function* () {
      const kept = placesKept.get(projectId)
      if (kept !== undefined && now - kept.at < Duration.toMillis(PLACES_KEPT)) return kept.places
      const { places } = yield* placesOf(projectId)
      const found = places.filter((place): place is Place => typeof place !== 'string')
      placesKept.set(projectId, { at: now, places: found })
      return found
    })

  /** The errands that wait on something that names this pull request. */
  const waitedOn = (projectId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const steps = yield* sql<{ errandId: string; target: string; waits: string }>`
        SELECT e.id AS errand_id, s.target, s.waits FROM errands e JOIN errand_steps s ON s.errand_id = e.id
        WHERE e.project_id = ${projectId} AND e.state = 'open' AND s.state <> 'done'`
      return steps.map((step) => ({
        errandId: step.errandId,
        texts: [
          step.target,
          ...(JSON.parse(step.waits) as Array<{ target?: string }>).flatMap((wait) => (wait.target === undefined ? [] : [wait.target])),
        ],
      }))
    })

  /** Runs a read of a host and notes what it cost: what the host counted where it can say, else one request. */
  const measured = <A>(place: Place, now: number, read: Effect.Effect<A, ConnectorFailed>) =>
    Effect.gen(function* () {
      const before = place.host.allowance?.()?.counted
      const result = yield* Effect.exit(read)
      const after = place.host.allowance?.()?.counted
      spending.spend(place.connectionId, before === undefined || after === undefined ? 1 : after - before, now)
      return yield* result
    })

  const repositoryOf = (place: Place, now: number) =>
    Effect.gen(function* () {
      const key = `${place.connectionId}|${place.path.join('/')}`
      const kept = repositories.get(key)
      if (kept !== undefined && now - kept.at < Duration.toMillis(REPOSITORY_KEPT)) return kept.repository
      const repository = yield* measured(place, now, place.host.repository(place.path))
      repositories.set(key, { at: now, repository })
      return repository
    })

  /** A row changed, with what it brings the coordinator as news, and the errands that wait on it told. */
  const update = (
    row: Row,
    set: Readonly<Record<string, unknown>>,
    place: Place,
    said: FollowedNews | null,
    errands: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const at = yield* timestamp
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('followed_pulls', row.id, { ...set, updatedAt: at })
          if (said !== null)
            yield* fact({
              projectId: row.projectId as never,
              aggregateType: 'followed_pull',
              aggregateId: row.id,
              revision,
              type: 'followed_pull.news',
              payload: {
                ...said,
                name: `${place.host.words.short} ${place.host.words.prefix}${row.number}`,
                repository: row.repository,
                fromFork: row.fromFork === 1,
              },
              actorId: instance.systemId,
            })
        }),
      )
      if (said !== null) newsAt.set(row.id, yield* Clock.currentTimeMillis)
      const errandsHeard = yield* Errands
      for (const id of errands) yield* errandsHeard.news(id).pipe(Effect.catch(() => Effect.void))
    })

  /** One followed pull request read again: where it stands now, and its checks at its head. */
  const read = (row: Row, place: Place, repository: Repository, errands: ReadonlyArray<string>, awaited: boolean, now: number) =>
    Effect.gen(function* () {
      let current = row
      if (awaited) {
        // Read as a task's own: its state and head, not what the list said minutes ago.
        const seen = yield* measured(place, now, place.host.change(repository, row.number))
        const set: Record<string, unknown> = {}
        if (seen.headSha !== row.headSha) set['headSha'] = seen.headSha
        if (seen.state !== row.state) set['state'] = seen.state
        if (Object.keys(set).length > 0) {
          yield* update(
            row,
            set,
            place,
            seen.state === row.state ? null : { kind: seen.state === 'merged' ? 'merged' : 'closed' },
            seen.state === row.state ? [] : errands,
          )
          current = { ...row, headSha: seen.headSha, state: seen.state }
        }
        if (current.state !== 'open') return
      }
      const sha = current.headSha
      if (sha === null) return
      const ran: ReadonlyArray<Check> = yield* measured(place, now, place.host.checks(repository, sha)).pipe(
        // Checks it can't read are not news.
        Effect.catchIf(
          (error) => error.reason === 'forbidden' || error.reason === 'not_found',
          () => Effect.succeed([] as ReadonlyArray<Check>),
        ),
      )
      checkedAt.set(row.id, now)
      const sum = checksOf(sha, ran)
      const reading = new Date(now).toISOString()
      if (sum.outcome === 'none') {
        yield* change('followed_pulls', row.id, { checksReadAt: reading }).pipe(Effect.asVoid)
        return
      }
      if (sum.outcome === 'running') {
        // Kept as running: whatever ends it next is a result, even the one the head had before.
        if (current.checksSha !== sha || current.checksOutcome !== 'running')
          yield* update(current, { checksSha: sha, checksOutcome: 'running', checksReadAt: reading }, place, null, [])
        else yield* change('followed_pulls', row.id, { checksReadAt: reading }).pipe(Effect.asVoid)
        return
      }
      const outcome = sum.outcome
      if (current.checksSha === sha && current.checksOutcome === outcome) {
        yield* change('followed_pulls', row.id, { checksReadAt: reading }).pipe(Effect.asVoid)
        return
      }
      // Open before Althar looked, its first checks are where it begins, not news; an errand that waits on it is told all the same.
      const silent = current.baseline === 1 && current.checksOutcome === null
      yield* update(
        current,
        {
          checksSha: sha,
          checksOutcome: outcome,
          checksRevision: current.checksRevision + 1,
          checksReadAt: reading,
          baseline: 0,
          failedAt: outcome === 'failed' ? reading : null,
        },
        place,
        silent ? null : { kind: 'checks', outcome, sha },
        errands,
      )
    })

  /** A repository's open list read: pull requests that began, and ones that stopped being open, found. */
  const list = (
    projectId: string,
    place: Place,
    repository: Repository,
    now: number,
    taskUrls: ReadonlySet<string>,
    errandsFor: (row: Row) => ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const where = place.path.join('/')
      const key = `${place.connectionId}|${where}`
      const listed: ReadonlyArray<ListedChange> =
        place.host.openChanges !== undefined
          ? yield* measured(place, now, place.host.openChanges(repository))
          : (yield* measured(place, now, place.host.listChanges(repository, { state: 'open', limit: OPEN_LISTED }))).changes
      const known = yield* sql<Row>`
        SELECT id, project_id, connection_id, repository, number, url, state, head_sha, from_fork, baseline, checks_sha, checks_outcome,
          checks_revision, failed_at, checks_read_at FROM followed_pulls
        WHERE project_id = ${projectId} AND connection_id = ${place.connectionId} AND repository = ${where}`
      const first = !baselined.has(key) && known.length === 0
      const at = yield* timestamp
      const byNumber = new Map(known.map((row) => [row.number, row]))
      for (const one of listed) {
        if (one.state !== 'open' || taskUrls.has(one.url.toLowerCase())) continue
        const row = byNumber.get(one.number)
        const fromFork = one.forkOwner !== null || (one.headRepository !== undefined && one.headRepository !== null) ? 1 : 0
        if (row === undefined) {
          const id = `fpull_${randomUUID().replaceAll('-', '')}`
          yield* sql`INSERT INTO followed_pulls ${sql.insert({
            id,
            projectId,
            connectionId: place.connectionId,
            product: place.host.product,
            repository: where,
            number: one.number,
            url: one.url,
            state: 'open',
            headSha: one.headSha,
            fromFork,
            baseline: first ? 1 : 0,
            createdAt: at,
            updatedAt: at,
          })}`
          if (!first) {
            const made = { ...(yield* Effect.map(sql<Row>`SELECT * FROM followed_pulls WHERE id = ${id}`, (rows) => rows[0]!)) }
            yield* update(made, {}, place, { kind: 'opened' }, errandsFor(made))
          }
          continue
        }
        const set: Record<string, unknown> = {}
        if (row.state !== 'open') set['state'] = 'open'
        if (row.headSha !== one.headSha) set['headSha'] = one.headSha
        if (row.fromFork !== fromFork) set['fromFork'] = fromFork
        if (Object.keys(set).length > 0) yield* update(row, set, place, null, [])
      }
      baselined.add(key)
      // Open as last seen, and not on the list: merged or closed since, and the list is whole to tell it.
      if (listed.length < OPEN_LISTED) {
        const present = new Set(listed.map((one) => one.number))
        for (const row of known) {
          if (row.state !== 'open' || present.has(row.number)) continue
          const seen = yield* measured(place, now, place.host.change(repository, row.number))
          if (seen.state === 'open') continue
          yield* update(row, { state: seen.state }, place, { kind: seen.state === 'merged' ? 'merged' : 'closed' }, errandsFor(row))
        }
      }
    })

  /** Everything due for one repository now. */
  const round = (
    projectId: string,
    place: Place,
    places: ReadonlyArray<Place>,
    waited: ReadonlyArray<{ errandId: string; texts: ReadonlyArray<string> }>,
    taskUrls: ReadonlySet<string>,
    now: number,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const where = place.path.join('/')
      const key = `${place.connectionId}|${where}`
      const allowance = (): Allowance | undefined => place.host.allowance?.()
      const product = place.host.product
      const room = () => easing(allowance()) !== Infinity && spending.room(place.connectionId, product, allowance(), now) > 0
      if ((leftUntil.get(place.connectionId) ?? 0) > now || (leftUntil.get(key) ?? 0) > now || !room()) return
      const errandsFor = (row: { url: string; repository: string; number: number }) =>
        waited.filter((one) => one.texts.some((text) => namesPull(text, row))).map((one) => one.errandId)
      const startedWith = spending.spentIn(place.connectionId, now)
      const repository = yield* repositoryOf(place, now)
      const shared = places.filter((other) => other.connectionId === place.connectionId).length
      const every = listEvery({ product, allowance: allowance(), cost: costed.get(key) ?? 1, shared })
      if (now - (listedAt.get(key) ?? -Infinity) >= every) {
        listedAt.set(key, now)
        yield* list(projectId, place, repository, now, taskUrls, errandsFor)
      }
      const open = yield* sql<Row>`
        SELECT id, project_id, connection_id, repository, number, url, state, head_sha, from_fork, baseline, checks_sha, checks_outcome,
          checks_revision, failed_at, checks_read_at FROM followed_pulls
        WHERE project_id = ${projectId} AND connection_id = ${place.connectionId} AND repository = ${where} AND state = 'open'
        ORDER BY number`
      // One an errand waits on first, then the ones whose head moved or whose checks run, then the failed ones' rerun.
      const due = open
        .filter((row) => !taskUrls.has(row.url.toLowerCase()))
        .flatMap((row) => {
          const errands = errandsFor(row)
          const awaited = errands.length > 0
          const polled = checkedAt.get(row.id)
          const quiet = newsAt.get(row.id) ?? (newsAt.set(row.id, now), now)
          const rank = dueRank({
            row,
            awaitedDue: awaited ? options.due({ now, polledAt: polled, newsAt: quiet, every: options.every }) : null,
            now,
            polledAt: polled,
            every,
          })
          return rank === null ? [] : [{ row, errands, awaited, rank }]
        })
        .sort((a, b) => a.rank - b.rank)
      for (const one of due) {
        if (!room()) break
        yield* read(one.row, place, repository, one.errands, one.awaited, now)
      }
      costed.set(key, Math.max(1, spending.spentIn(place.connectionId, now) - startedWith))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const failure = cause.reasons.flatMap((reason) => (reason._tag === 'Fail' ? [reason.error] : []))[0]
          const key = `${place.connectionId}|${place.path.join('/')}`
          if (failure instanceof ConnectorFailed && failure.reason === 'rate_limited' && failure.retryAt !== undefined)
            leftUntil.set(place.connectionId, Date.parse(failure.retryAt))
          else leftUntil.set(key, now + Duration.toMillis(options.every) * 4)
          if (!(failure instanceof ConnectorFailed) || failure.reason === 'invalid_response')
            yield* Effect.logWarning('Could not follow a repository’s pull requests', cause)
        }),
      ),
    )

  /** One listening turn's share: what is due across every project not archived. */
  const tick: Effect.Effect<void, unknown, FollowStore> = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const now = yield* Clock.currentTimeMillis
    for (const project of yield* sql<{ id: string }>`SELECT id FROM projects WHERE archived_at IS NULL`) {
      const places = yield* placesFor(project.id, now)
      if (places.length === 0) continue
      const waited = yield* waitedOn(project.id)
      const tasks = yield* sql<{ url: string }>`
        SELECT url FROM external_links WHERE project_id = ${project.id} AND kind = 'change' AND listening = 1`
      const taskUrls = new Set(tasks.map((one) => one.url.toLowerCase()))
      for (const place of places) yield* round(project.id, place, places, waited, taskUrls, now)
    }
    // What isn't open any more is forgotten here.
    if (listedAt.size > 1000) listedAt.clear()
  })

  return { tick, spending }
}
