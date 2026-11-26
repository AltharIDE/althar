import { type CheckLogShown, checkFailuresIn } from '@althar/contracts'
import type {
  Account,
  ChangeRequest,
  Check,
  CodeHost,
  Comment,
  ConnectorFailed,
  Person,
  PushTarget,
  Repository,
  Review,
} from '@althar/connectors'
import { type ActorId, Ids, type ProjectId, newId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Clock, type Crypto, Duration, Effect, Option, type Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import {
  type Asked,
  COMMENTS_SHOWN,
  FIX_ROUNDS,
  type Hands,
  type LinkRow,
  RERUN_SHOWS,
  RULES_EVERY,
  type Snapshot,
  type Store,
  snapshotOf,
  refusalOf,
} from './changeRecords'
import { LOGS_TO_LEAD, logForLead, queueDetailOf, readLog } from './checkLogs'
import { RuntimeConfig } from './Config'
import type { FailedChecks } from './conflicts'
import type { Connections } from './Connections'
import { envelope } from './envelope'
import type { PushRefused } from './errors'
import { contained } from './Failures'
import type { FastLane } from './fastLane'
import { commitOf, onHead, remoteTip } from './git'
import type { Instance, InstanceInfo } from './Instance'
import { Policies, trustedBotsOf } from './Policies'
import {
  answerHint,
  botFindingsForLead,
  checksForLead,
  checksForLeadAlone,
  checksLine,
  checksOf,
  checksSpentForLead,
  commentForLead,
  commentLine,
  fromAlthar,
  gaveUpLine,
  leftQueueForLead,
  leftQueueLinked,
  leftQueueNote,
  leftQueueNoteForLead,
  leftQueueUnclaimed,
  nameOf,
  outsidersLine,
  queueOwnFailures,
  queuedNote,
  quietBotsLine,
  reviewForLead,
  reviewLine,
  sendBackHint,
  spentLine,
  standing,
  stoppedLine,
} from './pullRequestWords'
import { change, fact, timestamp } from './records'
import { reviewerBot, trusts } from './reviewerBots'
import type { Sessions } from './Sessions'
import { spanOf } from './stallWatch'
import { nowFor, nowUntil } from './standsOn'
import { addItem } from './threads'
import { summarize } from './words'

export interface ChangeListeningDependencies {
  readonly askedOf: (
    taskId: string,
    url: string,
  ) => Effect.Effect<{ id: string; projectId: ProjectId; content: Asked }[], SqlError.SqlError, SqlClient.SqlClient>
  readonly baseMoved: Effect.Effect<void>
  readonly behindAny: (path: string, commits: ReadonlyArray<string>, tips: ReadonlyArray<string>) => Effect.Effect<boolean>
  readonly bringInWaiting: (
    link: LinkRow,
    merged: Snapshot,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, Store>
  readonly checked: (
    link: LinkRow,
    url: string,
    now: ChangeRequest,
    host: CodeHost,
    repository: Repository,
    read?: ReadonlyArray<Check> | null,
  ) => Effect.Effect<boolean, unknown, Store>
  readonly checksAppear: number
  readonly connections: Connections['Service']
  readonly current: (
    taskId: string,
    url?: string,
  ) => Effect.Effect<
    {
      readonly link: LinkRow
      readonly snapshot: Snapshot
      readonly host: CodeHost
      readonly repository: Repository
      readonly account: Account
    },
    unknown,
    SqlClient.SqlClient
  >
  readonly decodeSnapshot: (input: unknown) => Effect.Effect<Snapshot, Schema.SchemaError>
  readonly fastLane: FastLane['Service']
  readonly follow: (
    taskId: string,
    event: 'opened' | 'merged',
    change: Parameters<typeof nameOf>[0] & { readonly url: string },
  ) => Effect.Effect<void>
  readonly forgetUnsent: (
    taskId: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly instance: InstanceInfo
  readonly linksOf: (taskId: string) => Effect.Effect<readonly LinkRow[], SqlError.SqlError, SqlClient.SqlClient>
  readonly lookAt: (
    link: LinkRow,
    seen: Snapshot,
    now: { readonly target: string; readonly conflicts?: boolean | null | undefined; readonly headSha: string | null },
    host: CodeHost,
    repository: Repository,
    how: { readonly force: boolean; readonly fresh: boolean; readonly sweep?: boolean },
    failed?: FailedChecks | null,
  ) => Effect.Effect<boolean, unknown, Store>
  readonly mergeNote: (taskId: string, url?: string) => Effect.Effect<{ note: string; head: string }, unknown, Store>
  readonly pushTargetOf: (
    taskId: string,
    host: CodeHost,
    repository: Repository,
    path: string,
    pull: { readonly number: number; readonly source: string; readonly head?: ReadonlyArray<string> | null | undefined },
  ) => Effect.Effect<PushTarget, ConnectorFailed | PushRefused, never>
  readonly retargetAbove: (
    link: LinkRow,
    merged: Snapshot,
  ) => Effect.Effect<
    void,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto
  >
  readonly saveSnapshot: (
    link: LinkRow,
    snapshot: Snapshot,
    set?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly scope: Scope.Scope
  readonly sentTo: (projectId: string, url: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly sessions: Sessions['Service']
  readonly settleAsked: (
    asked: { readonly id: string; readonly projectId: ProjectId; readonly content: Asked },
    state: 'pushed' | 'replaced' | 'closed',
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly settleIfDone: (
    taskId: string,
    by?: {
      readonly actorId: ActorId
      readonly here?: ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>
    },
  ) => Effect.Effect<void, unknown, Store>
  readonly stampMerged: (link: LinkRow, merged: Snapshot) => Effect.Effect<void, never, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly stuckAfter: Duration.Duration
  readonly taken: (
    taskId: string,
    how: 'stopped' | 'interrupted' | 'pushed' | 'stuck' | 'unreadable',
  ) => Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient | Crypto.Crypto>
  readonly tellUntold: (
    link: LinkRow,
    name: string,
    host: CodeHost,
    repository: Repository,
    base: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, Store>
  readonly unknownFor: Map<string, number>
  readonly waitingOn: (taskId: string, url: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly worktreeOf: (
    taskId: string,
    url: string,
  ) => Effect.Effect<
    | { id: string; path: string; branch: string; base: string; baseCommit: string | null; threadId: string; heldAt: string | null }
    | undefined,
    unknown,
    Store
  >
}

export const makeChangeListening = (dependencies: ChangeListeningDependencies) =>
  Effect.gen(function* () {
    const {
      askedOf,
      baseMoved,
      behindAny,
      bringInWaiting,
      checksAppear,
      connections,
      current,
      decodeSnapshot,
      fastLane,
      follow,
      instance,
      linksOf,
      mergeNote,
      pushTargetOf,
      retargetAbove,
      saveSnapshot,
      scope,
      sentTo,
      sessions,
      settleAsked,
      stampMerged,
      stuckAfter,
      unknownFor,
      waitingOn,
      worktreeOf,
    } = dependencies

    /** The ids of the replies Althar posted on a change, from their receipts. */
    const repliesOf = (linkId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string | number | null }>`
            SELECT json_extract(m.response, '$.id') AS id FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
            WHERE w.subject_type = 'external_link' AND w.subject_id = ${linkId} AND m.operation = 'reply' AND m.response IS NOT NULL`
        return new Set(rows.flatMap((row) => (row.id === null ? [] : [String(row.id)])))
      })

    /**
     * Who said something on a change, for who hears it: Althar, in a
     * reply it posted (by its receipt, or, when that was lost, its
     * signature on the account's own comment); a bot; the person, whose
     * account the connection is; one of the repository's people; or anyone
     * else, as on a public repository.
     */
    const voiceOf = (
      said: { readonly id: string; readonly author: Person; readonly member: boolean; readonly body: string },
      account: Account,
      replies: ReadonlySet<string>,
    ): 'althar' | 'bot' | 'person' | 'member' | 'outsider' => {
      const mine = said.author.id === account.id
      if (replies.has(said.id) || (mine && fromAlthar(said.body))) return 'althar'
      if (said.author.bot) return 'bot'
      if (mine) return 'person'
      return said.member ? 'member' : 'outsider'
    }

    /** A pull request by its repository and number, as the lead names one among several: web#3. */
    const shortNameOf = (snapshot: Snapshot) => `${snapshot.repository.at(-1) ?? ''}${snapshot.words.prefix}${snapshot.number}`

    /**
     * Each of the task's pull requests, read as `readOne` reads one, one
     * after another: one that can't be read says why on its own, in the
     * words the tool would have for it, and the rest are read.
     */
    const read = (taskId: string) =>
      Effect.gen(function* () {
        const urls = yield* urlsOf(taskId)
        if (urls.length <= 1) return yield* readOne(taskId)
        return (yield* Effect.forEach(urls, (seen) =>
          readOne(taskId, seen.url).pipe(
            Effect.catch((error) => {
              const refused = refusalOf(error)
              return refused === undefined ? Effect.fail(error) : Effect.succeed(unread(refused))
            }),
            contained('Changes.read', (cause) => unread(summarize(cause))),
            Effect.map((read) => `${shortNameOf(seen)}: ${read}`),
          ),
        )).join('\n\n')
      })

    /** A pull request the lead's read couldn't, with why. */
    const unread = (why: string) => `Althar couldn’t read it (${why.replace(/\.$/, '')}).`

    /** The task's pull requests as last seen, oldest first. */
    const urlsOf = (taskId: string) =>
      Effect.flatMap(linksOf(taskId), (links) =>
        Effect.forEach(links, (link) =>
          Effect.map(Effect.option(decodeSnapshot(link.snapshot)), (seen) => (Option.isSome(seen) ? [seen.value] : [])),
        ),
      ).pipe(Effect.map((seen) => seen.flat()))

    const readOne = (taskId: string, url?: string) =>
      Effect.gen(function* () {
        const { link, snapshot, host, repository, account } = yield* current(taskId, url)
        const now = yield* host.change(repository, snapshot.number, { queue: true })
        const lines: Array<string> = [`${nameOf(snapshot)}, "${now.title}" (${standing(now)}): ${now.url}`]
        if (now.queueError != null) lines.push(now.queueError)
        if (now.headSha !== null) {
          const checks = yield* host.checks(repository, now.headSha)
          const sum = checksOf(now.headSha, checks)
          lines.push(checksLine(sum))
          for (const check of checks.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD))
            lines.push(logForLead(yield* readLog(host, repository, check)))
        }
        if (now.queued === true)
          lines.push(
            `In the merge queue${now.queueSha === null || now.queueSha === undefined ? '' : ` (build ${String(now.queueSha).slice(0, 7)})`}. Read its build with read_checks (queue: true).`,
          )
        else if (now.leftQueue === 'checks') {
          // The sendback as it failed: its jobs, their log tails, and the default branch on the same jobs.
          lines.push(leftQueueForLead(nameOf(snapshot), 'checks', yield* queueDetailOf(host, repository, now.queueSha, now.queueError)))
        }
        const activity = yield* host.activity(repository, snapshot.number, null)
        const replies = yield* repliesOf(link.id)
        const trusted = trustedBotsOf((yield* (yield* Policies).current(link.projectId)).rules)
        // What anyone else said isn't read to the lead: on a public repository, anyone can comment. Nor what a bot the project
        // doesn't trust said; a trusted one's words are its findings, named by it and framed as data (code-hosts § Review and triage bots).
        const quiet = new Set<string>()
        let otherBots = 0
        const heardBots = new Map<string, { readonly name: string; readonly said: Array<Comment | Review> }>()
        const sorted = (said: Comment | Review, voice: ReturnType<typeof voiceOf>): 'say' | 'bot' | 'out' => {
          if (voice === 'outsider') return 'out'
          if (voice !== 'bot') return 'say'
          const recognised = reviewerBot(said.author.login)
          if (!trusts(trusted, said.author.login)) {
            if (recognised === null) otherBots += 1
            else quiet.add(recognised.name)
            return 'bot'
          }
          const name = recognised?.name ?? said.author.login
          const heard = heardBots.get(said.author.login) ?? { name, said: [] }
          heard.said.push(said)
          heardBots.set(said.author.login, heard)
          return 'bot'
        }
        const reviews = activity.reviews.filter((review) => sorted(review, voiceOf(review, account, replies)) === 'say')
        let outsiders = activity.reviews.filter((review) => voiceOf(review, account, replies) === 'outsider').length
        const comments = activity.comments.flatMap((comment) => {
          const voice = voiceOf(comment, account, replies)
          const where = sorted(comment, voice)
          if (where === 'out') outsiders += 1
          if (where !== 'say') return []
          return [{ at: comment.at, text: commentLine(comment, voice === 'althar' ? 'you, through Althar' : undefined) }]
        })
        const said = [...reviews.map((review) => ({ at: review.at, text: reviewLine(review) })), ...comments]
          .toSorted((a, b) => (a.at < b.at ? -1 : 1))
          .slice(-COMMENTS_SHOWN)
        lines.push(
          said.length === 0
            ? 'Nobody has said anything on it.'
            : `What people said, oldest first:\n${said.map((entry) => entry.text).join('\n')}`,
        )
        for (const bot of heardBots.values())
          lines.push(
            botFindingsForLead(bot.name, nameOf(snapshot), bot.said.toSorted((a, b) => (a.at < b.at ? -1 : 1)).slice(-COMMENTS_SHOWN)),
          )
        if (outsiders > 0) lines.push(outsidersLine(outsiders))
        if (quiet.size > 0 || otherBots > 0) lines.push(quietBotsLine([...quiet], otherBots))
        return lines.join('\n\n')
      })

    /** Records something heard once; whether it was new. */
    const heard = (link: LinkRow, kind: string, id: string, payload: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
              id: yield* newId(Ids.observation),
              projectId: link.projectId,
              subjectType: 'external_link',
              subjectId: link.id,
              kind,
              payload: JSON.stringify({ ...payload, id }),
              source: link.product,
              observedAt: yield* timestamp,
            })}`
            const [inserted] = yield* sql<{ n: number }>`SELECT changes() AS n`
            const fresh = (inserted?.n ?? 0) > 0
            if (fresh && ['checks', 'checks_handed', 'review', 'queue_left', 'merged', 'closed'].includes(kind)) {
              const revision = yield* change('external_links', link.id, { updatedAt: yield* timestamp })
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: 'external_link.news',
                payload: { kind, ...payload },
                actorId: instance.systemId,
              })
            }
            return fresh
          }),
        )
      })

    /** An arrival in the task's thread. */
    const arrive = (link: LinkRow, content: Readonly<Record<string, unknown>>) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
        if (thread !== undefined)
          yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'arrival', { source: link.product, ...content })
      })

    /** Tells the task's lead, if one is running, what it should hear. */
    /**
     * Whether the task's change is in Althar's hands (ADR-040): its plan's
     * run ended well and opened its pull requests, one is open, and the
     * person hasn't opened the task since. Then Althar sees its checks
     * through: the change is under way while they run, a failure goes to its
     * lead, started again where it must be, and the lead's fix goes up
     * without asking, for `FIX_ROUNDS` fixes. Checks a
     * pull request hasn't shown yet, within `checksAppear` of the work
     * coming back, count as running where the repository's pull requests
     * have had checks before: a host registers them after a push.
     */
    const handsOf = (taskId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ outcome: string | null; endedAt: string; pushedAt: string | null; failed: number; hasChecks: number }>`
            SELECT
              -- What the checks of its head say: those of a head before it, which a push has left behind, say nothing.
              CASE WHEN json_extract(l.snapshot, '$.checks.sha') = json_extract(l.snapshot, '$.headSha')
                THEN json_extract(l.snapshot, '$.checks.outcome') END AS outcome,
              r.ended_at,
              -- When Althar last pushed to it: its checks may take a moment to show after that too.
              (SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link' AND p.subject_id = l.id
                AND p.kind = 'pushed') AS pushed_at,
              -- Whether the repository's pull requests, this one included, have had checks before: one with none never will, and isn't
              -- kept waiting.
              EXISTS (SELECT 1 FROM external_links e JOIN observations c ON c.subject_type = 'external_link' AND c.subject_id = e.id
                AND c.kind = 'checks' WHERE e.project_id = l.project_id AND e.kind = 'change'
                AND json_extract(e.snapshot, '$.repository') = json_extract(l.snapshot, '$.repository')) AS has_checks,
              -- By commit: one run again after it failed is still one failure. A fix that brought them green starts the count again,
              -- as fixesOf counts it.
              (SELECT count(DISTINCT json_extract(o.payload, '$.sha')) FROM observations o WHERE o.subject_type = 'external_link'
                AND o.subject_id = l.id AND o.kind = 'checks' AND json_extract(o.payload, '$.outcome') = 'failed'
                AND coalesce(json_extract(o.payload, '$.failed'), 1) > 0
                AND o.observed_at >= max(r.ended_at, coalesce((SELECT max(p.observed_at) FROM observations p
                  WHERE p.subject_type = 'external_link' AND p.subject_id = l.id AND p.kind = 'checks'
                  AND json_extract(p.payload, '$.outcome') = 'passed'), ''))) AS failed
            FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
            -- The run whose end it came back from: its plan's, or, for a next pull request, the Ship that opened it (created before it).
            JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id AND (plan_id IS NOT NULL OR created_at <= l.created_at)
              ORDER BY created_at DESC, rowid DESC LIMIT 1)
            WHERE k.id = ${taskId} AND k.state = 'open' AND r.state = 'succeeded'
              AND r.ended_at IS NOT NULL AND (k.seen_at IS NULL OR k.seen_at < r.ended_at)
              AND json_extract(l.snapshot, '$.state') = 'open' AND l.listening = 1
              -- Nor once the person has said anything on the task since, or stopped its lead: it is theirs.
              AND NOT EXISTS (SELECT 1 FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id JOIN threads h ON h.id = i.thread_id
                WHERE h.task_id = k.id AND a.kind = 'person' AND i.accepted_at >= r.ended_at)
              AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.subject_type = 'external_link' AND o.subject_id = l.id
                AND o.kind = 'taken' AND o.observed_at >= r.ended_at)`
        if (rows.length === 0) return null
        // A card kept from this is worked out again once its checks have had their moment to show (standsOn.ts).
        const now = yield* nowUntil(
          ...rows.map((row) => Math.max(Date.parse(row.endedAt), row.pushedAt === null ? 0 : Date.parse(row.pushedAt)) + checksAppear),
        )
        const failed = Math.max(...rows.map((row) => row.failed))
        const running = rows.some(
          (row) =>
            row.outcome === 'running' ||
            ((row.outcome === null || row.outcome === 'none') &&
              row.hasChecks === 1 &&
              now - Math.max(Date.parse(row.endedAt), row.pushedAt === null ? 0 : Date.parse(row.pushedAt)) < checksAppear),
        )
        return { failed, running, given: failed > FIX_ROUNDS } satisfies Hands
      })

    /**
     * Where the checks that failed on each of a task's open pull requests
     * stand, whether or not the person has looked (ADR-070), read from the
     * record each time. A run of failures counts, by commit, from the end of
     * its plan's run, the person's last push, or the checks last passing,
     * whichever came last. It is its lead's to see through (`open`) while it
     * has tries left, unless its lead brought the latest failure to the
     * person, or the person stopped or interrupted it since that commit's
     * checks were first seen (or they ran too long, or couldn't be read):
     * that failure doesn't wake it again, one on a new commit does. A
     * settled task's are no one's, nor those of a pull request Althar no
     * longer follows, as one an attached pull request replaced.
     */
    const fixesOf = (taskId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const links = yield* sql<{
          id: string
          snapshot: string
          endedAt: string | null
          pushedAt: string | null
          hasChecks: number
          spokenAt: string | null
        }>`
            SELECT l.id, l.snapshot,
              (SELECT ended_at FROM runs WHERE task_id = k.id AND (plan_id IS NOT NULL OR created_at <= l.created_at)
                ORDER BY created_at DESC, rowid DESC LIMIT 1) AS ended_at,
              (SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link' AND p.subject_id = l.id
                AND p.kind = 'pushed') AS pushed_at,
              EXISTS (SELECT 1 FROM external_links e JOIN observations c ON c.subject_type = 'external_link' AND c.subject_id = e.id
                AND c.kind = 'checks' WHERE e.project_id = l.project_id AND e.kind = 'change'
                AND json_extract(e.snapshot, '$.repository') = json_extract(l.snapshot, '$.repository')) AS has_checks,
              (SELECT max(i.accepted_at) FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id JOIN threads h ON h.id = i.thread_id
                WHERE h.task_id = k.id AND a.kind = 'person') AS spoken_at
            FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
            WHERE k.id = ${taskId} AND k.state = 'open' AND json_extract(l.snapshot, '$.state') = 'open' AND l.listening = 1`
        // A card kept from this is worked out again once each one's checks have had their moment to show (standsOn.ts).
        const now = yield* nowUntil(
          ...links.map(
            (link) =>
              Math.max(link.endedAt === null ? 0 : Date.parse(link.endedAt), link.pushedAt === null ? 0 : Date.parse(link.pushedAt)) +
              checksAppear,
          ),
        )
        return yield* Effect.forEach(links, (link) =>
          Effect.gen(function* () {
            const snapshot = yield* decodeSnapshot(link.snapshot)
            const said = yield* sql<{
              kind: string
              at: string
              sha: string | null
              outcome: string | null
              failed: number | null
              how: string | null
              why: string | null
              ref: string | null
            }>`
                SELECT kind, observed_at AS at, json_extract(payload, '$.sha') AS sha, json_extract(payload, '$.outcome') AS outcome,
                  json_extract(payload, '$.failed') AS failed,
                  json_extract(payload, '$.how') AS how, json_extract(payload, '$.why') AS why, json_extract(payload, '$.id') AS ref
                FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
                  AND kind IN ('checks', 'checks_running', 'taken', 'checks_handed', 'pushed', 'checks_stuck', 'checks_unreadable')
                ORDER BY observed_at, rowid`
            const head = snapshot.headSha
            const outcome = snapshot.checks !== null && snapshot.checks.sha === head ? snapshot.checks.outcome : null
            const start = said
              .filter((one) => (one.kind === 'taken' && one.how === 'pushed') || (one.kind === 'checks' && one.outcome === 'passed'))
              .reduce((latest, one) => (one.at > latest ? one.at : latest), link.endedAt ?? '')
            // Each commit's checks, when they first failed; those that failed since the count started.
            const first = new Map<string, string>()
            const counted = new Set<string>()
            for (const one of said)
              if (one.kind === 'checks' && one.outcome === 'failed' && (one.failed ?? 1) > 0 && one.sha !== null) {
                if (!first.has(one.sha)) first.set(one.sha, one.at)
                if (one.at >= start) counted.add(one.sha)
              }
            const latest = [...counted].reduce<string | null>(
              (last, sha) => (last === null || (first.get(sha) ?? '') > (first.get(last) ?? '') ? sha : last),
              null,
            )
            // Stopped by the person once Althar pushed that commit, or its checks were under way, as while a conflict round's ran: its
            // failure is theirs. From the push: a stop before Althar first looks at the commit's checks is after the commit all the same.
            const since =
              latest === null ? null : (said.find((one) => one.kind !== 'taken' && one.sha === latest)?.at ?? first.get(latest) ?? null)
            const takenSince =
              since === null ? undefined : said.findLast((one) => one.kind === 'taken' && one.how !== 'pushed' && one.at >= since)
            const stopped = takenSince !== undefined
            const handedOf = (sha: string | null) => said.findLast((one) => one.kind === 'checks_handed' && one.sha === sha)
            const failed = counted.size
            const given = failed > FIX_ROUNDS
            const open = latest !== null && !given && !stopped && handedOf(latest) === undefined
            const appearing =
              (outcome === null || outcome === 'none') &&
              link.hasChecks === 1 &&
              now - Math.max(link.endedAt === null ? 0 : Date.parse(link.endedAt), link.pushedAt === null ? 0 : Date.parse(link.pushedAt)) <
                checksAppear
            const failing = outcome === 'failed' && (snapshot.checks?.failed ?? 0) > 0
            // Failing on its head and its lead's, but its lead doesn't have the message that they failed (`toldSince`): a look at the
            // pull request that ended before it told the lead, or a message waiting for a lead that never started. Nobody is on
            // them; the next look tells the lead, or hands them to the person (`tellUntold`).
            const failedAt = failing
              ? said.findLast((one) => one.kind === 'checks' && one.outcome === 'failed' && one.sha === head)?.at
              : undefined
            const unreached = open && failedAt !== undefined && !(yield* toldSince(link.id, failedAt))
            // On the card, once the look that heard them has had its moment to tell the lead: never the person's between.
            const untold =
              unreached && failedAt !== undefined && (yield* nowFor(failedAt, TELLS_WITHIN)) - Date.parse(failedAt) >= TELLS_WITHIN
            // Whether the person said anything on the task since its head's checks were first seen: what the lead commits may be for
            // that, and waits for their push.
            const seenAt = head === null ? undefined : said.find((one) => one.kind !== 'pushed' && one.sha === head)?.at
            const spoken = link.spokenAt !== null && (seenAt === undefined || link.spokenAt >= seenAt)
            const handed = handedOf(head)
            // Whether checks that fail on its head now go to its lead once they end: tries left, not brought to the person, nor
            // taken from Althar's hands since that commit was first seen.
            const headAt = head === null ? undefined : said.find((one) => one.kind !== 'taken' && one.sha === head)?.at
            const takenOnHead = headAt !== undefined && said.some((one) => one.kind === 'taken' && one.how !== 'pushed' && one.at >= headAt)
            const goes = head !== null && !given && handed === undefined && !takenOnHead
            // Althar gave up on its head's checks, as running too long or unreadable, and they were in its hands then: theirs, and
            // the card says why, failed or not, unless they passed since.
            const gaveUp =
              head === null || outcome === 'passed'
                ? undefined
                : said.findLast(
                    (one) =>
                      (one.kind === 'checks_stuck' && one.ref === `stuck:${head}`) ||
                      (one.kind === 'checks_unreadable' && one.ref === `unreadable:${head}`),
                  )
            const gaveUpHow =
              gaveUp === undefined
                ? undefined
                : said.find((one) => one.kind === 'taken' && (one.how === 'stuck' || one.how === 'unreadable') && one.at >= gaveUp.at)?.how
            return {
              linkId: link.id,
              failed,
              given,
              open,
              stopped,
              failing,
              spoken,
              untold,
              unreached,
              running: open && (outcome === 'running' || appearing),
              goes,
              why: !failing
                ? gaveUpHow == null
                  ? null
                  : gaveUpLine(gaveUpHow)
                : handed !== undefined
                  ? handed.why
                  : given && latest === head
                    ? spentLine(snapshot.checks?.failing ?? [], FIX_ROUNDS)
                    : // Stopped by the person since they failed: theirs, and the card says so rather than only that they fail.
                      stopped && latest === head
                      ? stoppedLine(snapshot.checks?.failing ?? [], takenSince?.how ?? 'stopped')
                      : null,
            }
          }),
        )
      })

    /**
     * How long the look that heard checks fail has to tell the lead, or run them again, before the card says nobody is on them
     * (`untold`): it reads their logs and asks the host first.
     */
    const TELLS_WITHIN = Duration.toMillis((yield* RuntimeConfig).checksTold ?? Duration.minutes(1))

    /**
     * Whether its lead has the message that the checks on this pull request failed, sent since `since`: taken up by a turn, or
     * waiting for the session that is running. Not anything else said on the thread, nor a message waiting for a lead whose
     * session never started.
     */
    const toldSince = (linkId: string, since: string) =>
      Effect.gen(function* () {
        const rows = yield* checksSent(linkId, since)
        if (rows.some((row) => row.state === 'delivered')) return true
        const queued = rows.find((row) => row.state === 'queued')
        return queued !== undefined && Option.isSome(yield* sessions.running(queued.threadId))
      })

    /** The messages that told a task's lead the checks on this pull request failed, since `since` (`tellLead`), and where each is. */
    const checksSent = (linkId: string, since = '') =>
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ id: string; threadId: string; projectId: string; state: string }>`
            SELECT i.id, i.thread_id, i.project_id, i.state FROM observations o JOIN user_inputs i ON i.id = json_extract(o.payload, '$.inputId')
            WHERE o.subject_type = 'external_link' AND o.subject_id = ${linkId} AND o.kind = 'checks_sent' AND o.observed_at >= ${since}
            ORDER BY o.observed_at`,
      )

    /**
     * Checks handed to the person are theirs: a message that told the lead to fix them, waiting still for its next turn, is
     * withdrawn, so a lead started later for something else doesn't take it up and push a fix of its own.
     */
    const withdrawChecks = (linkId: string) =>
      Effect.gen(function* () {
        for (const one of yield* checksSent(linkId)) {
          if (one.state !== 'queued' && one.state !== 'noted') continue
          const revision = yield* change('user_inputs', one.id, { state: 'withdrawn' })
          yield* fact({
            projectId: one.projectId as ProjectId,
            aggregateType: 'user_input',
            aggregateId: one.id,
            revision,
            type: 'user_input.withdrawn',
            actorId: instance.systemId,
          })
        }
      })

    /** Where the checks that failed on one of a task's pull requests stand (`fixesOf`): null where it isn't open, or its task settled. */
    const fixingOn = (link: LinkRow) => Effect.map(fixesOf(link.taskId), (all) => all.find((one) => one.linkId === link.id) ?? null)

    /**
     * A quiet line in the task's thread, in the person's words: its detail in the notice's description where it has one, and
     * what it is built on folded under it (a host's raw answer, failed checks' logs), with the words it links.
     */
    const sayOn = (
      link: LinkRow,
      title: string,
      description?: string,
      more: {
        readonly details?: string | undefined
        readonly links?: ReadonlyArray<{ readonly label: string; readonly url: string; readonly at?: number }>
        readonly logs?: ReadonlyArray<CheckLogShown>
      } = {},
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
        if (thread !== undefined)
          yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title,
            ...(description === undefined ? {} : { description }),
            ...(more.details === undefined ? {} : { details: more.details }),
            ...(more.links === undefined || more.links.length === 0 ? {} : { links: more.links }),
            ...(more.logs === undefined || more.logs.length === 0 ? {} : { logs: more.logs }),
          })
      })

    /**
     * Whether a conflict round is under way on the task, or on one of its pull requests where `url` says which: resolving, or
     * seeing the checks on what it pushed through.
     */
    const roundUnderWay = (taskId: string, url?: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [row] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM conflict_resolutions WHERE task_id = ${taskId} AND state IN ('resolving', 'checking')
              AND (${url ?? null} IS NULL OR pull_request_url = ${url ?? null}) LIMIT 1`
        return row !== undefined
      })

    /**
     * Whether the checks on this commit ran again after they failed (ADR-041),
     * the latest time: Althar's own once, `rerun:<sha>`, and each the lead
     * asked for after, `rerun:<sha>:<n>`.
     */
    const ranAgain = (link: LinkRow, sha: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [row] = yield* sql<{ at: string; id: string }>`
            SELECT observed_at AS at, json_extract(payload, '$.id') AS id FROM observations
            WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun' AND json_extract(payload, '$.sha') = ${sha}
            ORDER BY observed_at DESC, rowid DESC LIMIT 1`
        if (row === undefined) return null
        // Its run again is under way once the host has shown it running; a failure before that is the old one, still showing.
        const startedId = row.id.replace(/^rerun:/, 'rerun-started:')
        const [started] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun_started' AND json_extract(payload, '$.id') = ${startedId} LIMIT 1`
        // How its outcome is heard: Althar's own as it always was, each of the lead's apart.
        return { at: row.at, started: started !== undefined, startedId, again: row.id === `rerun:${sha}` ? ':again' : `:${row.id}` }
      })

    /** Keeps that the lead ran checks on this commit again: its outcome is heard afresh, as Althar's own rerun's is. */
    const leadRanAgain = (link: LinkRow, sha: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [count] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun' AND json_extract(payload, '$.sha') = ${sha}`
        yield* heard(link, 'checks_rerun', `rerun:${sha}:${(count?.n ?? 0) + 1}`, { sha, by: 'lead' })
      })

    /**
     * Checks that have run on a commit longer than STUCK_AFTER, while the
     * change is in Althar's hands, make it the person's: the thread says
     * how long, once (ADR-041).
     */
    const stuckOn = (link: LinkRow, name: string, sha: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [since] = yield* sql<{ at: string }>`
            SELECT observed_at AS at FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_running' AND json_extract(payload, '$.id') = ${`running:${sha}`} LIMIT 1`
        if (since === undefined) return
        const ran = (yield* Clock.currentTimeMillis) - Date.parse(since.at)
        if (ran < Duration.toMillis(stuckAfter)) return
        const hands = yield* handsOf(link.taskId)
        // The checks on a lead's fix too, after the person has looked (ADR-070).
        const fixing = yield* fixingOn(link)
        if ((hands === null || hands.given) && fixing?.running !== true) return
        if (!(yield* heard(link, 'checks_stuck', `stuck:${sha}`, { sha }))) return
        yield* dependencies.taken(link.taskId, 'stuck')
        yield* sayOn(link, `The checks on ${name} are still running after ${spanOf(ran)}.`)
      })

    /** Whether its plan or Ship still owns publication: a person's overlapping turn cannot push ahead of its review. */
    const publishing = (taskId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [run] = yield* sql<{ state: string }>`
            SELECT state FROM runs WHERE task_id = ${taskId} AND (plan_id IS NOT NULL OR json_type(parameters, '$.ships') = 'object') ORDER BY created_at DESC, rowid DESC LIMIT 1`
        return run?.state === 'running'
      })

    /**
     * Whether how the task's checks end waits for its run, as while its plan still publishes (`publishing`): not for a Ship
     * at its merge stop, which is up and waits on those very checks, so its card shows them as they go.
     */
    const checksWait = (taskId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [run] = yield* sql<{ state: string; at: string | null }>`
            SELECT state, json_extract(parameters, '$.ships.at') AS at FROM runs
            WHERE task_id = ${taskId} AND (plan_id IS NOT NULL OR json_type(parameters, '$.ships') = 'object')
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
        return run?.state === 'running' && run.at !== 'merge'
      })

    /** Says in the task's thread that its checks still failed after FIX_ROUNDS fixes while Althar saw them through: the change is the person's now. */
    const gaveUp = (link: LinkRow, name: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
        if (thread === undefined) return
        yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'notice', {
          source: 'runtime',
          severity: 'warning',
          title: `The checks on ${name} still fail after ${FIX_ROUNDS} fixes.`,
        })
      })

    /**
     * Tells the task's lead, quietly, when it has a session; with `wake`,
     * one that has none is started again for it, on the agent it was last
     * on (ADR-040). What needs nothing of it now (`note`) starts no turn,
     * and waits for no place among the agents at work: its lead reads it
     * with its next turn. So is all of it for a task merged or settled, or
     * a pull request merged or closed: nothing Althar says starts its lead.
     */
    const tellLead = (link: LinkRow, parts: ReadonlyArray<string>, wake = false, how: 'turn' | 'note' = 'turn') =>
      Effect.gen(function* () {
        if (parts.length === 0) return true
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ id: string; state: string }>`
            SELECT t.id, k.state FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.task_id = ${link.taskId} AND t.kind = 'task'`
        if (thread === undefined || !['open', 'done'].includes(thread.state)) return false
        const seen = Option.getOrUndefined(yield* Effect.option(decodeSnapshot(link.snapshot)))
        const note = how === 'note' || thread.state === 'done' || seen?.state === 'merged' || seen?.state === 'closed'
        const running = Option.isSome(yield* sessions.running(thread.id))
        // A note is kept whatever: the lead reads it with its next turn, in this session or the next.
        if (!running && !wake && !note) return false
        const sent = yield* sessions.send({
          envelope: yield* envelope('thread.send', { threadId: thread.id, heard: link.id }, undefined, instance.systemId),
          threadId: thread.id,
          body: parts.join('\n\n'),
          quiet: true,
          note,
        })
        // Which message told it this pull request's checks failed, by this link, not its words: another repository's pull
        // request can have the same number (`toldSince`), and a hand-off withdraws it (`withdrawChecks`).
        if (parts.some((part) => part.startsWith('Checks failed')))
          yield* heard(link, 'checks_sent', `sent:${sent.inputId}`, { inputId: sent.inputId })
        // Whether its lead takes it: one with no session to start again from doesn't.
        return running || note || (yield* sessions.startLast(thread.id))
      })

    /**
     * Someone else pushed to the pull request, such as with the host's
     * "Update branch": its head is neither what Althar last pushed nor on
     * the task's branch, so the two have parted and a plain push would be
     * refused. Its lead is told once a head to merge it in (`mergeNote`),
     * started again if it must be, rather than leaving it to the person
     * (DEV-173). Not while a conflict round is under way: the round brings
     * the branches together itself.
     */
    const bringTogether = (link: LinkRow, head: string | null, url: string) =>
      Effect.gen(function* () {
        // Only a commit, as the card tells one moved: a head that is none can't be fetched to merge.
        if (head === null || !/^[0-9a-f]{40,64}$/.test(head) || head === (yield* sentTo(link.projectId, url))) return
        const workspace = yield* worktreeOf(link.taskId, url)
        if (workspace === undefined || (yield* onHead(workspace.path, head)) || (yield* roundUnderWay(link.taskId))) return
        const sql = yield* SqlClient.SqlClient
        const [told] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'parted' AND json_extract(payload, '$.sha') = ${head} LIMIT 1`
        if (told !== undefined) return
        // Fetched first, so the lead has the commits to merge; a fetch that fails is tried again on the next turn.
        const { note } = yield* mergeNote(link.taskId, url)
        if (yield* heard(link, 'parted', `parted:${head}`, { sha: head })) yield* tellLead(link, [note], true)
      })

    /**
     * A pull request's head as its host says, unless the host hasn't read
     * Althar's last push to it yet: for a moment after a push, GitHub still
     * answers with the head before, behind what was pushed. Where the
     * remote's branch is on what was pushed, that is its head; where it
     * isn't, someone moved it back, and the host is right.
     */
    const caughtUp = (link: LinkRow, read: ChangeRequest, host: CodeHost, repository: Repository) =>
      Effect.gen(function* () {
        const said = read.headSha
        const onto = read.source
        if (said === null || read.state !== 'open') return said
        const sent = yield* sentTo(link.projectId, read.url)
        if (sent === null || sent === said) return said
        const workspace = yield* worktreeOf(link.taskId, read.url)
        if (workspace === undefined || !(yield* behindAny(workspace.path, [said], [sent]))) return said
        const target = yield* pushTargetOf(link.taskId, host, repository, workspace.path, {
          number: read.number,
          source: onto,
          head: read.headRepository,
        })
        return (yield* remoteTip(workspace.path, target, onto)) === sent ? sent : said
      }).pipe(Effect.orElseSucceed(() => read.headSha))

    /**
     * What merging an open pull request needs on its host (DEV-204), where
     * it is due: never read, its head moved, something happened on it, or
     * `RULES_EVERY` since. Kept as it was where it isn't due, or its host
     * couldn't say now; none for one that isn't open, or a host that can't.
     */
    const rulesOf = (host: CodeHost, repository: Repository, before: Snapshot, now: ChangeRequest, happened: boolean) =>
      Effect.gen(function* () {
        if (now.state !== 'open' || host.mergeRules === undefined) return undefined
        const at = yield* Clock.currentTimeMillis
        const kept = before.rules
        const due = kept === undefined || happened || kept.sha !== now.headSha || at - Date.parse(kept.at) >= Duration.toMillis(RULES_EVERY)
        if (!due) return kept
        return yield* host.mergeRules(repository, now).pipe(
          Effect.map((read) => ({ ...read, sha: now.headSha, at: new Date(at).toISOString() })),
          Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what merging the pull request needs', cause), kept)),
        )
      })

    /**
     * One turn of listening to a change: its state, its finished checks, and
     * what was said since the cursor. Whether anything happened on it, so
     * a quiet one is asked less often.
     */
    const poll = (asked: LinkRow, how: { readonly force: boolean; readonly fresh: boolean } = { force: false, fresh: false }) =>
      Effect.gen(function* () {
        // As kept now, not as when it was asked for: a poll that waited on the task's lock behind a merge, or another poll, starts
        // from what they saved, so a host's read that lags behind its merge doesn't open it again.
        const link = (yield* linksOf(asked.taskId)).find((candidate) => candidate.id === asked.id) ?? asked
        if (link.connectionId === null) return false
        // Read and acted on whole while its connection is there, or not at all: a removal waits for it, and none reads after one
        // began. Nothing read through a connection being removed is half heard, so a connection made again hears it anew.
        const polled = yield* connections.whileThere(link.connectionId, pollThrough(link, link.connectionId, how))
        return Option.getOrElse(polled, () => false)
      })

    /** One look at a pull request through its connection, held by `poll` against the connection's removal. */
    const pollThrough = (link: LinkRow, connectionId: string, how: { readonly force: boolean; readonly fresh: boolean }) =>
      Effect.gen(function* () {
        const adapters = yield* connections.adapters(connectionId)
        const host = adapters.host
        if (host === undefined) return false
        const account = adapters.info.account
        const before = yield* decodeSnapshot(link.snapshot)
        const repository: Repository = yield* host.repository(before.repository)
        // Asked about its merge queue too, where its branch has one: whether it is in it, however it got there (the host's site,
        // its command line, another tool), and why the queue took it out.
        const answer = yield* host.change(repository, before.number, { queue: true })
        // Merged, it stays so: for a moment after a merge, a host can still answer it as it was.
        const read: ChangeRequest = before.state === 'merged' ? { ...answer, state: 'merged' } : answer
        const now = { ...read, headSha: yield* caughtUp(link, read, host, repository) }
        const name = nameOf(before)
        const forLead: Array<string> = []
        let alone = false
        // Failed checks its lead is to see through alone, as just heard: asked with a conflict found now, in the one ask.
        let failedNow: FailedChecks | null = null
        let rerunning = false
        let happened = false
        let checks = before.checks
        let checksRevision = before.checksRevision ?? 0
        // While its plan still publishes, how its checks end waits: once the run has ended, they are heard as the change's,
        // and a failure goes where it should (ADR-040). A Ship waiting to merge on them hears them as they go.
        const held = now.headSha !== null && (yield* checksWait(link.taskId))
        if (held) happened = true
        // Checks the host won't show Althar don't stop it hearing the rest: the thread says so, once a commit, and a change in
        // Althar's hands is the person's, since Althar can't see its checks through (ADR-041).
        const ran =
          now.headSha === null || held
            ? null
            : yield* host.checks(repository, now.headSha).pipe(
                Effect.catchIf(
                  (error) => error.reason === 'forbidden' || error.reason === 'not_found',
                  (error) =>
                    Effect.gen(function* () {
                      if (yield* heard(link, 'checks_unreadable', `unreadable:${now.headSha}`, { message: error.message })) {
                        const hands = yield* handsOf(link.taskId)
                        const theirs = (hands !== null && !hands.given) || (yield* fixingOn(link))?.open === true
                        if (theirs) yield* dependencies.taken(link.taskId, 'unreadable')
                        yield* sayOn(link, `Can't read the checks on ${name}.`)
                      }
                      return null
                    }),
                ),
              )
        if (now.headSha !== null && ran !== null) {
          const sum = checksOf(now.headSha, ran)
          // Where its host names the checks it requires, only those failing or cancelled are a failure to see through: an optional
          // one's holds nothing back, so it isn't counted, run again or handed to the lead, and the checks read as passed as far as
          // the rest go, or still running while a required one hasn't reported (#1117). As read where the host doesn't say.
          const required = sum.outcome === 'failed' ? (yield* rulesOf(host, repository, before, now, false))?.requiredChecks : undefined
          const counts = (check: string) => !Array.isArray(required) || required.includes(check)
          const counted = checkFailuresIn(sum, required)
          const own = { ...sum, outcome: counted.outcome, failed: counted.failed, failing: counted.failing }
          const finished = own.outcome === 'passed' || own.outcome === 'failed'
          // A check run again after it failed is heard again when it ends: once the host has shown it running again, or, one too
          // quick to be seen so, after RERUN_SHOWS. Until then a failure is the old one.
          const reran = yield* ranAgain(link, sum.sha)
          // Checks still running keep the pull request worth asking about; too long, while Althar sees them through, and the change is
          // the person's. Running again after a rerun, from when they show so.
          if (own.outcome === 'running') {
            happened = true
            yield* heard(link, 'checks_running', `running:${sum.sha}`, { sha: sum.sha })
            if (reran !== null && !reran.started) yield* heard(link, 'checks_rerun_started', reran.startedId, { sha: sum.sha })
            yield* stuckOn(link, name, sum.sha)
          }
          const settled =
            reran === null || reran.started || (yield* Clock.currentTimeMillis) - Date.parse(reran.at) > Duration.toMillis(RERUN_SHOWS)
          // The same head may fail on an optional check first and on a required one later, its host's outcome failed both times:
          // a change in what counts is heard too.
          const was = before.checks === null ? null : checkFailuresIn(before.checks, required)
          const transitioned =
            finished &&
            settled &&
            (before.checks?.sha !== sum.sha ||
              before.checks.outcome !== sum.outcome ||
              was?.outcome !== counted.outcome ||
              was.failing.join('\n') !== counted.failing.join('\n') ||
              was.cancelled.join('\n') !== counted.cancelled.join('\n'))
          // Advance even when this observation already exists: a previous poll may have recorded it and then failed before
          // saving its snapshot. Reusing that observation repairs the snapshot without delivering the result twice.
          if (transitioned) checksRevision += 1
          if (
            transitioned &&
            (yield* heard(link, 'checks', `checks:${sum.sha}:${own.outcome}:${checksRevision}${reran?.again ?? ''}`, {
              ...own,
              ...(counted.optional.length > 0 ? { optional: counted.optional } : {}),
            }))
          ) {
            happened = true
            // The failed checks' logs, read once: the card shows their ends, or why there are none, and the lead is told the same.
            const reads =
              sum.outcome === 'failed'
                ? yield* Effect.forEach(
                    ran.filter((candidate) => candidate.state === 'failed' && counts(candidate.name)).slice(0, LOGS_TO_LEAD),
                    (check) => readLog(host, repository, check),
                  )
                : []
            yield* arrive(link, {
              kind: 'checks',
              from: null,
              where: name,
              passed: sum.passed,
              failed: own.failed,
              failing: own.failing,
              ...(counted.optional.length > 0 ? { optional: counted.optional } : {}),
              logs: reads.map((read) => ({ name: read.name, url: read.url, log: read.log, missing: read.missing })),
              url: now.url,
            })
            // A failure its lead is to see through, whether or not the person has looked (ADR-070), is run again once before the
            // lead is told: it may have failed by chance. Not the checks on a merge a conflict round pushed: the round sees those
            // through itself. Nor where the pull request conflicts: the lead is asked for both at once, and the merge's checks run
            // anew.
            const fixing = own.failed > 0 ? yield* fixingOn(link) : null
            const failedChecks = ran.filter((candidate) => candidate.state === 'failed' && counts(candidate.name))
            const again =
              fixing?.open === true && !reran && now.conflicts !== true && !(yield* roundUnderWay(link.taskId, now.url))
                ? (yield* Effect.forEach(failedChecks, (check) =>
                    host.rerun(repository, check).pipe(Effect.orElseSucceed(() => false)),
                  )).some(Boolean)
                : false
            if (again) {
              yield* heard(link, 'checks_rerun', `rerun:${sum.sha}`, { sha: sum.sha })
              yield* sayOn(
                link,
                `Running ${own.failing.length === 1 ? 'a failed check' : `${own.failing.length} failed checks`} on ${name} again.`,
              )
              rerunning = true
            } else if (own.failed > 0) {
              const logs = reads.map(logForLead)
              // Its lead sees them through alone, whether or not the person has looked, started again if it must be, and its fix
              // goes up as it pushes (ADR-040, ADR-070). After FIX_ROUNDS fixes the change is the person's: its lead says once what
              // it tried. Stopped by the person since the failure came, it isn't told it again; else it is told, if it runs.
              if (fixing?.open === true) {
                alone = true
                // Where its branch was then: commits on it not pushed yet are the person's to push, a fix or not.
                const workspace = yield* worktreeOf(link.taskId, now.url).pipe(Effect.orElseSucceed(() => undefined))
                const branch =
                  workspace === undefined ? null : yield* commitOf(workspace.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
                yield* heard(link, 'checks_told', `told:${sum.sha}${reran?.again ?? ''}`, { sha: sum.sha, branch })
                forLead.push(checksForLeadAlone(own, name, logs, FIX_ROUNDS - fixing.failed + 1, now.target || repository.defaultBranch))
                failedNow = { failing: own.failing, logs }
              } else if (
                fixing !== null &&
                fixing.given &&
                !fixing.stopped &&
                fixing.failed === FIX_ROUNDS + 1 &&
                (yield* heard(link, 'checks_spent', `spent:${sum.sha}`, { sha: sum.sha }))
              ) {
                yield* gaveUp(link, name)
                alone = true
                forLead.push(checksSpentForLead(own, name, logs, FIX_ROUNDS))
              } else if (fixing?.stopped !== true) forLead.push(checksForLead(own, name, logs))
            } else if (reran === null && !(yield* roundUnderWay(link.taskId, now.url))) {
              // None failed but some were cancelled, which a host holds a merge on as on a failure: run again once by Althar,
              // whoever has looked, as the person would on the host (DEV-173). Cancelled again, they are the person's.
              const cancelledChecks = ran.filter((candidate) => candidate.state === 'cancelled' && counts(candidate.name))
              const ranThem =
                cancelledChecks.length > 0 &&
                (yield* Effect.forEach(cancelledChecks, (check) =>
                  host.rerun(repository, check).pipe(Effect.orElseSucceed(() => false)),
                )).some(Boolean)
              if (ranThem) {
                yield* heard(link, 'checks_rerun', `rerun:${sum.sha}`, { sha: sum.sha, cancelled: true })
                yield* sayOn(
                  link,
                  `Running ${cancelledChecks.length === 1 ? 'a cancelled check' : `${cancelledChecks.length} cancelled checks`} on ${name} again.`,
                )
                rerunning = true
              }
            }
          }
          // Run again, they are running as far as Althar knows: how they end next is heard, however soon.
          checks = rerunning || !settled ? { ...sum, outcome: 'running' } : sum
        }
        const activity = yield* host.activity(repository, before.number, link.cursor)
        const replies = activity.comments.length === 0 ? new Set<string>() : yield* repliesOf(link.id)
        const trusted = trustedBotsOf((yield* (yield* Policies).current(link.projectId)).rules)
        // What each bot the project trusts said that its lead hears, by its account, as findings framed as data (code-hosts § Review and triage bots).
        const fromBots = new Map<string, { readonly name: string; readonly said: Array<Comment | Review> }>()
        /*
         * How a bot that spoke is heard (code-hosts § Review and triage bots): trusted, its words go to the lead as findings; a review or triage agent
         * Althar recognises but the project doesn't trust stays quiet, and the thread says once, per pull request, that it
         * spoke, with a way to trust it, where it is suggested in the project's settings too; any other bot stays quiet.
         */
        const botOf = (said: Comment | Review) =>
          Effect.gen(function* () {
            const login = said.author.login.trim().toLowerCase()
            const recognised = reviewerBot(login)
            const trustedNow = trusts(trusted, login)
            const name = recognised?.name ?? said.author.login
            const first = recognised === null ? false : yield* heard(link, 'bot_spoke', `bot:${login}`, { login, name: recognised.name })
            return { login, name, trusted: trustedNow, recognised: recognised !== null, first }
          })
        const fromBot = (bot: { readonly login: string; readonly name: string }, said: Comment | Review) => {
          const heard = fromBots.get(bot.login) ?? { name: bot.name, said: [] }
          heard.said.push(said)
          fromBots.set(bot.login, heard)
        }
        // Only new words from the person, members or a trusted bot, or a queue return, wake a stopped lead.
        // Approvals, other bots, outsiders and state/check updates alone leave a merged task asleep.
        let addressed = false
        for (const review of activity.reviews) {
          const voice = voiceOf(review, account, replies)
          const bot = voice === 'bot' ? yield* botOf(review) : null
          // A trusted bot's bare approval asks nothing: it isn't passed on, and its card doesn't say it was.
          const passes = bot?.trusted === true && (review.verdict !== 'approved' || review.body.trim() !== '')
          if (
            voice === 'althar' ||
            !(yield* heard(link, 'review', `review:${review.id}`, {
              author: review.author.login,
              verdict: review.verdict,
              sha: now.headSha,
            }))
          )
            continue
          happened = true
          yield* arrive(link, {
            kind: 'review',
            from: review.author.login,
            verdict: review.verdict,
            where: name,
            text: review.body,
            url: review.url,
            outsider: voice === 'outsider',
            ...(bot === null || !(passes || (!bot.trusted && bot.first))
              ? {}
              : { bot: { login: bot.login, name: bot.name, trusted: bot.trusted } }),
          })
          if ((voice === 'person' || voice === 'member') && review.verdict !== 'approved') {
            addressed = true
            forLead.push(reviewForLead(review, name))
          }
          if (bot !== null && passes) fromBot(bot, review)
        }
        for (const comment of activity.comments) {
          const voice = voiceOf(comment, account, replies)
          if (voice === 'althar') continue
          const bot = voice === 'bot' ? yield* botOf(comment) : null
          // A bot the project doesn't trust stays quiet; one Althar recognises as a reviewer is shown once, to be trusted.
          if (bot !== null && !bot.trusted && !bot.first) continue
          if (!(yield* heard(link, 'comment', `comment:${comment.id}`, { author: comment.author.login }))) continue
          happened = true
          yield* arrive(link, {
            kind: 'comment',
            from: comment.author.login,
            where: name,
            text: comment.body,
            path: comment.path,
            line: comment.line,
            url: comment.url,
            outsider: voice === 'outsider',
            ...(bot === null ? {} : { bot: { login: bot.login, name: bot.name, trusted: bot.trusted } }),
          })
          if (voice === 'person' || voice === 'member') {
            addressed = true
            forLead.push(commentForLead(comment, name))
          }
          if (bot?.trusted === true) fromBot(bot, comment)
        }
        if (forLead.some((part) => !part.startsWith('Checks failed'))) forLead.push(answerHint)
        // A trusted bot's findings come after the hint for what people said: they are weighed, not answered as asked.
        for (const bot of fromBots.values()) {
          if (now.state === 'open') addressed = true
          forLead.push(botFindingsForLead(bot.name, name, bot.said))
        }
        // Out of its merge queue as it merged, though read open still a moment, it is in it until a read says merged. Out of it
        // otherwise, open, the queue took it out unmerged: it is the person's to merge again. Where the host didn't say, it is
        // where it was. Put in from outside Althar, it is in it as one Althar put there, said once.
        const lands = before.queued === true && now.state === 'open' && now.queued === false && now.leftQueue === 'merged'
        const leftQueue = before.queued === true && now.state === 'open' && now.queued === false && !lands
        const unsaid = before.queued === true && now.state === 'open' && now.queued === undefined
        const entered = before.queued !== true && now.state === 'open' && now.queued === true
        // What merging needs, read again where anything happened on it, its head moved, or it was read a while ago (DEV-204).
        const rules = yield* rulesOf(
          host,
          repository,
          before,
          now,
          activity.reviews.length + activity.comments.length > 0 ||
            checks?.outcome !== before.checks?.outcome ||
            now.draft !== before.draft ||
            (now.conflicts ?? null) !== (before.conflicts ?? null) ||
            (now.queued === true) !== (before.queued === true),
        )
        // Attached to the task, it stays so (ADR-052).
        const after = {
          ...snapshotOf(now, before.repository, before.words, checks, before),
          ...(rules === undefined ? {} : { rules }),
          checksRevision,
          ...(before.attached === true ? { attached: true } : {}),
          ...(lands || unsaid ? { queued: true } : {}),
          ...(leftQueue || before.leftQueue !== undefined ? { leftQueue: (before.leftQueue ?? 0) + (leftQueue ? 1 : 0) } : {}),
        }
        // While it is in the queue, it is worth asking about often: it lands, or comes back, as soon as the queue's checks end.
        if (after.queued === true) happened = true
        if (entered) yield* sayOn(link, queuedNote(name, now.target))
        // Told the lead with its next turn, rather than starting one: what needs nothing of it now.
        const forNote: Array<string> = []
        if (leftQueue) {
          // Sent back for failing checks, or with no reason the host gives: what the merge-group build failed, read again as its
          // host has it, with the default branch on the same jobs.
          const queued =
            now.leftQueue === 'checks' || ((now.leftQueue === 'other' || now.leftQueue == null) && now.queueSha != null)
              ? yield* queueDetailOf(host, repository, now.queueSha, now.queueError)
              : null
          yield* heard(link, 'queue_left', `queue_left:${after.leftQueue}`, {
            reason: now.leftQueue ?? 'other',
            sha: now.headSha,
            ...(queued === null
              ? {}
              : {
                  queueSha: queued.queueSha,
                  failed: queued.failing,
                  detail: queued.logs,
                  ...(queued.main === null ? {} : { main: queued.main }),
                  ...(queued.jobs === undefined ? {} : { jobs: queued.jobs }),
                }),
          })
          happened = true
          const head = leftQueueNote(name, now.leftQueue)
          const said = leftQueueForLead(name, now.leftQueue, queued)
          // Its lead is put to work only where Althar knows the reason is the pull request's own: a job its build failed that the
          // default branch doesn't, or a conflict with what is ahead of it. Else the person hears that nothing names it, and its
          // lead reads it with its next turn, so it doesn't guess and push.
          const own = now.leftQueue === 'conflict' || queueOwnFailures(now.leftQueue, queued).length > 0
          // The person's line names what failed, each linked to its page, and folds the logs' ends under it; what the lead is told
          // (the logs as text, their framing, its tools) stays the lead's. Where the build couldn't be read, the host's answer folds.
          const taken = leftQueueLinked(name, now.url, now.leftQueue, queued)
          yield* sayOn(
            link,
            taken.title,
            own || now.leftQueue === 'removed' ? undefined : leftQueueUnclaimed(now.leftQueue, queued, repository.defaultBranch),
            {
              links: taken.links,
              logs: (queued?.jobs ?? []).map((job) => ({ name: job.name, url: job.url, log: job.tail, missing: job.missing })),
              details: queued !== null && queued.failing.length === 0 && queued.logs.length > 0 ? queued.logs.join('\n\n') : undefined,
            },
          )
          if (own) {
            // Not a conflict: an update from its target is update_branch or the queue, not a new round.
            const hint = now.leftQueue === 'conflict' ? [] : [sendBackHint(now.target ?? 'the target branch')]
            forLead.push([queued === null ? head : said, ...hint].join('\n\n'))
            addressed = true
          } else forNote.push(now.leftQueue === 'removed' ? head : leftQueueNoteForLead(name, now.leftQueue, queued))
        }
        if (after.state !== before.state) {
          if (after.state === 'merged' || after.state === 'closed')
            yield* heard(link, after.state, `${after.state}:${now.headSha}`, { sha: now.headSha })
          happened = true
          if (after.state === 'merged') yield* arrive(link, { kind: 'merged', from: null, where: name, url: now.url })
          if (after.state === 'closed') yield* arrive(link, { kind: 'closed', from: null, where: name, url: now.url })
        } else if (before.draft && !after.draft) {
          happened = true
          yield* arrive(link, { kind: 'ready', from: null, where: name, url: now.url })
        }
        const settled = after.state !== 'open'
        yield* saveSnapshot(link, after, {
          cursor: activity.cursor === '' ? link.cursor : activity.cursor,
          polledAt: yield* timestamp,
          ...(settled ? { listening: 0 } : {}),
        })
        // Merged or closed, it takes no more pushes: what the lead asked to push to it is closed.
        if (settled) for (const asked of yield* askedOf(link.taskId, before.url)) yield* settleAsked(asked, 'closed')
        if (after.state === 'merged' && before.state !== 'merged') {
          yield* Effect.andThen(
            Effect.andThen(
              Effect.andThen(Effect.andThen(stampMerged(link, before), follow(link.taskId, 'merged', before)), baseMoved),
              Effect.andThen(retargetAbove(link, before), bringInWaiting(link, before)).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not point what was stacked on a merged change elsewhere', cause)),
              ),
            ),
            // Its review after the merge, where it is owed, reads the change now that it merged, in the task itself.
            Effect.forkIn(fastLane.reviewMerged(link.taskId, before.url), scope).pipe(Effect.asVoid),
          )
        }
        if (after.state === 'merged') yield* dependencies.settleIfDone(link.taskId)
        // Checks on what Althar pushed to resolve a conflict are the round's; what fails there isn't told the lead twice.
        const theRounds = yield* dependencies
          .checked(link, before.url, now, host, repository, ran)
          .pipe(
            Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not hear the checks on a resolved conflict', cause), false)),
          )
        // Not worked out yet by its host, whether it conflicts is asked again next turn, a few turns running, not taken for a no.
        const unknown = now.state === 'open' && now.conflicts === undefined ? (unknownFor.get(link.id) ?? 0) + 1 : 0
        if (unknown === 0) unknownFor.delete(link.id)
        else unknownFor.set(link.id, unknown)
        // A conflict is looked for before the lead is told the rest: one found now is asked with the checks that failed, at once.
        const began =
          now.state === 'open'
            ? yield* dependencies
                .lookAt(link, before, now, host, repository, how, theRounds ? null : failedNow)
                .pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not look for a conflict to resolve', cause), false)))
            : yield* Effect.as(dependencies.forgetUnsent(link.taskId), false)
        // While a round is under way on this pull request, the checks that count are those on the merge it pushes: the round sees
        // them through. Another pull request's round leaves this one's checks to the lead.
        const rounds = theRounds || began || (yield* roundUnderWay(link.taskId, before.url))
        // Held for Ship, the checks that failed are the pushed head's, which Ship replaces: they start no fix, and show beside Ship.
        // Waiting for another change of the task's to merge, its failures are that one's to fix: they start no fix either.
        const forShip = (yield* worktreeOf(link.taskId, before.url))?.heldAt != null || (yield* waitingOn(link.taskId, before.url)) !== null
        yield* tellLead(link, forNote, false, 'note')
        // Merged or closed, what is said on it after starts no turn: its lead reads it with its next one (tellLead).
        yield* tellLead(
          link,
          rounds || forShip ? forLead.filter((part) => !part.startsWith('Checks failed')) : forLead,
          addressed || (after.state === 'open' && alone && !rounds && !forShip),
          after.state === 'open' ? 'turn' : 'note',
        )
        // Failing checks its lead was to see through but was never told, as when an earlier look heard them and ended before it
        // told the lead: told now, or handed to the person, never neither.
        if (now.state === 'open' && !held && failedNow === null && !rerunning && !rounds && !forShip)
          yield* dependencies.tellUntold(link, name, host, repository, now.target || repository.defaultBranch)
        if (now.state === 'open' && !held)
          yield* bringTogether(link, now.headSha, now.url).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not have the lead bring in what was pushed to its pull request', cause)),
          )
        return happened
      })

    return {
      arrive,
      checksSent,
      fixesOf,
      fixingOn,
      handsOf,
      heard,
      leadRanAgain,
      poll,
      publishing,
      ranAgain,
      read,
      roundUnderWay,
      sayOn,
      shortNameOf,
      tellLead,
      urlsOf,
      withdrawChecks,
    }
  })

/** The latest time the lead was told the checks on this commit failed, as its to see through, and where its branch was then. */
export const toldOf = (link: LinkRow, sha: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [told] = yield* sql<{ at: string; id: string; branch: string | null }>`
        SELECT observed_at AS at, json_extract(payload, '$.id') AS id, json_extract(payload, '$.branch') AS branch FROM observations
        WHERE subject_type = 'external_link' AND subject_id = ${link.id} AND kind = 'checks_told'
          AND json_extract(payload, '$.sha') = ${sha}
        ORDER BY observed_at DESC, rowid DESC LIMIT 1`
    return told
  })
