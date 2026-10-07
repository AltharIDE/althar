import { Effect, Schema } from 'effect'

import { type AdapterOptions, authorizationOf } from './credential'
import type { ConnectorFailed } from './errors'
import { makeHttp } from './http'
import { AdfNode, adfOf, markdownOfAdf, markdownOfWiki, wikiOf } from './jiraText'
import type { Account, Issue, Person, Priority, StatusCategory, Tracker } from './model'

/*
 * Jira, a tracker: Jira Cloud over version 3 of its REST API, and Jira Data
 * Center over version 2. An issue goes by its key, PROJ-123. The two
 * editions differ in three ways: who someone is (Cloud's account id, Data
 * Center's user name), how text is written (Cloud's Atlassian Document
 * Format, Data Center's wiki markup; see jiraText.ts), and where a search
 * goes (Cloud removed `/search` in 2025 for `/search/jql`; Data Center keeps
 * it). Cloud signs in with the account's email and an API token, Data Center
 * with a personal access token as a bearer.
 */

type Edition = 'jira_cloud' | 'jira_dc'

/** The fields an issue is read with. */
const FIELDS = 'summary,description,status,priority,assignee,labels,project,updated,resolution'

/** Someone on Jira Cloud, by account id; on Data Center, by user name and key. */
const User = Schema.Union([
  Schema.Struct({
    accountId: Schema.String,
    displayName: Schema.optional(Schema.String),
    emailAddress: Schema.optional(Schema.String),
    accountType: Schema.optional(Schema.String),
  }),
  Schema.Struct({ name: Schema.String, key: Schema.optional(Schema.String), displayName: Schema.optional(Schema.String) }),
])
type User = typeof User.Type

const IssueAnswer = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    // ADF on Cloud, wiki markup on Data Center.
    description: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, AdfNode]))),
    status: Schema.Struct({ name: Schema.String, statusCategory: Schema.optional(Schema.Struct({ key: Schema.String })) }),
    priority: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    assignee: Schema.optional(Schema.NullOr(User)),
    labels: Schema.optional(Schema.Array(Schema.String)),
    project: Schema.optional(Schema.Struct({ key: Schema.String, name: Schema.String })),
    updated: Schema.String,
    resolution: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  }),
})
type IssueAnswer = typeof IssueAnswer.Type

/** Resolutions that close an issue without its work done: Won't Do, Duplicate, Cannot Reproduce and their kind. */
const UNDONE =
  /\b(won['’]?t|duplicate|invalid|incomplete|cannot reproduce|can['’]?t reproduce|not an? (bug|problem|issue)|works (for me|as designed|as intended)|declined|rejected|abandoned|obsolete|out of date|auto closed|later|cancell?ed)\b/i

/**
 * A status's category, as every tracker's statuses fall into: Jira's three
 * (`new`, `indeterminate`, `done`), with a backlog or triage told by the
 * status's name, and a done issue resolved as not done cancelled.
 */
export const categoryOf = (category: string | undefined, status: string, resolution: string | null): StatusCategory => {
  switch (category) {
    case 'indeterminate':
      return 'started'
    case 'done':
      return resolution !== null && UNDONE.test(resolution) ? 'cancelled' : 'done'
    default:
      return /triage/i.test(status) ? 'triage' : /backlog/i.test(status) ? 'backlog' : 'todo'
  }
}

/** Jira's priorities by name: today's five, the five before them, and the P0 to P4 some sites use. */
const LEVELS: ReadonlyMap<string, Priority> = new Map([
  ['highest', 'urgent'],
  ['blocker', 'urgent'],
  ['urgent', 'urgent'],
  ['p0', 'urgent'],
  ['high', 'high'],
  ['critical', 'high'],
  ['p1', 'high'],
  ['medium', 'medium'],
  ['major', 'medium'],
  ['normal', 'medium'],
  ['p2', 'medium'],
  ['low', 'low'],
  ['lowest', 'low'],
  ['minor', 'low'],
  ['trivial', 'low'],
  ['p3', 'low'],
  ['p4', 'low'],
  ['none', 'none'],
  ['not a priority', 'none'],
])

/** A priority's level by its name; a name of a site's own sits in the middle. */
export const levelOf = (name: string): Priority => LEVELS.get(name.trim().toLowerCase()) ?? 'medium'

/** Jira's time (`2026-10-01T09:00:00.000+0200`) as the model's, in UTC, so it sorts with other trackers'. */
const isoOf = (at: string) => {
  const parsed = Date.parse(at.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
  return Number.isNaN(parsed) ? at : new Date(parsed).toISOString()
}

const personOf = (user: User): Person =>
  'accountId' in user
    ? { id: user.accountId, login: user.displayName ?? user.accountId, name: user.displayName ?? null, bot: user.accountType === 'app' }
    : { id: user.key ?? user.name, login: user.name, name: user.displayName ?? null, bot: false }

/** A JQL string, quoted. */
const quoted = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`

const makeJira = (product: Edition, options: AdapterOptions): Tracker => {
  const cloud = product === 'jira_cloud'
  const site = options.webUrl.replace(/\/+$/, '')
  const api = options.apiUrl.replace(/\/+$/, '')
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  /*
   * An API token with scopes works only through Atlassian's gateway,
   * api.atlassian.com/ex/jira/<cloud id>, never at the site's own address,
   * and nothing in the token says which kind it is. So a call the site
   * refuses as unauthorized is asked there once, and the gateway kept if it
   * answers. Data Center has no gateway.
   */
  let root = api
  const gateway = Effect.map(
    http.json(Schema.Struct({ cloudId: Schema.String }), 'GET', `${site}/_edge/tenant_info`),
    ({ cloudId }) => `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
  )
  const keep = (other: string) =>
    Effect.sync(() => {
      root = other
    })
  const call = <A>(request: (root: string) => Effect.Effect<A, ConnectorFailed>): Effect.Effect<A, ConnectorFailed> =>
    Effect.suspend(() =>
      !cloud || root !== api
        ? request(root)
        : request(api).pipe(
            Effect.catchIf(
              (error) => error.reason === 'unauthorized',
              (refused) =>
                gateway.pipe(
                  // No gateway to ask: the site's own answer stands.
                  Effect.mapError(() => refused),
                  Effect.flatMap((other) =>
                    request(other).pipe(
                      // Any answer but "unauthorized" says the token belongs there.
                      Effect.tap(() => keep(other)),
                      Effect.tapError((error) => (error.reason === 'unauthorized' ? Effect.void : keep(other))),
                      // Refused there too: so does the site's.
                      Effect.mapError((error) => (error.reason === 'unauthorized' ? refused : error)),
                    ),
                  ),
                ),
            ),
          ),
    )

  const issueOf = (answer: IssueAnswer): Issue => {
    const { fields } = answer
    const description = fields.description ?? ''
    return {
      id: answer.id,
      ref: answer.key,
      key: answer.key,
      title: fields.summary,
      body: typeof description === 'string' ? markdownOfWiki(description) : markdownOfAdf(description),
      url: `${site}/browse/${answer.key}`,
      status: {
        name: fields.status.name,
        category: categoryOf(fields.status.statusCategory?.key, fields.status.name, fields.resolution?.name ?? null),
      },
      priority: fields.priority == null ? null : { level: levelOf(fields.priority.name), name: fields.priority.name },
      assignees: fields.assignee == null ? [] : [personOf(fields.assignee)],
      labels: fields.labels ?? [],
      container: fields.project?.name ?? null,
      updatedAt: isoOf(fields.updated),
    }
  }

  const issuePath = (key: string) => `/issue/${encodeURIComponent(key)}`

  const account: Effect.Effect<Account, ConnectorFailed> = Effect.map(
    call((root) => http.json(User, 'GET', `${root}/myself`)),
    (user): Account =>
      'accountId' in user
        ? { id: user.accountId, login: user.emailAddress ?? user.displayName ?? user.accountId, name: user.displayName ?? null }
        : { id: user.key ?? user.name, login: user.name, name: user.displayName ?? null },
  )

  return {
    product,
    capabilities: { links: true },
    account,
    issue: (ref) =>
      Effect.map(
        call((root) => http.json(IssueAnswer, 'GET', `${root}${issuePath(ref)}?fields=${FIELDS}`)),
        issueOf,
      ),
    mine: (options = {}) => {
      const jql = [
        'assignee = currentUser() AND statusCategory != Done',
        ...(options.container === undefined ? [] : [`project = ${quoted(options.container)}`]),
      ].join(' AND ')
      const query = `jql=${encodeURIComponent(`${jql} ORDER BY updated DESC`)}&maxResults=${options.limit ?? 50}&fields=${FIELDS}`
      return Effect.map(
        call((root) =>
          http.json(Schema.Struct({ issues: Schema.Array(IssueAnswer) }), 'GET', `${root}/${cloud ? 'search/jql' : 'search'}?${query}`),
        ),
        ({ issues }) => issues.map(issueOf),
      )
    },
    comment: (issue, body) =>
      Effect.asVoid(
        call((root) =>
          http.json(Schema.Unknown, 'POST', `${root}${issuePath(issue.ref)}/comment`, { body: cloud ? adfOf(body) : wikiOf(body) }),
        ),
      ),
    // A remote link, by the link as its global id: linking the same pull request again changes the one link.
    link: (issue, link) =>
      Effect.asVoid(
        call((root) =>
          http.json(Schema.Unknown, 'POST', `${root}${issuePath(issue.ref)}/remotelink`, {
            globalId: link.url,
            object: { url: link.url, title: link.title },
          }),
        ),
      ),
  }
}

/** Jira Cloud, at a site's address (`https://meridian.atlassian.net`). */
export const makeJiraCloud = (options: AdapterOptions): Tracker => makeJira('jira_cloud', options)

/** Jira Data Center, at an instance's address. */
export const makeJiraDataCenter = (options: AdapterOptions): Tracker => makeJira('jira_dc', options)
