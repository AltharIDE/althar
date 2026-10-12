import { Clock, Effect, Schema } from 'effect'

import { type Access, type AccessLine, type AccessNeed, line } from './access'
import { type AdapterOptions, authorizationOf } from './credential'
import { ConnectorFailed } from './errors'
import { makeHttp, paged } from './http'
import { AdfNode, adfOf, markdownOfAdf, markdownOfWiki, wikiOf } from './jiraText'
import type { Account, Container, Issue, Person, Priority, StatusCategory, Tracker } from './model'
import { type Answer, answered, failedOf, probe, readAs, refusalOf, serverLine, stopped, UNREADABLE } from './probe'

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

/**
 * A Jira Cloud site's address: its origin alone. A site has no path of its
 * own, so a board's address pasted for it (`/jira/software/projects/PAY/
 * boards/3`) is the same site. Data Center's servers do live under paths.
 */
export const siteOf = (webUrl: string): string => {
  try {
    return new URL(webUrl).origin
  } catch {
    return webUrl.replace(/\/+$/, '')
  }
}

/** Who the credential signs in as: on Cloud by account id, and by email where Jira says it; on Data Center by user name. */
const accountOf = (user: User): Account =>
  'accountId' in user
    ? { id: user.accountId, login: user.emailAddress ?? user.displayName ?? user.accountId, name: user.displayName ?? null }
    : { id: user.key ?? user.name, login: user.name, name: user.displayName ?? null }

const Project = Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String })

/** A project's issue types, as each edition lists them: Cloud's under `issueTypes`, Data Center's under `values`, a page at a time. */
const IssueType = Schema.Struct({ id: Schema.String, name: Schema.String, subtask: Schema.optional(Schema.Boolean) })
const IssueTypes = Schema.Struct({ issueTypes: Schema.optional(Schema.Array(IssueType)), values: Schema.optional(Schema.Array(IssueType)) })

/** The type an issue Althar files is: a Task where the project has one, or else its first that isn't a sub-task, which needs a parent. */
const issueTypeOf = (types: typeof IssueTypes.Type) => {
  const all = types.issueTypes ?? types.values ?? []
  return all.find((type) => type.subtask !== true && /^task$/i.test(type.name)) ?? all.find((type) => type.subtask !== true)
}

/** A label as Jira can hold it: one word, so its spaces become hyphens. */
export const jiraLabelOf = (label: string): string => label.trim().replace(/\s+/g, '-')

/** How many projects a page of Cloud's project search holds: its most. */
const PROJECTS_PAGE = 100

/** A JQL string, quoted. */
const quoted = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`

const makeJira = (product: Edition, options: AdapterOptions): Tracker => {
  const cloud = product === 'jira_cloud'
  const site = cloud ? siteOf(options.webUrl) : options.webUrl.replace(/\/+$/, '')
  const api = options.apiUrl.replace(/\/+$/, '')
  const http = makeHttp({ product, fetch: options.fetch, authorization: Effect.map(options.credential, authorizationOf) })

  /*
   * An API token with scopes works only through Atlassian's gateway,
   * api.atlassian.com/ex/jira/<cloud id>, never at the site's own address,
   * and nothing in the token says which kind it is. So a call the site
   * refuses as unauthorized is asked there once. The gateway is kept when it
   * takes the token: it answers, or judges the request (not found, or not
   * allowed). A failure that says nothing of the token (unreachable, too many
   * calls) leaves the site to be tried first again next time. Data Center
   * has no gateway.
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
                      Effect.tap(() => keep(other)),
                      Effect.tapError((error) =>
                        error.reason === 'not_found' || error.reason === 'forbidden' ? keep(other) : Effect.void,
                      ),
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
    accountOf,
  )

  // A key as typed (proj-123) is the key: Jira's keys are upper case.
  const issue = (ref: string) =>
    Effect.map(
      call((root) => http.json(IssueAnswer, 'GET', `${root}${issuePath(ref.trim().toUpperCase())}?fields=${FIELDS}`)),
      issueOf,
    )

  return {
    product,
    capabilities: { links: true },
    account,
    issue,
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
    // A project, by its key, is where a Jira issue is filed: on Cloud, those with the latest issue first, a page at a time; Data Center lists them all at once.
    containers: () =>
      Effect.map(
        cloud
          ? paged(0, (startAt) =>
              Effect.map(
                call((root) =>
                  http.json(
                    Schema.Struct({ values: Schema.Array(Project), isLast: Schema.optional(Schema.Boolean) }),
                    'GET',
                    `${root}/project/search?maxResults=${PROJECTS_PAGE}&orderBy=-lastIssueUpdatedTime&startAt=${startAt}`,
                  ),
                ),
                ({ values, isLast }) => ({
                  items: values,
                  next: isLast === true || values.length < PROJECTS_PAGE ? undefined : startAt + values.length,
                }),
              ),
            )
          : call((root) => http.json(Schema.Array(Project), 'GET', `${root}/project`)),
        (projects) => projects.map((project): Container => ({ id: project.key, key: project.key, name: project.name })),
      ),
    create: (project, draft) =>
      Effect.gen(function* () {
        const type = issueTypeOf(
          yield* call((root) => http.json(IssueTypes, 'GET', `${root}/issue/createmeta/${encodeURIComponent(project)}/issuetypes`)),
        )
        if (type === undefined)
          return yield* new ConnectorFailed({
            product,
            reason: 'rejected',
            message: `The project ${project} has no type of issue Althar can file: sub-tasks need a parent`,
          })
        const labels = [...new Set(draft.labels.map(jiraLabelOf).filter((label) => label !== ''))]
        const fields = {
          project: { key: project },
          issuetype: { id: type.id },
          summary: draft.title,
          ...(draft.body === '' ? {} : { description: cloud ? adfOf(draft.body) : wikiOf(draft.body) }),
        }
        // What was filed, with the labels it was filed with.
        const file = (sent: ReadonlyArray<string>) =>
          Effect.map(
            call((root) =>
              http.json(Schema.Struct({ id: Schema.String, key: Schema.String }), 'POST', `${root}/issue`, {
                fields: sent.length > 0 ? { ...fields, labels: sent } : fields,
              }),
            ),
            (filed) => ({ ...filed, labels: sent }),
          )
        // Jira makes any label it is given, but a project whose screen has no labels refuses them: the issue is filed without.
        const filed = yield* file(labels).pipe(
          Effect.catchIf(
            (error) => labels.length > 0 && error.reason === 'rejected' && /\blabels\b/i.test(error.message),
            () => file([]),
          ),
        )
        // Filed: a failed read of it now is no reason to file it again, so it is what was sent.
        const now = yield* Clock.currentTimeMillis
        return yield* issue(filed.key).pipe(
          Effect.orElseSucceed((): Issue => ({
            id: filed.id,
            ref: filed.key,
            key: filed.key,
            title: draft.title,
            body: draft.body,
            url: `${site}/browse/${filed.key}`,
            status: { name: 'To Do', category: 'todo' },
            priority: null,
            assignees: [],
            labels: filed.labels,
            container: project,
            updatedAt: new Date(now).toISOString(),
          })),
        )
      }),
  }
}

/** Jira Cloud, at a site's address (`https://meridian.atlassian.net`). */
export const makeJiraCloud = (options: AdapterOptions): Tracker => makeJira('jira_cloud', options)

/** Jira Data Center, at an instance's address. */
export const makeJiraDataCenter = (options: AdapterOptions): Tracker => makeJira('jira_dc', options)

/*
 * What a Jira connection can do: its site answers, who it signs in as, and
 * whether the account may browse projects, transition issues and comment
 * on them, in any project, as Jira's own permissions say. On Cloud, a token
 * the site refuses is asked through Atlassian's gateway, as the adapter asks.
 */

const Permitted = Schema.Struct({
  permissions: Schema.Record(Schema.String, Schema.Struct({ havePermission: Schema.Boolean })),
})

/** An account's email, which Data Center says too, and Cloud where the person's privacy allows. */
const Email = Schema.Struct({ emailAddress: Schema.optional(Schema.NullOr(Schema.String)) })

/** Cloud and Data Center alike, told apart by their API: version 3 on Cloud, version 2 on Data Center. */
export const accessJira: Access = (input) =>
  Effect.gen(function* () {
    const cloud = /\/rest\/api\/3\/?$/.test(input.apiUrl)
    const site = cloud ? siteOf(input.webUrl) : input.webUrl.replace(/\/+$/, '')
    const api = input.apiUrl.replace(/\/+$/, '')
    const ask = (url: string) => probe(input, url)

    const atSite = yield* ask(`${api}/myself`)
    const siteLine = serverLine('site', site, atSite)
    if (atSite.status === 0) return stopped([siteLine])
    // A token with scopes works only through the gateway, which the site's id names.
    const gateway = (): Effect.Effect<{ readonly root: string; readonly me: Answer }> =>
      Effect.gen(function* () {
        const tenant = yield* ask(`${site}/_edge/tenant_info`)
        const cloudId = answered(tenant) ? readAs(Schema.Struct({ cloudId: Schema.String }), tenant)?.cloudId : undefined
        if (cloudId === undefined) return { root: api, me: atSite }
        const root = `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3`
        const there = yield* ask(`${root}/myself`)
        return answered(there) ? { root, me: there } : { root: api, me: atSite }
      })
    const { root, me } = cloud && atSite.status === 401 ? yield* gateway() : { root: api, me: atSite }
    if (!answered(me)) return stopped([siteLine, line('account', 'no', { reason: refusalOf(me) })])
    const user = readAs(User, me)
    if (user === undefined) return stopped([siteLine, line('account', 'no', { reason: UNREADABLE })])
    const account = accountOf(user)

    const permitted = yield* ask(`${root}/mypermissions?permissions=BROWSE_PROJECTS,TRANSITION_ISSUES,ADD_COMMENTS`)
    const said = answered(permitted) ? readAs(Permitted, permitted) : undefined
    const projects = yield* ask(cloud ? `${root}/project/search?maxResults=1` : `${root}/project`)
    // How many projects it sees, where that is cheap to ask: Cloud counts them, Data Center lists them.
    const count = !answered(projects)
      ? null
      : cloud
        ? (readAs(Schema.Struct({ total: Schema.Number }), projects)?.total ?? null)
        : (readAs(Schema.Array(Schema.Unknown), projects)?.length ?? null)
    const allowed = (need: AccessNeed, permission: string, more: { readonly count?: number | null } = {}): AccessLine =>
      said === undefined
        ? line(need, 'no', { reason: answered(permitted) ? UNREADABLE : failedOf(permitted) })
        : said.permissions[permission]?.havePermission === true
          ? line(need, 'ok', more)
          : line(need, 'no', { reason: { kind: 'role', role: null } })

    return {
      account,
      lines: [
        siteLine,
        line('account', 'ok', { fact: readAs(Email, me)?.emailAddress ?? user.displayName ?? account.login }),
        allowed('read', 'BROWSE_PROJECTS', { count }),
        allowed('comment', 'ADD_COMMENTS'),
        allowed('move', 'TRANSITION_ISSUES'),
      ],
      expiresAt: null,
      scopes: null,
    }
  })
