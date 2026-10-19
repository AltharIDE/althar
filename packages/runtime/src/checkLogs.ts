import { type Check, type CodeHost, type ConnectorFailed, products, type Repository } from '@althar/connectors'
import { Effect } from 'effect'

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
