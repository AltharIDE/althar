import { type Check, type CodeHost, type ConnectorFailed, products, type Repository } from '@althar/connectors'
import { Effect } from 'effect'

import { failingOnBase, queueMainLine, type QueueDetail } from './pullRequestWords'

/*
 * A failed check's log, as Althar reads it for the thread's card and for
 * the lead: its end, or all of it, or, where there is none to read, why in
 * plain words, with what the check reported of itself instead. Never
 * nothing: a log that can't be read says so.
 */

export interface LogRead {
  readonly name: string
  /** The check's page, on its host or its CI service's. */
  readonly url: string | null
  /** Its log, its end or all of it as asked; null where there is none to read. */
  readonly log: string | null
  /** Why there is no log, in plain words: "GitHub refused (401): Bad credentials". Null where there is one. */
  readonly missing: string | null
  /** What a check with no log reported of itself, where it said more than its summary. */
  readonly report: string | null
  /** Whether its host keeps a log of it at all: one it keeps failed to be read. */
  readonly kept: boolean
  /** Whether reading it again may go otherwise: its host was out of reach or busy, rather than refusing. */
  readonly passing: boolean
}

/** The host's own words after its status, where it said more than the status: ": Bad credentials". */
const saidOf = (error: ConnectorFailed) => (error.message === '' || error.message === String(error.status) ? '' : `: ${error.message}`)

/** Why a log the host keeps couldn't be read, in plain words. */
export const whyUnread = (host: string, error: ConnectorFailed): string => {
  if (error.sizeLimit !== undefined) return `Log exceeds the ${error.sizeLimit / (1024 * 1024)} MiB size cap; use the check URL`
  const status = error.status === undefined ? '' : ` (${error.status})`
  switch (error.reason) {
    // Only a sign-in a second look bore out as no good reaches here (Connections' `guarded`).
    case 'unauthorized':
      return `${host} refused${status}${saidOf(error)}. Its connection needs signing in again`
    case 'forbidden':
      return `${host} refused${status}${saidOf(error)}. Its sign-in may not be allowed to read logs`
    case 'not_found':
      return `${host} no longer has it${status}${saidOf(error)}. Logs are kept for a while, then deleted`
    case 'rate_limited':
      return `${host}'s rate limit was reached${error.retryAt === undefined ? '' : `, until ${error.retryAt}`}`
    case 'unreachable':
      return `${host} didn't answer${saidOf(error)}`
    // As the storage a log is sent to refuses its signed address.
    case 'rejected':
      return `${host} refused it${status}${saidOf(error)}`
    case 'invalid_response':
      return `${host} answered with something Althar couldn't read${status}${saidOf(error)}`
  }
}

/** The host's name, as people say it: GitHub, GitLab. */
export const hostName = (host: Pick<CodeHost, 'product'>) => products[host.product].name

/** A failed queue/check/branch lookup, without a log-specific explanation for an unrelated API call. */
const lookupFailure = (host: CodeHost, error: ConnectorFailed) =>
  `${hostName(host)} (${error.reason}${error.status === undefined ? '' : `, ${error.status}`}): ${error.message}${error.retryAt === undefined ? '' : `; retry after ${error.retryAt}`}`

/**
 * A failed check's log, its end or with `whole` all of it, or why there is
 * none: the host refused it, no longer keeps it, or keeps no log of a check
 * another CI service ran, whose own report is read instead.
 */
export const readLog = (host: CodeHost, repository: Repository, check: Check, whole = false): Effect.Effect<LogRead> => {
  const read = { name: check.name, url: check.url }
  const name = hostName(host)
  return host.checkLog(repository, check, whole).pipe(
    Effect.flatMap((log) =>
      log !== null
        ? Effect.succeed<LogRead>({ ...read, log, missing: null, report: null, kept: true, passing: false })
        : Effect.map(
            (host.checkReport?.(repository, check) ?? Effect.succeed(null)).pipe(Effect.orElseSucceed(() => null)),
            (report): LogRead => ({
              ...read,
              log: null,
              missing: `${name} keeps no log of it that Althar can read`,
              report,
              kept: false,
              passing: false,
            }),
          ),
    ),
    Effect.catch((error) =>
      Effect.succeed<LogRead>({
        ...read,
        log: null,
        missing: whyUnread(name, error),
        report: null,
        kept: true,
        passing: error.reason === 'unreachable' || error.reason === 'rate_limited',
      }),
    ),
  )
}

/** How many lines of a check's log `read_check_log` gives at a time. */
const LOG_PAGE = 300

/**
 * A page of a check's whole log, as `read_check_log` gives it (ADR-041):
 * from the line asked for, or its last page without one, with where the
 * pages before and after start. Never more than a page at once.
 */
export const logPage = (log: string, fromLine: number | null | undefined, name: string, on: string): string => {
  const lines = log.trimEnd().split('\n')
  const from = Math.min(Math.max(1, Math.floor(fromLine ?? lines.length - LOG_PAGE + 1)), lines.length)
  const to = Math.min(lines.length, from + LOG_PAGE - 1)
  const around = [
    ...(from > 1 ? [`from_line ${Math.max(1, from - LOG_PAGE)} reads the page before`] : []),
    ...(to < lines.length ? [`from_line ${to + 1} reads on`] : []),
  ]
  return [
    `Lines ${from} to ${to} of ${lines.length} of ${name}'s log on ${on}${around.length === 0 ? '' : `; ${around.join(', ')}`}:`,
    '```',
    lines.slice(from - 1, to).join('\n'),
    '```',
  ].join('\n')
}

/** What the lead is told of a log it was given, or of one it couldn't be: why, and where to look instead. */
export const logForLead = (read: LogRead): string => {
  if (read.log !== null) return `The end of ${read.name}'s log:\n\`\`\`\n${read.log}\n\`\`\``
  const page = read.url === null ? '' : ` Its page: ${read.url}`
  const again = !read.kept
    ? ''
    : read.passing
      ? ' read_check_log may read it in a while.'
      : ' Reading it again with read_check_log would fail the same way: work from what is here, or reproduce the check locally.'
  const report = read.report === null ? '' : `\nWhat it reported of itself:\n\`\`\`\n${read.report}\n\`\`\``
  return `Althar couldn't read ${read.name}'s log: ${read.missing ?? 'its host keeps none'}.${again}${page}${report}`
}

/**
 * What the queue's build failed: its jobs on its merge-group commit, the ends
 * of their logs, and the repository's default branch at its latest commit on
 * the same jobs (not the pull request's target). A failed lookup retains its
 * exact reason; it never turns into an empty or successful check listing.
 */
export const queueDetailOf = (host: CodeHost, repository: Repository, queueSha: string | null | undefined, unread?: string | null) =>
  Effect.gen(function* () {
    const base = repository.defaultBranch
    const unavailable = (why: string): QueueDetail => ({ queueSha: queueSha ?? null, failing: [], logs: [why], main: null, jobs: [] })
    if (queueSha == null) return unavailable(unread ?? "The host didn't identify the merge-queue build, so its failed jobs can't be read.")
    const built = yield* host.checks(repository, queueSha, { strict: true }).pipe(
      Effect.map((checks) => ({ checks, error: null })),
      Effect.catch((error) =>
        Effect.succeed({
          checks: [] as ReadonlyArray<Check>,
          error: `Couldn't read the queue build's checks: ${lookupFailure(host, error)}.`,
        }),
      ),
    )
    if (built.error !== null) return unavailable(built.error)
    const failed = built.checks.filter((check) => check.state === 'failed')
    const reads = yield* Effect.forEach(
      failed,
      (check) =>
        readLog(host, repository, check).pipe(
          Effect.map((read) => ({
            ...read,
            log: read.log === null ? null : read.log.trimEnd().split('\n').slice(-150).join('\n').slice(-12_000),
          })),
        ),
      { concurrency: 3 },
    )
    const failing = failed.map((check) => check.name)
    const { main, onBaseToo } = yield* host.branchHead(repository, base).pipe(
      Effect.flatMap((tip) =>
        host.checks(repository, tip, { strict: true }).pipe(
          Effect.map((checks) => ({
            main: queueMainLine(`${base} (${tip.slice(0, 7)})`, failing, checks),
            onBaseToo: failingOnBase(failing, checks),
          })),
        ),
      ),
      Effect.catch((error) =>
        Effect.succeed({
          main: `Couldn't compare with ${base}'s latest commit: ${lookupFailure(host, error)}.`,
          onBaseToo: [] as ReadonlyArray<string>,
        }),
      ),
    )
    return {
      queueSha,
      failing,
      logs: reads.map((read) => (read.log !== null && read.url !== null ? `${logForLead(read)} Its page: ${read.url}` : logForLead(read))),
      main,
      jobs: reads.map((read) => ({ name: read.name, url: read.url, tail: read.log, missing: read.missing })),
      onBaseToo,
    } satisfies QueueDetail
  })
