import { Duration, Effect, Option, Schema } from 'effect'

import type { Fetch } from './http'
import type { Product, Service } from './model'

/*
 * A company's own server, by the address the person typed or a remote named:
 * which of a service's products answers there, asked without signing in.
 * GitLab marks every API answer with its own header, a stranger's included;
 * Bitbucket Data Center names itself in its application's properties;
 * GitHub Enterprise Server says its version in its meta; and Jira's server
 * info says whether it is Cloud or Data Center, and where it lives.
 */

export interface Identified {
  /** The product that answered there, or null. */
  readonly product: Product | null
  /** The address a connection keeps: the origin, with the path a server lives under where it has one. */
  readonly webUrl: string
  /** Why none did: not an address, nothing answered, or something else did. */
  readonly reason: 'invalid' | 'unreachable' | 'other' | null
}

/** How long a server has to answer. */
const WAIT = Duration.seconds(6)

/** The address typed, as an origin and the first segment of its path, which a server may live under (`/jira`). */
const candidatesOf = (typed: string): ReadonlyArray<string> | null => {
  const text = typed.trim()
  if (text === '') return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname.includes('.')) return null
  const [first] = url.pathname.split('/').filter((segment) => segment !== '')
  return first === undefined ? [url.origin] : [url.origin, `${url.origin}/${first}`]
}

interface Answer {
  readonly status: number
  readonly headers: Headers
  readonly json: unknown
}

/** A GET without a credential, and what came back; null when nothing did. */
const ask = (fetch: Fetch, url: string): Effect.Effect<Answer | null> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'Althar' }, signal })
      const text = await response.text()
      let json: unknown = null
      try {
        json = JSON.parse(text)
      } catch {
        // A page, not JSON: what answered isn't the API asked for.
      }
      return { status: response.status, headers: response.headers, json }
    },
    catch: () => null,
  }).pipe(
    Effect.timeoutOrElse({ duration: WAIT, orElse: () => Effect.succeed(null) }),
    Effect.orElseSucceed(() => null),
  )

const GitLabVersion = Schema.Struct({ version: Schema.String, revision: Schema.String })
const BitbucketProperties = Schema.Struct({ displayName: Schema.String, version: Schema.String })
const GitHubMeta = Schema.Struct({ installed_version: Schema.String })
/* Jira's server info: always its address, its version and that version's numbers, which nothing else answers with together. */
const JiraInfo = Schema.Struct({
  baseUrl: Schema.String,
  version: Schema.String,
  versionNumbers: Schema.Array(Schema.Number),
  deploymentType: Schema.optional(Schema.String),
})

/** Whether an address Jira says it lives at is the server asked: the same origin, at or under its path. */
const sameServer = (said: string, base: string): boolean => {
  try {
    const at = new URL(said)
    const asked = new URL(base)
    return (
      at.origin === asked.origin &&
      at.username === '' &&
      at.password === '' &&
      `${at.pathname}/`.startsWith(`${asked.pathname.replace(/\/+$/, '')}/`)
    )
  } catch {
    return false
  }
}

const fits = <A>(schema: Schema.Codec<A, unknown>, json: unknown): A | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(json))

/** What answered at one address, for a service: its product and where it lives, or null. */
const answerAt = (fetch: Fetch, service: Service, base: string): Effect.Effect<{ product: Product; webUrl: string } | null | 'nothing'> =>
  Effect.gen(function* () {
    switch (service) {
      case 'gitlab': {
        const answer = yield* ask(fetch, `${base}/api/v4/version`)
        if (answer === null) return 'nothing'
        return answer.headers.has('x-gitlab-meta') || fits(GitLabVersion, answer.json) !== undefined
          ? { product: 'gitlab', webUrl: base }
          : null
      }
      case 'bitbucket': {
        const answer = yield* ask(fetch, `${base}/rest/api/1.0/application-properties`)
        if (answer === null) return 'nothing'
        return fits(BitbucketProperties, answer.json)?.displayName.toLowerCase().includes('bitbucket') === true
          ? { product: 'bitbucket_dc', webUrl: base }
          : null
      }
      case 'github': {
        const answer = yield* ask(fetch, `${base}/api/v3/meta`)
        if (answer === null) return 'nothing'
        return fits(GitHubMeta, answer.json) === undefined ? null : { product: 'github', webUrl: base }
      }
      case 'jira': {
        const answer = yield* ask(fetch, `${base}/rest/api/2/serverInfo`)
        if (answer === null) return 'nothing'
        const info = answer.status === 200 ? fits(JiraInfo, answer.json) : undefined
        if (info === undefined) return null
        // Jira says where it lives; kept only where that is the server asked, never another host a token would go to.
        const said = info.baseUrl.replace(/\/+$/, '')
        const webUrl = sameServer(said, base) ? said : base
        return { product: info.deploymentType === 'Cloud' ? 'jira_cloud' : 'jira_dc', webUrl }
      }
      case 'linear':
      case 'trello':
        // Neither runs on a company's own server.
        return null
    }
  })

/** Which of a service's products answers at an address, asked without signing in. */
export const identify = (fetch: Fetch, service: Service, typed: string): Effect.Effect<Identified> =>
  Effect.gen(function* () {
    const candidates = candidatesOf(typed)
    if (candidates === null) return { product: null, webUrl: typed.trim(), reason: 'invalid' }
    let reached = false
    for (const base of candidates) {
      const found = yield* answerAt(fetch, service, base)
      if (found === 'nothing') continue
      reached = true
      if (found !== null) return { product: found.product, webUrl: found.webUrl, reason: null }
    }
    return { product: null, webUrl: candidates[0] ?? typed.trim(), reason: reached ? 'other' : 'unreachable' }
  })
