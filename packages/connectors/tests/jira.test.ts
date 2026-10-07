import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { Credential } from '../src/credential'
import { categoryOf, levelOf, makeJiraCloud, makeJiraDataCenter, siteOf } from '../src/jira'
import type { Issue } from '../src/model'
import { products } from '../src/products'
import { type Route, stubFetch } from './stub'

/*
 * The answers here are real ones, trimmed: Jira Cloud's from the Hibernate
 * project's public site (hibernate.atlassian.net), Data Center's from the
 * Apache Software Foundation's (issues.apache.org/jira), read anonymously on
 * 7 October 2026. `/myself` and what a write answers need an account, so
 * those follow Atlassian's documented shapes.
 */

const SITE = 'https://hibernate.atlassian.net'
const CLOUD = `${SITE}/rest/api/3`
const INSTANCE = 'https://issues.apache.org/jira'
const DC = `${INSTANCE}/rest/api/2`
const FIELDS = 'fields=summary,description,status,priority,assignee,labels,project,updated,resolution'
const GATEWAY = 'https://api.atlassian.com/ex/jira/0aeb68bb-8040-48f1-9994-30e61701adb4/rest/api/3'

const cloud = (routes: ReadonlyArray<Route>, webUrl = `${SITE}/`) => {
  const { fetch, sent } = stubFetch(routes)
  const credential = Effect.succeed<Credential>({ kind: 'basic', user: 'you@meridian.dev', token: 'ATATT3x' })
  return { tracker: makeJiraCloud({ fetch, apiUrl: products.jira_cloud.apiFor(webUrl), webUrl, credential }), sent }
}

const dataCenter = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  const credential = Effect.succeed<Credential>({ kind: 'bearer', token: 'NjQ5pat' })
  return { tracker: makeJiraDataCenter({ fetch, apiUrl: DC, webUrl: INSTANCE, credential }), sent }
}

/** HHH-20844, trimmed, with HHH-1’s assignee and HHH-20479’s label. */
const cloudIssue = (fields: Record<string, unknown> = {}) => ({
  expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
  id: '115161',
  self: `${CLOUD}/issue/115161`,
  key: 'HHH-20844',
  fields: {
    summary: '@MapKey on an association whose target has a composite id fails during bootstrap',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Building the ' },
            { type: 'text', text: 'SessionFactory', marks: [{ type: 'code' }] },
            { type: 'text', text: ' aborts with a ' },
            { type: 'text', text: 'java.lang.AssertionError', marks: [{ type: 'code' }] },
            { type: 'text', text: ':' },
          ],
          attrs: { localId: 'c81f0cd34f98' },
        },
        {
          type: 'codeBlock',
          attrs: { language: 'java', localId: 'ee16aa25-3003-414f-85ce-175039626fe4', wrap: true },
          content: [
            {
              type: 'text',
              text: 'java.lang.AssertionError\n    at org.hibernate.metamodel.mapping.internal.MappingModelCreationHelper.getPropertyOrder(MappingModelCreationHelper.java:1256)',
            },
          ],
        },
        { type: 'heading', attrs: { level: 2, localId: '44773ed8f6a1' }, content: [{ type: 'text', text: 'Trigger' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'If the identifier is ' },
            { type: 'text', text: 'not', marks: [{ type: 'em' }] },
            { type: 'text', text: ' composite, ' },
            { type: 'text', text: 'getPropertyOrder', marks: [{ type: 'code' }] },
            { type: 'text', text: ' returns early.' },
          ],
        },
        { type: 'rule', attrs: { localId: '6e62d3c8a9ac' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Please find a reproducer attached.' }], attrs: { localId: 'd99515dafa88' } },
      ],
    },
    status: {
      self: `${CLOUD}/status/10002`,
      description: 'This issue’s work was completed and there is a pull request which is awaiting review.',
      iconUrl: `${SITE}/images/icons/statuses/document.png`,
      name: 'Waiting for review',
      id: '10002',
      statusCategory: { self: `${CLOUD}/statuscategory/4`, id: 4, key: 'indeterminate', colorName: 'yellow', name: 'In Progress' },
    },
    priority: { self: `${CLOUD}/priority/3`, iconUrl: `${SITE}/images/icons/priorities/major_new.svg`, name: 'Major', id: '3' },
    assignee: {
      self: `${CLOUD}/user?accountId=557058%3Aaafa2e9a-7a21-4c62-bf4a-050acb31276c`,
      accountId: '557058:aafa2e9a-7a21-4c62-bf4a-050acb31276c',
      displayName: 'Steve Ebersole',
      active: true,
      timeZone: 'America/Los_Angeles',
      accountType: 'atlassian',
    },
    labels: ['good-first-issue'],
    project: {
      self: `${CLOUD}/project/10031`,
      id: '10031',
      key: 'HHH',
      name: 'Hibernate ORM',
      projectTypeKey: 'software',
      simplified: false,
    },
    updated: '2026-10-07T08:26:17.722-0700',
    resolution: null,
    ...fields,
  },
})

/** KAFKA-21043, trimmed. */
const dcIssue = (fields: Record<string, unknown> = {}) => ({
  expand: 'operations,versionedRepresentations,editmeta,changelog,renderedFields',
  id: '13665242',
  self: `${DC}/issue/13665242`,
  key: 'KAFKA-21043',
  fields: {
    summary: '(SASL/OAUTHBEARER) LoginManager cache omits the class loader, so the credential refresh thread outlives its deployment',
    description: [
      '{{LoginManager}} caches instances by JAAS configuration, login class, login',
      'callback class and the {{sasl.*}} configs.',
      'h3. Sequence',
      ' # Deployment A creates a client. Its LoginManager is cached and',
      '{{ExpiringCredentialRefreshingLogin}} starts a refresh thread.',
      ' # Deployment B creates a client with the same JAAS configuration.',
      'h3. Observed failure',
      '{code:java}',
      'javax.security.auth.login.LoginException: java.lang.IllegalStateException: Trying to access closed classloader',
      '    at javax.security.auth.login.LoginContext.invoke(LoginContext.java:691)',
      '{code}',
      '||Change||Key||',
      '|KIP-83 / KAFKA-4180 (0.10.2.0)|JAAS config|',
      '|KAFKA-14676 (3.3.3, 3.4.1, 3.5.0)|+ all {{sasl.*}} configs|',
    ].join('\r\n'),
    status: {
      self: `${DC}/status/1`,
      description: 'The issue is open and ready for the assignee to start work on it.',
      iconUrl: `${INSTANCE}/images/icons/statuses/open.png`,
      name: 'Open',
      id: '1',
      statusCategory: { self: `${DC}/statuscategory/2`, id: 2, key: 'new', colorName: 'blue-gray', name: 'To Do' },
    },
    priority: { self: `${DC}/priority/3`, iconUrl: `${INSTANCE}/images/icons/priorities/major.svg`, name: 'Major', id: '3' },
    assignee: {
      self: `${DC}/user?username=seokmoyoo`,
      name: 'seokmoyoo',
      key: 'JIRAUSER314554',
      displayName: 'Seokmo Yoo',
      active: true,
      timeZone: 'Etc/UTC',
    },
    labels: [],
    project: { self: `${DC}/project/12311720`, id: '12311720', key: 'KAFKA', name: 'Kafka', projectTypeKey: 'software' },
    updated: '2026-10-07T03:24:57.000+0000',
    resolution: null,
    ...fields,
  },
})

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: '115161',
  ref: 'HHH-20844',
  key: 'HHH-20844',
  title: 't',
  body: '',
  url: `${SITE}/browse/HHH-20844`,
  status: { name: 'Waiting for review', category: 'started' },
  priority: null,
  assignees: [],
  labels: [],
  container: 'Hibernate ORM',
  updatedAt: '2026-10-07T15:26:17.722Z',
  ...overrides,
})

/** A search's JQL, read back from the URL it went to. */
const jqlOf = (url: string | undefined) => new URL(url ?? 'https://x').searchParams.get('jql')

describe('Jira, either edition', () => {
  it('reads a status’s category, telling a resolution that wasn’t done', () => {
    assert.deepStrictEqual(
      [
        categoryOf('new', 'To Do', null),
        categoryOf('new', 'Backlog', null),
        categoryOf('new', 'Needs Triage', null),
        categoryOf(undefined, 'Planning', null),
        categoryOf('indeterminate', 'Waiting for review', null),
        categoryOf('done', 'Closed', 'Fixed'),
        categoryOf('done', 'Done', null),
      ],
      ['todo', 'backlog', 'triage', 'todo', 'started', 'done', 'done'],
    )
    // Resolutions from the two public instances.
    for (const resolution of [
      "Won't Do",
      'Won’t Fix',
      'Duplicate',
      'Cannot Reproduce',
      'Invalid',
      'Not A Problem',
      'Rejected',
      'Out of Date',
    ])
      assert.strictEqual(categoryOf('done', 'Closed', resolution), 'cancelled', resolution)
    for (const resolution of ['Fixed', 'Done', 'Implemented', 'Resolved', 'Delivered'])
      assert.strictEqual(categoryOf('done', 'Resolved', resolution), 'done')
  })

  it('reads a priority’s level by its name, and a site’s own name as medium', () => {
    assert.deepStrictEqual(['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(levelOf), ['urgent', 'high', 'medium', 'low', 'low'])
    assert.deepStrictEqual(['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'].map(levelOf), ['urgent', 'high', 'medium', 'low', 'low'])
    assert.deepStrictEqual(['P0', 'P1', 'P2', 'P3', 'Normal', 'Not a Priority', 'Sev 2'].map(levelOf), [
      'urgent',
      'high',
      'medium',
      'low',
      'medium',
      'none',
      'medium',
    ])
  })
})

describe('Jira Cloud', () => {
  it.effect('says who it signs in as, with the account’s email and API token', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        [
          'GET',
          `${CLOUD}/myself`,
          {
            json: {
              self: `${CLOUD}/user?accountId=5b10a2844c20165700ede21g`,
              accountId: '5b10a2844c20165700ede21g',
              accountType: 'atlassian',
              emailAddress: 'you@meridian.dev',
              displayName: 'You Person',
              active: true,
              timeZone: 'Europe/London',
              locale: 'en_GB',
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* tracker.account, { id: '5b10a2844c20165700ede21g', login: 'you@meridian.dev', name: 'You Person' })
      assert.strictEqual(sent[0]?.headers.authorization, `Basic ${Buffer.from('you@meridian.dev:ATATT3x').toString('base64')}`)
      assert.strictEqual(sent[0]?.headers.accept, 'application/json')
      assert.strictEqual(tracker.product, 'jira_cloud')
    }),
  )

  it.effect('says who it signs in as when the account keeps its email to itself', () =>
    Effect.gen(function* () {
      const hidden = cloud([['GET', `${CLOUD}/myself`, { json: { accountId: 'a1', displayName: 'You Person' } }]])
      assert.strictEqual((yield* hidden.tracker.account).login, 'You Person')
      const bare = cloud([['GET', `${CLOUD}/myself`, { json: { accountId: 'a1' } }]])
      assert.deepStrictEqual(yield* bare.tracker.account, { id: 'a1', login: 'a1', name: null })
    }),
  )

  it.effect('reads an issue by its key, its description from ADF', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([['GET', `${CLOUD}/issue/HHH-20844?${FIELDS}`, { json: cloudIssue() }]])
      assert.deepStrictEqual(yield* tracker.issue('HHH-20844'), {
        id: '115161',
        ref: 'HHH-20844',
        key: 'HHH-20844',
        title: '@MapKey on an association whose target has a composite id fails during bootstrap',
        body: [
          'Building the `SessionFactory` aborts with a `java.lang.AssertionError`:',
          '',
          '```java',
          'java.lang.AssertionError',
          '    at org.hibernate.metamodel.mapping.internal.MappingModelCreationHelper.getPropertyOrder(MappingModelCreationHelper.java:1256)',
          '```',
          '',
          '## Trigger',
          '',
          'If the identifier is *not* composite, `getPropertyOrder` returns early.',
          '',
          '---',
          '',
          'Please find a reproducer attached.',
        ].join('\n'),
        url: 'https://hibernate.atlassian.net/browse/HHH-20844',
        status: { name: 'Waiting for review', category: 'started' },
        priority: { level: 'medium', name: 'Major' },
        assignees: [{ id: '557058:aafa2e9a-7a21-4c62-bf4a-050acb31276c', login: 'Steve Ebersole', name: 'Steve Ebersole', bot: false }],
        labels: ['good-first-issue'],
        container: 'Hibernate ORM',
        updatedAt: '2026-10-07T15:26:17.722Z',
      })
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('reads an issue by its key as typed, in lower case too', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([['GET', `${CLOUD}/issue/HHH-20844?${FIELDS}`, { json: cloudIssue() }]])
      assert.strictEqual((yield* tracker.issue(' hhh-20844 ')).ref, 'HHH-20844')
      assert.strictEqual(sent[0]?.url, `${CLOUD}/issue/HHH-20844?${FIELDS}`)
    }),
  )

  it.effect('takes a site by its origin, whatever page of it was pasted', () =>
    Effect.gen(function* () {
      const board = `${SITE}/jira/software/projects/HHH/boards/3`
      const { tracker, sent } = cloud(
        [
          ['GET', `${CLOUD}/issue/HHH-20844?${FIELDS}`, { status: 401, text: '' }],
          ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: '0aeb68bb-8040-48f1-9994-30e61701adb4' } }],
          ['GET', `${GATEWAY}/issue/HHH-20844?${FIELDS}`, { json: cloudIssue() }],
        ],
        board,
      )
      assert.strictEqual((yield* tracker.issue('HHH-20844')).url, 'https://hibernate.atlassian.net/browse/HHH-20844')
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${CLOUD}/issue/HHH-20844?${FIELDS}`, `${SITE}/_edge/tenant_info`, `${GATEWAY}/issue/HHH-20844?${FIELDS}`],
      )
      assert.strictEqual(siteOf(board), SITE)
      assert.strictEqual(siteOf('hibernate.atlassian.net/'), 'hibernate.atlassian.net')
    }),
  )

  it.effect('reads an issue with little filled in, and an app as a bot', () =>
    Effect.gen(function* () {
      const { tracker } = cloud([
        [
          'GET',
          `${CLOUD}/issue/HHH-1?${FIELDS}`,
          {
            json: cloudIssue({
              description: null,
              status: { name: 'Closed', statusCategory: { key: 'done' } },
              priority: undefined,
              assignee: { accountId: '557058:app', accountType: 'app' },
              labels: undefined,
              project: undefined,
              updated: 'last week',
              resolution: { name: 'Out of Date' },
            }),
          },
        ],
      ])
      const bare = yield* tracker.issue('HHH-1')
      assert.deepStrictEqual(
        [bare.body, bare.status, bare.priority, bare.assignees, bare.labels, bare.container, bare.updatedAt],
        [
          '',
          { name: 'Closed', category: 'cancelled' },
          null,
          [{ id: '557058:app', login: '557058:app', name: null, bot: true }],
          [],
          null,
          'last week',
        ],
      )
    }),
  )

  it.effect('lists the account’s open issues through /search/jql, newest change first, in a project when asked', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        [
          'GET',
          /\/rest\/api\/3\/search\/jql\?/,
          {
            json: {
              issues: [cloudIssue(), cloudIssue({ priority: { name: 'Minor', id: '4' } })],
              nextPageToken: 'Ck11cGRhdGVk',
              isLast: false,
            },
          },
        ],
      ])
      const mine = yield* tracker.mine({ limit: 5 })
      assert.deepStrictEqual(
        mine.map((found) => [found.key, found.priority?.level]),
        [
          ['HHH-20844', 'medium'],
          ['HHH-20844', 'low'],
        ],
      )
      assert.strictEqual(jqlOf(sent[0]?.url), 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')
      assert.include(sent[0]?.url, `&maxResults=5&${FIELDS}`)
      yield* tracker.mine({ container: 'Hibernate "ORM"' })
      assert.strictEqual(
        jqlOf(sent[1]?.url),
        'assignee = currentUser() AND statusCategory != Done AND project = "Hibernate \\"ORM\\"" ORDER BY updated DESC',
      )
      assert.include(sent[1]?.url, '&maxResults=50&')
    }),
  )

  it.effect('comments in ADF, and links a pull request as a remote link', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        ['POST', `${CLOUD}/issue/HHH-20844/comment`, { status: 201, json: { self: `${CLOUD}/issue/115161/comment/10000`, id: '10000' } }],
        [
          'POST',
          `${CLOUD}/issue/HHH-20844/remotelink`,
          { status: 201, json: { id: 10000, self: `${CLOUD}/issue/HHH-20844/remotelink/10000` } },
        ],
      ])
      yield* tracker.comment(issue(), 'Picked up by **Althar**.')
      assert.deepStrictEqual(sent[0]?.body, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Picked up by ' },
                { type: 'text', text: 'Althar', marks: [{ type: 'strong' }] },
                { type: 'text', text: '.' },
              ],
            },
          ],
        },
      })
      yield* tracker.link(issue(), { url: 'https://github.com/hibernate/hibernate-orm/pull/12', title: 'Fix @MapKey: #12' })
      assert.deepStrictEqual(sent[1]?.body, {
        globalId: 'https://github.com/hibernate/hibernate-orm/pull/12',
        object: { url: 'https://github.com/hibernate/hibernate-orm/pull/12', title: 'Fix @MapKey: #12' },
      })
      assert.isTrue(tracker.capabilities.links)
    }),
  )

  it.effect('says when the token is no longer good, or the issue isn’t there, in Jira’s words', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        ['GET', `${CLOUD}/myself`, { status: 401, text: 'Client must be authenticated to access this resource.' }],
        ['GET', `${SITE}/_edge/tenant_info`, { status: 503, text: '' }],
        [
          'GET',
          `${CLOUD}/issue/HHH-99999999?${FIELDS}`,
          { status: 404, json: { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} } },
        ],
      ])
      const signedOut = yield* Effect.flip(tracker.account)
      assert.deepStrictEqual([signedOut.reason, signedOut.status], ['unauthorized', 401])
      const missing = yield* Effect.flip(tracker.issue('HHH-99999999'))
      assert.deepStrictEqual(
        [missing.reason, missing.message],
        ['not_found', 'Issue does not exist or you do not have permission to see it.'],
      )
      // The site refused, so the gateway was asked for, once; it couldn't say.
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${CLOUD}/myself`, `${SITE}/_edge/tenant_info`, `${CLOUD}/issue/HHH-99999999?${FIELDS}`],
      )
    }),
  )

  it.effect('asks Atlassian’s gateway when the site refuses a scoped token, and keeps to it', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        ['GET', `${CLOUD}/myself`, { status: 401, text: 'Client must be authenticated to access this resource.' }],
        ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: '0aeb68bb-8040-48f1-9994-30e61701adb4' } }],
        ['GET', `${GATEWAY}/myself`, { json: { accountId: 'a1', emailAddress: 'you@meridian.dev', displayName: 'You Person' } }],
        ['GET', `${GATEWAY}/issue/HHH-20844?${FIELDS}`, { json: cloudIssue() }],
      ])
      assert.strictEqual((yield* tracker.account).login, 'you@meridian.dev')
      assert.strictEqual((yield* tracker.issue('HHH-20844')).url, 'https://hibernate.atlassian.net/browse/HHH-20844')
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${CLOUD}/myself`, `${SITE}/_edge/tenant_info`, `${GATEWAY}/myself`, `${GATEWAY}/issue/HHH-20844?${FIELDS}`],
      )
    }),
  )

  it.effect('keeps to the gateway once it judges a request, as not found or not allowed', () =>
    Effect.gen(function* () {
      for (const [status, reason] of [
        [404, 'not_found'],
        [403, 'forbidden'],
      ] as const) {
        const { tracker, sent } = cloud([
          ['GET', `${CLOUD}/issue/HHH-2?${FIELDS}`, { status: 401, text: '' }],
          ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: '0aeb68bb-8040-48f1-9994-30e61701adb4' } }],
          ['GET', `${GATEWAY}/issue/HHH-2?${FIELDS}`, { status, json: { errorMessages: ['Issue does not exist'], errors: {} } }],
          ['GET', `${GATEWAY}/myself`, { json: { accountId: 'a1' } }],
        ])
        assert.strictEqual((yield* Effect.flip(tracker.issue('HHH-2'))).reason, reason)
        yield* tracker.account
        assert.strictEqual(sent.at(-1)?.url, `${GATEWAY}/myself`)
      }
    }),
  )

  it.effect('asks the site first again when the gateway couldn’t say, and keeps the gateway once it answers', () =>
    Effect.gen(function* () {
      for (const [once, reason] of [
        [{ status: 503, text: '' }, 'unreachable'],
        [{ status: 429, headers: { 'retry-after': '30' }, json: { message: 'Too many requests' } }, 'rate_limited'],
      ] as const) {
        let asked = 0
        const { tracker, sent } = cloud([
          ['GET', `${CLOUD}/myself`, { status: 401, text: '' }],
          ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: '0aeb68bb-8040-48f1-9994-30e61701adb4' } }],
          ['GET', `${GATEWAY}/myself`, () => ((asked += 1) === 1 ? once : { json: { accountId: 'a1', displayName: 'You Person' } })],
        ])
        // The gateway's own failure, not the site's refusal: the token may well be good there.
        assert.strictEqual((yield* Effect.flip(tracker.account)).reason, reason)
        assert.strictEqual((yield* tracker.account).login, 'You Person')
        yield* tracker.account
        assert.deepStrictEqual(
          sent.map((request) => request.url),
          [
            `${CLOUD}/myself`,
            `${SITE}/_edge/tenant_info`,
            `${GATEWAY}/myself`,
            `${CLOUD}/myself`,
            `${SITE}/_edge/tenant_info`,
            `${GATEWAY}/myself`,
            `${GATEWAY}/myself`,
          ],
        )
      }
    }),
  )

  it.effect('keeps the site’s answer when the gateway refuses the token too', () =>
    Effect.gen(function* () {
      const { tracker, sent } = cloud([
        ['GET', `${CLOUD}/myself`, { status: 401, json: { message: 'Basic authentication with passwords is deprecated.' } }],
        ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: '0aeb68bb-8040-48f1-9994-30e61701adb4' } }],
        ['GET', `${GATEWAY}/myself`, { status: 401, json: { code: 401, message: 'Unauthorized' } }],
      ])
      const refused = yield* Effect.flip(tracker.account)
      assert.deepStrictEqual([refused.reason, refused.message], ['unauthorized', 'Basic authentication with passwords is deprecated.'])
      yield* Effect.flip(tracker.account)
      // Not kept: the site is asked first again.
      assert.strictEqual(sent[3]?.url, `${CLOUD}/myself`)
    }),
  )
})

describe('Jira Data Center', () => {
  it.effect('says who it signs in as, with a personal access token', () =>
    Effect.gen(function* () {
      const { tracker, sent } = dataCenter([
        [
          'GET',
          `${DC}/myself`,
          {
            json: {
              self: `${DC}/user?username=you`,
              key: 'JIRAUSER10100',
              name: 'you',
              emailAddress: 'you@meridian.dev',
              displayName: 'You Person',
              active: true,
              deleted: false,
              timeZone: 'Europe/London',
              locale: 'en_UK',
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* tracker.account, { id: 'JIRAUSER10100', login: 'you', name: 'You Person' })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer NjQ5pat')
      assert.strictEqual(tracker.product, 'jira_dc')
      const older = dataCenter([['GET', `${DC}/myself`, { json: { name: 'you' } }]])
      assert.deepStrictEqual(yield* older.tracker.account, { id: 'you', login: 'you', name: null })
    }),
  )

  it.effect('reads an issue by its key, its description from wiki markup', () =>
    Effect.gen(function* () {
      const { tracker } = dataCenter([['GET', `${DC}/issue/KAFKA-21043?${FIELDS}`, { json: dcIssue() }]])
      assert.deepStrictEqual(yield* tracker.issue('KAFKA-21043'), {
        id: '13665242',
        ref: 'KAFKA-21043',
        key: 'KAFKA-21043',
        title: '(SASL/OAUTHBEARER) LoginManager cache omits the class loader, so the credential refresh thread outlives its deployment',
        body: [
          '`LoginManager` caches instances by JAAS configuration, login class, login  ',
          'callback class and the `sasl.*` configs.',
          '',
          '### Sequence',
          '',
          '1. Deployment A creates a client. Its LoginManager is cached and  ',
          '   `ExpiringCredentialRefreshingLogin` starts a refresh thread.',
          '1. Deployment B creates a client with the same JAAS configuration.',
          '',
          '### Observed failure',
          '',
          '```java',
          'javax.security.auth.login.LoginException: java.lang.IllegalStateException: Trying to access closed classloader',
          '    at javax.security.auth.login.LoginContext.invoke(LoginContext.java:691)',
          '```',
          '',
          '| Change | Key |',
          '| --- | --- |',
          '| KIP-83 / KAFKA-4180 (0.10.2.0) | JAAS config |',
          '| KAFKA-14676 (3.3.3, 3.4.1, 3.5.0) | + all `sasl.*` configs |',
        ].join('\n'),
        url: 'https://issues.apache.org/jira/browse/KAFKA-21043',
        status: { name: 'Open', category: 'todo' },
        priority: { level: 'medium', name: 'Major' },
        assignees: [{ id: 'JIRAUSER314554', login: 'seokmoyoo', name: 'Seokmo Yoo', bot: false }],
        labels: [],
        container: 'Kafka',
        updatedAt: '2026-10-07T03:24:57.000Z',
      })
    }),
  )

  it.effect('reads an issue resolved as not done as cancelled', () =>
    Effect.gen(function* () {
      // KAFKA-1: Resolved, as Invalid.
      const { tracker } = dataCenter([
        [
          'GET',
          `${DC}/issue/KAFKA-1?${FIELDS}`,
          {
            json: dcIssue({
              description:
                'The log4j appender still uses the SyncProducer API. Change it to use the Producer API using the StringEncoder instead.',
              status: { name: 'Resolved', id: '5', statusCategory: { id: 3, key: 'done', name: 'Done' } },
              assignee: null,
              resolution: {
                self: `${DC}/resolution/6`,
                id: '6',
                description: 'The problem isn’t valid and it can’t be fixed.',
                name: 'Invalid',
              },
            }),
          },
        ],
      ])
      const resolved = yield* tracker.issue('KAFKA-1')
      assert.deepStrictEqual(resolved.status, { name: 'Resolved', category: 'cancelled' })
      assert.strictEqual(
        resolved.body,
        'The log4j appender still uses the SyncProducer API. Change it to use the Producer API using the StringEncoder instead.',
      )
      assert.deepStrictEqual(resolved.assignees, [])
    }),
  )

  it.effect('lists the account’s open issues through /search', () =>
    Effect.gen(function* () {
      const { tracker, sent } = dataCenter([
        [
          'GET',
          /\/rest\/api\/2\/search\?/,
          {
            json: {
              expand: 'schema,names',
              startAt: 0,
              maxResults: 50,
              total: 2,
              issues: [dcIssue(), dcIssue({ assignee: { name: 'jkreps' } })],
            },
          },
        ],
      ])
      assert.deepStrictEqual(
        (yield* tracker.mine({ container: 'Kafka' })).map((found) => found.assignees),
        [
          [{ id: 'JIRAUSER314554', login: 'seokmoyoo', name: 'Seokmo Yoo', bot: false }],
          [{ id: 'jkreps', login: 'jkreps', name: null, bot: false }],
        ],
      )
      assert.isTrue(sent[0]?.url.startsWith(`${DC}/search?jql=`))
      assert.strictEqual(
        jqlOf(sent[0]?.url),
        'assignee = currentUser() AND statusCategory != Done AND project = "Kafka" ORDER BY updated DESC',
      )
    }),
  )

  it.effect('comments in wiki markup, and links a pull request', () =>
    Effect.gen(function* () {
      const { tracker, sent } = dataCenter([
        [
          'POST',
          `${DC}/issue/KAFKA-21043/comment`,
          { status: 201, json: { self: `${DC}/issue/13665242/comment/18000000`, id: '18000000' } },
        ],
        ['POST', `${DC}/issue/KAFKA-21043/remotelink`, { json: { id: 700000, self: `${DC}/issue/KAFKA-21043/remotelink/700000` } }],
      ])
      const found = issue({ id: '13665242', ref: 'KAFKA-21043', key: 'KAFKA-21043' })
      yield* tracker.comment(found, 'Opened [a draft](https://github.com/apache/kafka/pull/1) for `LoginManager`.')
      assert.deepStrictEqual(sent[0]?.body, { body: 'Opened [a draft|https://github.com/apache/kafka/pull/1] for {{LoginManager}}.' })
      yield* tracker.link(found, { url: 'https://github.com/apache/kafka/pull/1', title: 'apache/kafka#1' })
      assert.deepStrictEqual(sent[1]?.body, {
        globalId: 'https://github.com/apache/kafka/pull/1',
        object: { url: 'https://github.com/apache/kafka/pull/1', title: 'apache/kafka#1' },
      })
    }),
  )

  it.effect('says when the token is no longer good, without a gateway to ask, or the issue isn’t there', () =>
    Effect.gen(function* () {
      const { tracker, sent } = dataCenter([
        [
          'GET',
          `${DC}/myself`,
          { status: 401, json: { message: 'Client must be authenticated to access this resource.', 'status-code': 401 } },
        ],
        ['GET', `${DC}/issue/KAFKA-99999999?${FIELDS}`, { status: 404, json: { errorMessages: ['Issue Does Not Exist'], errors: {} } }],
      ])
      const signedOut = yield* Effect.flip(tracker.account)
      assert.deepStrictEqual(
        [signedOut.reason, signedOut.message],
        ['unauthorized', 'Client must be authenticated to access this resource.'],
      )
      const missing = yield* Effect.flip(tracker.issue('KAFKA-99999999'))
      assert.deepStrictEqual([missing.reason, missing.message], ['not_found', 'Issue Does Not Exist'])
      assert.lengthOf(sent, 2)
    }),
  )
})
