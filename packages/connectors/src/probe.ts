import { Duration, Effect, Option, Schema } from 'effect'

import { type AccessInput, type AccessLine, type AccessReason, type AccessReport, line } from './access'
import { authorizationOf } from './credential'
import { messageOf } from './http'

/*
 * How a product's check (access.ts) asks its service: one question at a
 * time, with the connection's credential, bounded in time, and its answer
 * kept whatever its status, since a refusal is itself what a check learns.
 * Nothing here fails: an answer that never came is status 0, with why. Its
 * lines come out of the answers by the helpers below, which every product's
 * check shares.
 */

/** What a service answered one of a check's questions. */
export interface Answer {
  /** The HTTP status; 0 when nothing answered. */
  readonly status: number
  readonly headers: Headers
  /** The body as JSON; null when it isn't. */
  readonly json: unknown
  /** What went wrong, in the service's own words, or why nothing answered; empty for a success. */
  readonly message: string
}

/** How long a service has to answer each question. */
const WAIT = Duration.seconds(15)

const unanswered = (message: string): Answer => ({ status: 0, headers: new Headers(), json: null, message })

/**
 * A GET, or a GraphQL query where one is given, signed in with the
 * connection's credential and sent with the headers its adapter sends.
 * The credential goes in a header, never in the address.
 */
export const probe = (
  input: AccessInput,
  url: string,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly query?: string } = {},
): Effect.Effect<Answer> =>
  Effect.tryPromise({
    try: async (signal): Promise<Answer> => {
      const response = await input.fetch(url, {
        method: options.query === undefined ? 'GET' : 'POST',
        headers: {
          'user-agent': 'Althar',
          accept: 'application/json',
          ...options.headers,
          ...(options.query === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: authorizationOf(input.credential),
        },
        signal,
        ...(options.query === undefined ? {} : { body: JSON.stringify({ query: options.query }) }),
      })
      const text = await response.text()
      let json: unknown = null
      try {
        json = JSON.parse(text)
      } catch {
        // Not JSON: plain words, if any, are the message.
      }
      const success = response.status >= 200 && response.status < 300
      return { status: response.status, headers: response.headers, json, message: success ? '' : messageOf(text, `${response.status}`) }
    },
    catch: (error) => unanswered(String(error).slice(0, 300)),
  }).pipe(
    Effect.timeoutOrElse({ duration: WAIT, orElse: () => Effect.succeed(unanswered('The service did not answer in time')) }),
    Effect.catch((answer) => Effect.succeed(answer)),
  )

/** Whether a question was answered with a success. */
export const answered = (answer: Answer): boolean => answer.status >= 200 && answer.status < 300

/** An answer's body read by a schema; undefined when it doesn't fit. */
export const readAs = <A>(schema: Schema.Codec<A, unknown>, answer: Answer): A | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(answer.json))

/** Whether an answer was held back by a rate limit, which says nothing of what the credential may do. */
export const limited = (answer: Answer): boolean =>
  answer.status === 429 ||
  (answer.status === 403 && (answer.headers.get('x-ratelimit-remaining') === '0' || answer.headers.has('retry-after')))

/** Whether something went wrong on the way, rather than the service judging the credential: nothing answered, it failed, or it limited the rate. */
export const troubled = (answer: Answer): boolean => answer.status === 0 || answer.status >= 500 || limited(answer)

/** It couldn't be asked: the service's own words. */
export const failedOf = (answer: Answer): AccessReason => ({ kind: 'failed', message: answer.message })

/** Why a question about the account wasn't answered: a credential the service didn't take, or its own words. */
export const refusalOf = (answer: Answer): AccessReason => (answer.status === 401 ? { kind: 'refused' } : failedOf(answer))

/** A success Althar couldn't read. */
export const UNREADABLE: AccessReason = { kind: 'failed', message: 'An answer Althar couldn’t read' }

/** What only writing would show. */
export const UNSAID: AccessReason = { kind: 'unreadable' }

/** A check that stopped at a line: who it signs in as wasn't learnt, and nothing after it could be asked. */
export const stopped = (lines: ReadonlyArray<AccessLine>): AccessReport => ({ account: null, lines, expiresAt: null, scopes: null })

/** An address's host, as a line names a server or a site. */
export const hostOf = (webUrl: string): string => {
  try {
    return new URL(webUrl).host
  } catch {
    return webUrl
  }
}

/** A server's line, or a site's, from the first answer it gave: it answered, or nothing did. */
export const serverLine = (need: 'server' | 'site', webUrl: string, answer: Answer): AccessLine =>
  line(need, answer.status === 0 ? 'no' : 'ok', { fact: hostOf(webUrl), reason: answer.status === 0 ? failedOf(answer) : null })

/** What a check learns of one repository: what it found there, or why it doesn't see it. */
export type Reached<A> =
  | { readonly path: ReadonlyArray<string>; readonly seen: A }
  | { readonly path: ReadonlyArray<string>; readonly missed: AccessReason }

/** What was found of the repositories it sees. */
export const seenOf = <A>(reached: ReadonlyArray<Reached<A>>): ReadonlyArray<A> =>
  reached.flatMap((one) => ('seen' in one ? [one.seen] : []))

/**
 * The reach line: ok when every repository is seen, or else the first
 * one's reason, with every repository it doesn't see named together. The
 * fact is what the repositories it sees say.
 */
export const reachLine = <A>(reached: ReadonlyArray<Reached<A>>, fact: string | null): AccessLine => {
  const [first] = reached.flatMap((one) => ('missed' in one ? [one.missed] : []))
  if (first === undefined) return line('reach', 'ok', { fact })
  const names = reached.flatMap((one) => ('missed' in one && one.missed.kind === 'unseen' ? [one.path.join('/')] : []))
  return line('reach', 'no', { fact, reason: first.kind === 'unseen' ? { ...first, names } : first })
}
