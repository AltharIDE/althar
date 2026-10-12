import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { type AccessInput, type AccessReport, line } from '../src/access'
import { accessBitbucketCloud } from '../src/bitbucketCloud'
import { accessBitbucketDataCenter } from '../src/bitbucketDataCenter'
import type { Credential } from '../src/credential'
import { accessGitHub, classicTokenPage, expiryOf } from '../src/github'
import { accessGitLab, roleOf } from '../src/gitlab'
import type { Fetch } from '../src/http'
import { accessJira } from '../src/jira'
import { accessLinear } from '../src/linear'
import { probe, UNREADABLE, UNSAID } from '../src/probe'
import { products } from '../src/products'
import { makeFakeService } from '../src/testing'
import { accessTrello } from '../src/trello'
import { type Answer as Canned, type Route, stubFetch } from './stub'

/** What a check is asked with, on the product's hosted service, with a token and no repositories unless a test says. */
const inputOf = (fetch: Fetch, more: Partial<AccessInput> & Pick<AccessInput, 'apiUrl' | 'webUrl'>): AccessInput => ({
  fetch,
  hosted: true,
  credential: { kind: 'bearer', token: 'secret-token' },
  auth: 'token',
  repositories: [],
  ...more,
})

/** A fetch that never reaches the service. */
const offline: Fetch = () => Promise.reject(new TypeError('fetch failed'))

/** The lines' needs and states, where a test is about which lines there are. */
const states = (report: AccessReport) => report.lines.map((one) => `${one.need} ${one.state}`)

const reasonOf = (report: AccessReport, need: string) => report.lines.find((one) => one.need === need)?.reason

describe('asking a service', () => {
  it.effect('sends the credential in a header, never in the address, and keeps a refusal as an answer', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([['GET', 'https://api.example.com/thing', { status: 403, json: { message: 'Not yours' } }]])
      const answer = yield* probe(inputOf(fetch, { apiUrl: '', webUrl: '' }), 'https://api.example.com/thing', { headers: { x: 'y' } })
      assert.strictEqual(answer.status, 403)
      assert.strictEqual(answer.message, 'Not yours')
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer secret-token')
      assert.strictEqual(sent[0]?.headers.x, 'y')
      assert.notInclude(sent[0]?.url ?? '', 'secret-token')
    }),
  )

  it.effect('says why nothing answered: the network, or no answer in time', () =>
    Effect.gen(function* () {
      const nothing = yield* probe(inputOf(offline, { apiUrl: '', webUrl: '' }), 'https://api.example.com/thing')
      assert.deepInclude(nothing, { status: 0, message: 'TypeError: fetch failed', json: null })
      const silent: Fetch = () => new Promise(() => undefined)
      const fiber = yield* Effect.forkChild(probe(inputOf(silent, { apiUrl: '', webUrl: '' }), 'https://api.example.com/thing'))
      yield* TestClock.adjust('15 seconds')
      assert.deepInclude(yield* Fiber.join(fiber), { status: 0, message: 'The service did not answer in time' })
    }),
  )

  it.effect('reads a GraphQL query as a POST, and an answer that isn’t JSON as no JSON', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([['POST', 'https://api.example.com/graphql', { text: 'fine' }]])
      const answer = yield* probe(inputOf(fetch, { apiUrl: '', webUrl: '' }), 'https://api.example.com/graphql', { query: '{ a }' })
      assert.deepInclude(answer, { status: 200, json: null, message: '' })
      assert.deepStrictEqual(sent[0]?.body, { query: '{ a }' })
      assert.strictEqual(sent[0]?.headers['content-type'], 'application/json')
    }),
  )
})

const GH = 'https://api.github.com'
const NORTHWIND = `${GH}/repos/northwind/api`
const repository = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  full_name: 'northwind/api',
  default_branch: 'main',
  html_url: 'https://github.com/northwind/api',
  permissions: { push: true },
  ...overrides,
})

const gitHub = (routes: ReadonlyArray<Route>, more: Partial<AccessInput> = {}) => {
  const { fetch, sent } = stubFetch(routes)
  return { check: accessGitHub(inputOf(fetch, { apiUrl: GH, webUrl: 'https://github.com', ...more })), sent }
}

/** GitHub's `/user`, with the headers a token is described by. */
const me = (headers: Record<string, string> = {}): Route => ['GET', `${GH}/user`, { json: { id: 5, login: 'you', name: 'You' }, headers }]

describe('checking a GitHub connection', () => {
  it.effect('reads a classic token’s scopes and expiry, and every repository it sees', () =>
    Effect.gen(function* () {
      const { check, sent } = gitHub(
        [
          me({ 'x-oauth-scopes': 'repo, workflow', 'github-authentication-token-expiration': '2027-01-08 00:00:00 UTC' }),
          ['GET', NORTHWIND, { json: repository() }],
          ['GET', `${GH}/repos/Northwind/web`, { json: repository({ id: 8, full_name: 'northwind/web' }) }],
        ],
        {
          repositories: [
            ['northwind', 'api'],
            ['Northwind', 'web'],
          ],
        },
      )
      const report = yield* check
      assert.deepStrictEqual(report, {
        account: { id: '5', login: 'you', name: 'You' },
        lines: [
          line('account', 'ok', { fact: 'you' }),
          // Owners as GitHub spells them, once each.
          line('reach', 'ok', { fact: 'northwind' }),
          line('push', 'ok'),
          line('changes', 'ok'),
          line('checks', 'ok'),
          line('issues', 'ok'),
        ],
        expiresAt: '2027-01-08T00:00:00.000Z',
        scopes: ['repo', 'workflow'],
      })
      for (const request of sent) {
        assert.strictEqual(request.method, 'GET')
        assert.strictEqual(request.headers['x-github-api-version'], '2022-11-28')
        assert.strictEqual(request.headers.accept, 'application/vnd.github+json')
      }
    }),
  )

  it.effect('says which scope a classic token lacks, and where classic tokens are listed', () =>
    Effect.gen(function* () {
      const { check } = gitHub([me({ 'x-oauth-scopes': 'read:org' })])
      const report = yield* check
      const scope = { kind: 'scope', scope: 'repo', url: 'https://github.com/settings/tokens' } as const
      assert.deepStrictEqual(report.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('push', 'no', { reason: scope }),
        line('changes', 'no', { reason: scope }),
        line('checks', 'no', { reason: scope }),
        line('issues', 'no', { reason: scope }),
      ])
      // An OAuth token with no scopes says so with an empty header: still a token with scopes, none of them.
      const bare = yield* gitHub([me({ 'x-oauth-scopes': '' })]).check
      assert.deepStrictEqual(bare.scopes, [])
      assert.deepStrictEqual(reasonOf(bare, 'push'), scope)
    }),
  )

  it.effect('stops at the account where GitHub doesn’t take the token, or can’t be asked', () =>
    Effect.gen(function* () {
      const refused = yield* gitHub([['GET', `${GH}/user`, { status: 401, json: { message: 'Bad credentials' } }]]).check
      assert.deepStrictEqual(refused, {
        account: null,
        lines: [line('account', 'no', { reason: { kind: 'refused' } })],
        expiresAt: null,
        scopes: null,
      })
      const down = yield* gitHub([['GET', `${GH}/user`, { status: 502, json: { message: 'Server Error' } }]]).check
      assert.deepStrictEqual(down.lines, [line('account', 'no', { reason: { kind: 'failed', message: 'Server Error' } })])
      const odd = yield* gitHub([['GET', `${GH}/user`, { json: { login: 'you' } }]]).check
      assert.deepStrictEqual(odd.lines, [line('account', 'no', { reason: UNREADABLE })])
      const offlineCheck = yield* accessGitHub(inputOf(offline, { apiUrl: GH, webUrl: 'https://github.com' }))
      assert.deepStrictEqual(offlineCheck.lines, [
        line('account', 'no', { reason: { kind: 'failed', message: 'TypeError: fetch failed' } }),
      ])
    }),
  )

  it.effect('signed in by Althar’s GitHub App, says where it isn’t installed', () =>
    Effect.gen(function* () {
      const routes: ReadonlyArray<Route> = [
        me({ 'github-authentication-token-expiration': '2026-10-11 17:00:00 +0200' }),
        ['GET', NORTHWIND, { status: 404, json: { message: 'Not Found' } }],
      ]
      const installed = gitHub(routes, { auth: 'device_flow', appSlug: 'althar', repositories: [['northwind', 'api']] })
      const report = yield* installed.check
      assert.deepStrictEqual(report.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('reach', 'no', {
          reason: { kind: 'not_installed', owner: 'northwind', url: 'https://github.com/apps/althar/installations/new' },
        }),
        line('push', 'ok'),
        line('changes', 'ok'),
        line('checks', 'ok'),
        line('issues', 'ok'),
      ])
      assert.strictEqual(report.expiresAt, '2026-10-11T15:00:00.000Z')
      assert.isNull(report.scopes)
      const unnamed = yield* gitHub(routes, { auth: 'device_flow', repositories: [['northwind', 'api']] }).check
      assert.deepStrictEqual(reasonOf(unnamed, 'reach'), { kind: 'not_installed', owner: 'northwind', url: null })
    }),
  )

  it.effect('says an owner restricts OAuth apps, asks for SAML, or GitHub limited the rate', () =>
    Effect.gen(function* () {
      const routes: ReadonlyArray<Route> = [
        me({ 'x-oauth-scopes': 'repo' }),
        [
          'GET',
          `${GH}/repos/acme/api`,
          {
            status: 403,
            json: {
              message:
                'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.',
            },
          },
        ],
        [
          'GET',
          `${GH}/repos/initech/api`,
          {
            status: 403,
            headers: { 'x-github-sso': 'required; url=https://github.com/orgs/initech/sso?authorization_request=abc' },
            json: { message: 'Resource protected by organization SAML enforcement.' },
          },
        ],
        [
          'GET',
          `${GH}/repos/hooli/api`,
          { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } },
        ],
        ['GET', `${GH}/repos/globex/api`, { status: 403, json: { message: 'Must have admin rights' } }],
      ]
      const reach = (owner: string) =>
        Effect.map(gitHub(routes, { repositories: [[owner, 'api']] }).check, (report) => reasonOf(report, 'reach'))
      assert.deepStrictEqual(yield* reach('acme'), { kind: 'restricted', owner: 'acme' })
      assert.deepStrictEqual(yield* reach('initech'), {
        kind: 'sso',
        owner: 'initech',
        url: 'https://github.com/orgs/initech/sso?authorization_request=abc',
      })
      assert.deepStrictEqual(yield* reach('hooli'), { kind: 'failed', message: 'API rate limit exceeded' })
      assert.deepStrictEqual(yield* reach('globex'), { kind: 'failed', message: 'Must have admin rights' })
    }),
  )

  it.effect('names together every repository a token doesn’t see, after the first reason', () =>
    Effect.gen(function* () {
      const { check } = gitHub(
        [
          me(),
          ['GET', `${GH}/repos/northwind/web`, { status: 404, json: { message: 'Not Found' } }],
          ['GET', NORTHWIND, { status: 404, json: { message: 'Not Found' } }],
          ['GET', `${GH}/repos/northwind/ops`, { json: { id: 9 } }],
        ],
        {
          repositories: [
            ['northwind', 'web'],
            ['northwind', 'ops'],
            ['northwind', 'api'],
          ],
        },
      )
      // A fine-grained token is put right where fine-grained tokens are listed: the same page the product names.
      assert.deepStrictEqual(reasonOf(yield* check, 'reach'), {
        kind: 'unseen',
        names: ['northwind/web', 'northwind/api'],
        url: products.github.token.settings('https://github.com'),
      })
      const server = stubFetch([
        ['GET', 'https://git.northwind.dev/api/v3/user', { json: { id: 5, login: 'you' } }],
        ['GET', 'https://git.northwind.dev/api/v3/repos/northwind/api', { status: 404, json: { message: 'Not Found' } }],
      ])
      const onServer = yield* accessGitHub(
        inputOf(server.fetch, {
          apiUrl: 'https://git.northwind.dev/api/v3/',
          webUrl: 'https://git.northwind.dev/',
          hosted: false,
          repositories: [['northwind', 'api']],
        }),
      )
      assert.deepStrictEqual(reasonOf(onServer, 'reach'), {
        kind: 'unseen',
        names: ['northwind/api'],
        url: products.github.token.settings('https://git.northwind.dev'),
      })
    }),
  )

  it.effect('says the account itself may not push, whatever the token', () =>
    Effect.gen(function* () {
      const { check } = gitHub(
        [me({ 'x-oauth-scopes': 'repo' }), ['GET', NORTHWIND, { json: repository({ permissions: { push: false } }) }]],
        { repositories: [['northwind', 'api']] },
      )
      const report = yield* check
      assert.deepStrictEqual(reasonOf(report, 'push'), { kind: 'role', role: null })
      assert.deepStrictEqual(states(report), ['account ok', 'reach ok', 'push no', 'changes ok', 'checks ok', 'issues ok'])
    }),
  )

  /** A fine-grained token's check of northwind/api, each read answered as a test says. */
  const fine = (answers: { pulls?: number; runs?: number; status?: number; actions?: number; issues?: number }) =>
    gitHub(
      [
        me(),
        ['GET', NORTHWIND, { json: repository({ default_branch: 'release/2' }) }],
        ['GET', `${NORTHWIND}/pulls?per_page=1&state=all`, { status: answers.pulls ?? 200, json: [] }],
        ['GET', `${NORTHWIND}/commits/release%2F2/check-runs?per_page=1`, { status: answers.runs ?? 200, json: { check_runs: [] } }],
        ['GET', `${NORTHWIND}/commits/release%2F2/status`, { status: answers.status ?? 200, json: { statuses: [] } }],
        ['GET', `${NORTHWIND}/actions/runs?per_page=1`, { status: answers.actions ?? 200, json: { workflow_runs: [] } }],
        ['GET', `${NORTHWIND}/issues?per_page=1`, { status: answers.issues ?? 200, json: [] }],
      ],
      { repositories: [['northwind', 'api']] },
    ).check

  it.effect('reads what a fine-grained token may, and says its writes are unknown', () =>
    Effect.gen(function* () {
      const report = yield* fine({})
      assert.deepStrictEqual(report.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('reach', 'ok', { fact: 'northwind' }),
        line('push', 'unknown', { reason: UNSAID }),
        line('changes', 'unknown', { reason: UNSAID }),
        line('checks', 'ok'),
        line('issues', 'unknown', { reason: UNSAID }),
      ])
      assert.isNull(report.scopes)
      assert.isNull(report.expiresAt)
    }),
  )

  it.effect('says which permission a fine-grained token wasn’t given, and that it gets no check runs', () =>
    Effect.gen(function* () {
      const settings = 'https://github.com/settings/personal-access-tokens'
      const refused = yield* fine({ pulls: 403, runs: 403, issues: 403 })
      assert.deepStrictEqual(reasonOf(refused, 'changes'), { kind: 'permission', permission: 'Pull requests', url: settings })
      assert.deepStrictEqual(reasonOf(refused, 'checks'), { kind: 'no_check_runs', url: classicTokenPage('https://github.com') })
      assert.deepStrictEqual(reasonOf(refused, 'issues'), { kind: 'permission', permission: 'Issues', url: settings })
      assert.deepStrictEqual(reasonOf(yield* fine({ status: 403 }), 'checks'), {
        kind: 'permission',
        permission: 'Commit statuses',
        url: settings,
      })
      assert.deepStrictEqual(reasonOf(yield* fine({ actions: 403 }), 'checks'), {
        kind: 'permission',
        permission: 'Actions',
        url: settings,
      })
      // Something that went wrong on the way is said as it is, not as a permission.
      assert.deepStrictEqual(reasonOf(yield* fine({ runs: 500, pulls: 500 }), 'checks'), { kind: 'failed', message: '500' })
      assert.deepStrictEqual(reasonOf(yield* fine({ pulls: 500 }), 'changes'), { kind: 'failed', message: '500' })
    }),
  )

  it.effect('says a fine-grained token’s lines are unknown where it sees no repository to ask', () =>
    Effect.gen(function* () {
      const report = yield* gitHub([me()]).check
      assert.deepStrictEqual(report.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('push', 'unknown', { reason: UNSAID }),
        line('changes', 'unknown', { reason: UNSAID }),
        line('checks', 'unknown', { reason: UNSAID }),
        line('issues', 'unknown', { reason: UNSAID }),
      ])
    }),
  )

  it('reads when a token runs out, as GitHub writes it', () => {
    assert.strictEqual(expiryOf('2027-01-08 00:00:00 UTC'), '2027-01-08T00:00:00.000Z')
    assert.strictEqual(expiryOf('2023-03-08 13:28:54 +0100'), '2023-03-08T12:28:54.000Z')
    assert.strictEqual(expiryOf('2023-03-08 13:28:54 -05:30'), '2023-03-08T18:58:54.000Z')
    assert.isNull(expiryOf(null))
    assert.isNull(expiryOf('soon'))
    assert.isNull(expiryOf('2023-13-45 99:00:00 UTC'))
  })
})

const GL = 'https://gitlab.com/api/v4'
const project = (path: string, project: number | null, group: number | null) => ({
  id: 1,
  path_with_namespace: path,
  web_url: `https://gitlab.com/${path}`,
  permissions: {
    project_access: project === null ? null : { access_level: project },
    group_access: group === null ? null : { access_level: group },
  },
})
const gitLabUser: Route = ['GET', `${GL}/user`, { json: { id: 5, username: 'you', name: 'You' } }]

const gitLab = (routes: ReadonlyArray<Route>, more: Partial<AccessInput> = {}) => {
  const { fetch, sent } = stubFetch(routes)
  return { check: accessGitLab(inputOf(fetch, { apiUrl: GL, webUrl: 'https://gitlab.com', ...more })), sent }
}

describe('checking a GitLab connection', () => {
  it.effect('reads a personal access token’s scopes and last day, and the least role among the projects', () =>
    Effect.gen(function* () {
      const { check } = gitLab(
        [
          gitLabUser,
          ['GET', `${GL}/personal_access_tokens/self`, { json: { scopes: ['api'], expires_at: '2026-12-31' } }],
          ['GET', `${GL}/projects/northwind%2Fapi`, { json: project('northwind/api', 30, 40) }],
          ['GET', `${GL}/projects/northwind%2Fplatform%2Fweb`, { json: project('northwind/platform/web', null, 30) }],
        ],
        {
          repositories: [
            ['northwind', 'api'],
            ['northwind', 'platform', 'web'],
          ],
        },
      )
      assert.deepStrictEqual(yield* check, {
        account: { id: '5', login: 'you', name: 'You' },
        lines: [
          line('account', 'ok', { fact: 'you' }),
          line('reach', 'ok', { fact: 'Developer' }),
          line('push', 'ok'),
          line('changes', 'ok'),
          line('checks', 'ok'),
          line('issues', 'ok'),
        ],
        expiresAt: '2026-12-31T00:00:00.000Z',
        scopes: ['api'],
      })
    }),
  )

  it.effect('reads an OAuth token’s scopes at the token info, and says which scope is missing', () =>
    Effect.gen(function* () {
      const { check, sent } = gitLab([
        gitLabUser,
        ['GET', `${GL}/personal_access_tokens/self`, { status: 401, json: { message: '401 Unauthorized' } }],
        ['GET', 'https://gitlab.com/oauth/token/info', { json: { scope: ['read_api'], expires_in: 7200 } }],
      ])
      const report = yield* check
      const scope = (name: string) => ({ kind: 'scope', scope: name, url: products.gitlab.token.settings('https://gitlab.com') }) as const
      assert.deepStrictEqual(report.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('push', 'no', { reason: scope('api') }),
        line('changes', 'no', { reason: scope('api') }),
        line('checks', 'ok'),
        line('issues', 'no', { reason: scope('api') }),
      ])
      // Two hours from now, by Effect's clock.
      assert.strictEqual(report.expiresAt, '1970-01-01T02:00:00.000Z')
      assert.deepStrictEqual(report.scopes, ['read_api'])
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${GL}/user`, `${GL}/personal_access_tokens/self`, 'https://gitlab.com/oauth/token/info'],
      )
      const reader = yield* gitLab([
        gitLabUser,
        ['GET', `${GL}/personal_access_tokens/self`, { json: { scopes: ['read_repository'], expires_at: null } }],
      ]).check
      assert.deepStrictEqual(reasonOf(reader, 'checks'), scope('read_api'))
      assert.isNull(reader.expiresAt)
    }),
  )

  it.effect('says what a token may do isn’t known where it won’t say its scopes, and a token that never runs out as such', () =>
    Effect.gen(function* () {
      // Without its scopes, what the token may do isn't known.
      const unsaid = yield* gitLab([gitLabUser]).check
      assert.deepStrictEqual(states(unsaid), ['account ok', 'push unknown', 'changes unknown', 'checks unknown', 'issues unknown'])
      assert.deepStrictEqual(unsaid.lines[1]?.reason, { kind: 'unreadable' })
      assert.isNull(unsaid.scopes)
      const forever = yield* gitLab([
        gitLabUser,
        ['GET', `${GL}/personal_access_tokens/self`, { status: 404, json: { message: '404 Not Found' } }],
        ['GET', 'https://gitlab.com/oauth/token/info', { json: { scope: ['api'], expires_in: null } }],
      ]).check
      assert.isNull(forever.expiresAt)
      const odd = yield* gitLab([
        gitLabUser,
        ['GET', `${GL}/personal_access_tokens/self`, { json: { scopes: ['api'], expires_at: 'someday' } }],
      ]).check
      assert.isNull(odd.expiresAt)
    }),
  )

  it.effect('says a role that doesn’t push, merge or open by its name', () =>
    Effect.gen(function* () {
      const report = yield* gitLab(
        [
          gitLabUser,
          ['GET', `${GL}/personal_access_tokens/self`, { json: { scopes: ['api'] } }],
          ['GET', `${GL}/projects/northwind%2Fapi`, { json: project('northwind/api', 20, null) }],
        ],
        { repositories: [['northwind', 'api']] },
      ).check
      assert.deepStrictEqual(report.lines.slice(1), [
        line('reach', 'ok', { fact: 'Reporter' }),
        line('push', 'no', { reason: { kind: 'role', role: 'Reporter' } }),
        line('changes', 'no', { reason: { kind: 'role', role: 'Reporter' } }),
        line('checks', 'ok'),
        line('issues', 'ok'),
      ])
      assert.strictEqual(roleOf(0), 'No access')
      assert.strictEqual(roleOf(15), 'Planner')
      assert.strictEqual(roleOf(60), 'Level 60')
    }),
  )

  it.effect('on a company’s own server, says first that it answers', () =>
    Effect.gen(function* () {
      const server = { apiUrl: 'https://gitlab.northwind.dev/api/v4', webUrl: 'https://gitlab.northwind.dev/', hosted: false }
      const { fetch } = stubFetch([['GET', 'https://gitlab.northwind.dev/api/v4/user', { json: { id: 5, username: 'you' } }]])
      const report = yield* accessGitLab(inputOf(fetch, server))
      assert.deepStrictEqual(report.lines.slice(0, 2), [
        line('server', 'ok', { fact: 'gitlab.northwind.dev' }),
        line('account', 'ok', { fact: 'you' }),
      ])
      assert.deepStrictEqual(report.account, { id: '5', login: 'you', name: null })
      const away = yield* accessGitLab(inputOf(offline, server))
      assert.deepStrictEqual(away, {
        account: null,
        lines: [line('server', 'no', { fact: 'gitlab.northwind.dev', reason: { kind: 'failed', message: 'TypeError: fetch failed' } })],
        expiresAt: null,
        scopes: null,
      })
      const refused = stubFetch([
        ['GET', 'https://gitlab.northwind.dev/api/v4/user', { status: 401, json: { message: '401 Unauthorized' } }],
      ])
      assert.deepStrictEqual(states(yield* accessGitLab(inputOf(refused.fetch, server))), ['server ok', 'account no'])
    }),
  )

  it.effect('stops at the account where GitLab doesn’t take the token, or it can’t read who it is', () =>
    Effect.gen(function* () {
      const refused = yield* gitLab([['GET', `${GL}/user`, { status: 401, json: { message: '401 Unauthorized' } }]]).check
      assert.deepStrictEqual(refused.lines, [line('account', 'no', { reason: { kind: 'refused' } })])
      const scoped = yield* gitLab([
        [
          'GET',
          `${GL}/user`,
          {
            status: 403,
            json: { error: 'insufficient_scope', error_description: 'The request requires higher privileges.', scope: 'api read_user' },
          },
        ],
      ]).check
      assert.deepStrictEqual(scoped.lines, [
        line('account', 'no', {
          reason: { kind: 'scope', scope: 'read_user', url: 'https://gitlab.com/-/user_settings/personal_access_tokens' },
        }),
      ])
      const blocked = yield* gitLab([
        ['GET', `${GL}/user`, { status: 403, json: { message: '403 Forbidden - Your account has been blocked.' } }],
      ]).check
      assert.deepStrictEqual(reasonOf(blocked, 'account'), { kind: 'failed', message: '403 Forbidden - Your account has been blocked.' })
      const odd = yield* gitLab([['GET', `${GL}/user`, { json: { id: 'five' } }]]).check
      assert.deepStrictEqual(reasonOf(odd, 'account'), UNREADABLE)
    }),
  )

  it.effect('says why it doesn’t reach a project: unseen, a scope, or GitLab’s own words', () =>
    Effect.gen(function* () {
      const reach = (answer: Canned) =>
        Effect.map(
          gitLab([gitLabUser, ['GET', `${GL}/projects/northwind%2Fapi`, answer]], { repositories: [['northwind', 'api']] }).check,
          (report) => reasonOf(report, 'reach'),
        )
      assert.deepStrictEqual(yield* reach({ status: 404, json: { message: '404 Project Not Found' } }), {
        kind: 'unseen',
        names: ['northwind/api'],
        url: null,
      })
      assert.deepStrictEqual(yield* reach({ status: 403, json: { error: 'insufficient_scope' } }), {
        kind: 'scope',
        scope: 'read_api',
        url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      })
      assert.deepStrictEqual(yield* reach({ status: 500, json: { message: '500 Internal Server Error' } }), {
        kind: 'failed',
        message: '500 Internal Server Error',
      })
      assert.deepStrictEqual(yield* reach({ json: { id: 1 } }), UNREADABLE)
      // A public project the account isn't a member of: seen, with no role in it.
      const outsider = yield* gitLab(
        [gitLabUser, ['GET', `${GL}/projects/northwind%2Fapi`, { json: { ...project('northwind/api', null, null), permissions: null } }]],
        {
          repositories: [['northwind', 'api']],
        },
      ).check
      assert.deepStrictEqual(outsider.lines[1], line('reach', 'ok', { fact: 'No access' }))
      assert.deepStrictEqual(reasonOf(outsider, 'push'), { kind: 'role', role: 'No access' })
    }),
  )
})

const BB = 'https://api.bitbucket.org/2.0'
const BB_REPO = `${BB}/repositories/northwind/api`
/** Every scope Althar's token is made with. */
const ALTHARS = [
  'read:user:bitbucket',
  'read:workspace:bitbucket',
  'read:repository:bitbucket',
  'write:repository:bitbucket',
  'read:pullrequest:bitbucket',
  'write:pullrequest:bitbucket',
  'read:pipeline:bitbucket',
]
/** Bitbucket's refusal of a token without a scope, with what it was given and what the call needs. */
const lacking = (granted: ReadonlyArray<string> | undefined, required: ReadonlyArray<string> | undefined): Canned => ({
  status: 403,
  json: {
    type: 'error',
    error: {
      message: 'Your credentials lack one or more required privilege scopes.',
      detail: { ...(granted === undefined ? {} : { granted }), ...(required === undefined ? {} : { required }) },
    },
  },
})
const permissionOf = (permission: string): Route => [
  'GET',
  `${BB}/user/workspaces/northwind/permissions/repositories?q=${encodeURIComponent('repository.name = "api"')}`,
  { json: { values: [{ permission, repository: { full_name: 'northwind/api' } }] } },
]

/** A Bitbucket Cloud check of northwind/api, each answer as a test says. */
const bitbucket = (
  answers: {
    user?: Canned
    repository?: Canned
    permission?: string | Canned
    pulls?: Canned
    pipelines?: Canned
    hooks?: Canned
  },
  repositories: ReadonlyArray<ReadonlyArray<string>> = [['northwind', 'api']],
) => {
  const { fetch, sent } = stubFetch([
    ['GET', `${BB}/user`, answers.user ?? { json: { uuid: '{u1}', display_name: 'You', nickname: 'you' } }],
    [
      'GET',
      BB_REPO,
      answers.repository ?? {
        json: { uuid: '{r1}', full_name: 'northwind/api', name: 'api', links: { html: { href: 'https://bitbucket.org/northwind/api' } } },
      },
    ],
    typeof answers.permission === 'object'
      ? [permissionOf('write')[0], permissionOf('write')[1], answers.permission]
      : permissionOf(answers.permission ?? 'write'),
    ['GET', `${BB_REPO}/pullrequests?pagelen=1`, answers.pulls ?? { json: { values: [] } }],
    ['GET', `${BB_REPO}/pipelines/?pagelen=1`, answers.pipelines ?? { json: { values: [] } }],
    ['GET', `${BB}/workspaces/northwind/hooks`, answers.hooks ?? lacking(ALTHARS, ['read:webhook:bitbucket'])],
  ])
  const credential: Credential = { kind: 'basic', user: 'you@northwind.dev', token: 'ATATT-secret' }
  return {
    check: accessBitbucketCloud(inputOf(fetch, { apiUrl: BB, webUrl: 'https://bitbucket.org', credential, repositories })),
    sent,
  }
}

describe('checking a Bitbucket Cloud connection', () => {
  const scope = (name: string) =>
    ({ kind: 'scope', scope: name, url: products.bitbucket_cloud.token.settings('https://bitbucket.org') }) as const

  it.effect('learns the token’s scopes from a read it isn’t made for, and the account’s permission from its workspace', () =>
    Effect.gen(function* () {
      const { check, sent } = bitbucket({})
      assert.deepStrictEqual(yield* check, {
        account: { id: '{u1}', login: 'you', name: 'You' },
        lines: [
          line('account', 'ok', { fact: 'you' }),
          line('reach', 'ok', { fact: 'write' }),
          line('push', 'ok'),
          line('changes', 'ok'),
          line('checks', 'ok'),
        ],
        expiresAt: null,
        scopes: ALTHARS,
      })
      assert.isTrue(sent.every((request) => request.method === 'GET'))
      assert.strictEqual(sent[0]?.headers.authorization, `Basic ${Buffer.from('you@northwind.dev:ATATT-secret').toString('base64')}`)
    }),
  )

  it.effect('stops at the account where Bitbucket doesn’t take the token, or it lacks the scope to say who', () =>
    Effect.gen(function* () {
      const refused = yield* bitbucket({ user: { status: 401, text: '' } }).check
      assert.deepStrictEqual(refused.lines, [line('account', 'no', { reason: { kind: 'refused' } })])
      const scoped = yield* bitbucket({ user: lacking(['read:repository:bitbucket'], ['read:user:bitbucket']) }).check
      assert.deepStrictEqual(scoped, {
        account: null,
        lines: [line('account', 'no', { reason: scope('read:user:bitbucket') })],
        expiresAt: null,
        scopes: ['read:repository:bitbucket'],
      })
      // Refused without saying which: the scope Althar knows it needs.
      const bare = yield* bitbucket({ user: { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } } }).check
      assert.deepStrictEqual(bare.lines, [line('account', 'no', { reason: scope('read:user:bitbucket') })])
      assert.isNull(bare.scopes)
      const limited = yield* bitbucket({ user: { status: 429, text: 'Rate limit for this resource has been exceeded' } }).check
      assert.deepStrictEqual(reasonOf(limited, 'account'), { kind: 'failed', message: 'Rate limit for this resource has been exceeded' })
      const odd = yield* bitbucket({ user: { json: [] } }).check
      assert.deepStrictEqual(reasonOf(odd, 'account'), UNREADABLE)
    }),
  )

  it.effect('says a read permission pushes and merges nothing', () =>
    Effect.gen(function* () {
      const report = yield* bitbucket({ permission: 'read' }).check
      assert.deepStrictEqual(report.lines.slice(1), [
        line('reach', 'ok', { fact: 'read' }),
        line('push', 'no', { reason: { kind: 'role', role: 'read' } }),
        line('changes', 'no', { reason: { kind: 'role', role: 'read' } }),
        line('checks', 'ok'),
      ])
    }),
  )

  it.effect('says which write scope the token wasn’t given, and takes Pipelines off as nothing to read', () =>
    Effect.gen(function* () {
      const report = yield* bitbucket({
        hooks: lacking(['read:user:bitbucket', 'read:repository:bitbucket', 'read:pullrequest:bitbucket'], ['read:webhook:bitbucket']),
        pipelines: { status: 404, json: { type: 'error', error: { message: 'Not found' } } },
      }).check
      assert.deepStrictEqual(report.lines.slice(2), [
        line('push', 'no', { reason: scope('write:repository:bitbucket') }),
        line('changes', 'no', { reason: scope('write:pullrequest:bitbucket') }),
        line('checks', 'ok'),
      ])
    }),
  )

  it.effect('says which read scope a refused pull request or pipeline needs, without asking further', () =>
    Effect.gen(function* () {
      const { check, sent } = bitbucket({
        pulls: lacking(['read:user:bitbucket', 'read:repository:bitbucket'], ['read:pullrequest:bitbucket']),
        pipelines: { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } },
      })
      const report = yield* check
      assert.deepStrictEqual(report.lines.slice(2), [
        line('push', 'no', { reason: scope('write:repository:bitbucket') }),
        line('changes', 'no', { reason: scope('read:pullrequest:bitbucket') }),
        line('checks', 'no', { reason: scope('read:pipeline:bitbucket') }),
      ])
      assert.deepStrictEqual(report.scopes, ['read:user:bitbucket', 'read:repository:bitbucket'])
      assert.isFalse(sent.some((request) => request.url.endsWith('/hooks')))
    }),
  )

  it.effect('says what it can’t tell where nothing says which scopes it was given', () =>
    Effect.gen(function* () {
      const told = yield* bitbucket({ hooks: { json: { values: [] } } }).check
      assert.deepStrictEqual(states(told), ['account ok', 'reach ok', 'push ok', 'changes unknown', 'checks ok'])
      assert.isNull(told.scopes)
      // The account's permission unsaid as well: a push is unknown too.
      const unsaid = yield* bitbucket({ hooks: { json: { values: [] } }, permission: { status: 500, text: 'down' } }).check
      assert.deepStrictEqual(unsaid.lines[1], line('reach', 'ok', { fact: null }))
      assert.deepStrictEqual(states(unsaid).slice(2), ['push unknown', 'changes unknown', 'checks ok'])
      const nothing = yield* bitbucket({}, []).check
      assert.deepStrictEqual(states(nothing), ['account ok', 'push unknown', 'changes unknown', 'checks unknown'])
    }),
  )

  it.effect('says why it doesn’t reach a repository, and still learns the scopes from its workspace', () =>
    Effect.gen(function* () {
      const unseen = yield* bitbucket({ repository: { status: 404, json: { type: 'error', error: { message: 'Not found' } } } }).check
      assert.deepStrictEqual(unseen.lines, [
        line('account', 'ok', { fact: 'you' }),
        line('reach', 'no', { reason: { kind: 'unseen', names: ['northwind/api'], url: null } }),
        // Its permission is said only of a repository it sees.
        line('push', 'unknown', { reason: UNSAID }),
        line('changes', 'ok'),
        line('checks', 'ok'),
      ])
      const unpiped = yield* bitbucket({
        repository: { status: 404, json: {} },
        hooks: lacking(['read:repository:bitbucket'], ['read:webhook:bitbucket']),
      }).check
      assert.deepStrictEqual(states(unpiped).slice(1), ['reach no', 'push no', 'changes no', 'checks no'])
      assert.deepStrictEqual(reasonOf(unpiped, 'checks'), scope('read:pipeline:bitbucket'))
      const scoped = yield* bitbucket({ repository: lacking(['read:user:bitbucket'], ['read:repository:bitbucket']) }).check
      assert.deepStrictEqual(reasonOf(scoped, 'reach'), scope('read:repository:bitbucket'))
      const down = yield* bitbucket({ repository: { status: 500, text: 'down' } }).check
      assert.deepStrictEqual(reasonOf(down, 'reach'), { kind: 'failed', message: 'down' })
      const odd = yield* bitbucket({ repository: { json: { uuid: 1 } } }).check
      assert.deepStrictEqual(reasonOf(odd, 'reach'), UNREADABLE)
    }),
  )

  it.effect('says what went wrong reading pull requests or pipelines', () =>
    Effect.gen(function* () {
      const report = yield* bitbucket({ pulls: { status: 500, text: 'down' }, pipelines: { status: 502, text: 'gateway' } }).check
      assert.deepStrictEqual(reasonOf(report, 'changes'), { kind: 'failed', message: 'down' })
      assert.deepStrictEqual(reasonOf(report, 'checks'), { kind: 'failed', message: 'gateway' })
    }),
  )
})

const DC = 'https://git.northwind.dev/rest/api/latest'
const signedInAs: Canned = { json: { version: '8.19.0', displayName: 'Bitbucket' }, headers: { 'x-ausername': 'you', 'x-auserid': '7' } }

/** A Bitbucket Data Center check of PAY/api, each answer as a test says. */
const dataCenter = (
  answers: { properties?: Canned; users?: Canned; repository?: Canned; writable?: Canned },
  repositories: ReadonlyArray<ReadonlyArray<string>> = [['PAY', 'api']],
) => {
  const { fetch, sent } = stubFetch([
    ['GET', `${DC}/application-properties`, answers.properties ?? signedInAs],
    ['GET', `${DC}/users?filter=you&limit=100`, answers.users ?? { json: { values: [{ id: 7, name: 'you', displayName: 'You' }] } }],
    ['GET', `${DC}/projects/PAY/repos/api`, answers.repository ?? { json: { id: 1, slug: 'api', name: 'API', project: { key: 'PAY' } } }],
    ['GET', `${DC}/repos?projectkey=PAY&name=API&permission=REPO_WRITE&limit=100`, answers.writable ?? { json: { values: [{ id: 1 }] } }],
  ])
  return {
    check: accessBitbucketDataCenter(inputOf(fetch, { apiUrl: DC, webUrl: 'https://git.northwind.dev', hosted: false, repositories })),
    sent,
  }
}

describe('checking a Bitbucket Data Center connection', () => {
  it.effect('says its server answers and who signs in, and that a token’s own permission isn’t said', () =>
    Effect.gen(function* () {
      const { check, sent } = dataCenter({})
      assert.deepStrictEqual(yield* check, {
        account: { id: '7', login: 'you', name: 'You' },
        lines: [
          line('server', 'ok', { fact: 'git.northwind.dev' }),
          line('account', 'ok', { fact: 'you' }),
          line('reach', 'ok'),
          line('push', 'unknown', { reason: UNSAID }),
          line('changes', 'unknown', { reason: UNSAID }),
        ],
        expiresAt: null,
        scopes: null,
      })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer secret-token')
    }),
  )

  it.effect('says an account that can’t write to a repository can’t push or merge there', () =>
    Effect.gen(function* () {
      const report = yield* dataCenter({ writable: { json: { values: [{ id: 2 }] } } }).check
      assert.deepStrictEqual(report.lines.slice(3), [
        line('push', 'no', { reason: { kind: 'role', role: null } }),
        line('changes', 'no', { reason: { kind: 'role', role: null } }),
      ])
      // Where it couldn't be asked, it stays unknown.
      const unasked = yield* dataCenter({ writable: { status: 500, text: 'down' } }).check
      assert.deepStrictEqual(states(unasked).slice(3), ['push unknown', 'changes unknown'])
    }),
  )

  it.effect('stops where the server doesn’t answer, or signs no one in', () =>
    Effect.gen(function* () {
      const away = yield* accessBitbucketDataCenter(inputOf(offline, { apiUrl: DC, webUrl: 'https://git.northwind.dev', hosted: false }))
      assert.deepStrictEqual(away.lines, [
        line('server', 'no', { fact: 'git.northwind.dev', reason: { kind: 'failed', message: 'TypeError: fetch failed' } }),
      ])
      const refused = yield* dataCenter({ properties: { status: 401, json: { errors: [{ message: 'Authentication failed' }] } } }).check
      assert.deepStrictEqual(refused.lines, [
        line('server', 'ok', { fact: 'git.northwind.dev' }),
        line('account', 'no', { reason: { kind: 'refused' } }),
      ])
      // The properties answer anyone: a token that signs no one in wasn't taken.
      const anonymous = yield* dataCenter({ properties: { json: { version: '8.19.0' } } }).check
      assert.deepStrictEqual(reasonOf(anonymous, 'account'), { kind: 'refused' })
      const down = yield* dataCenter({ properties: { status: 503, text: 'Maintenance' } }).check
      assert.deepStrictEqual(reasonOf(down, 'account'), { kind: 'failed', message: 'Maintenance' })
    }),
  )

  it.effect('names the account by the header where it isn’t listed among the users', () =>
    Effect.gen(function* () {
      const unlisted = yield* dataCenter({ users: { status: 500, text: 'down' } }).check
      assert.deepStrictEqual(unlisted.account, { id: '7', login: 'you', name: null })
      const nameless = yield* dataCenter({ properties: { json: {}, headers: { 'x-ausername': 'you' } }, users: { json: { values: [] } } })
        .check
      assert.deepStrictEqual(nameless.account, { id: 'you', login: 'you', name: null })
      // A user listed without a display name has none.
      const plain = yield* dataCenter({ users: { json: { values: [{ id: 7, name: 'YOU' }] } } }, []).check
      assert.deepStrictEqual(plain.account, { id: '7', login: 'YOU', name: null })
      // No repositories to look for: no reach line.
      assert.deepStrictEqual(states(plain), ['server ok', 'account ok', 'push unknown', 'changes unknown'])
    }),
  )

  it.effect('says which repositories it doesn’t see, by a remote’s path as well as a link’s', () =>
    Effect.gen(function* () {
      const remote = yield* dataCenter({}, [['scm', 'PAY', 'api']]).check
      assert.deepStrictEqual(remote.lines[2], line('reach', 'ok'))
      for (const status of [404, 401, 403]) {
        const report = yield* dataCenter({ repository: { status, json: { errors: [{ message: 'No' }] } } }).check
        assert.deepStrictEqual(reasonOf(report, 'reach'), { kind: 'unseen', names: ['PAY/api'], url: null })
        assert.deepStrictEqual(states(report).slice(3), ['push unknown', 'changes unknown'])
      }
      const down = yield* dataCenter({ repository: { status: 500, json: { errors: [{ message: 'Database down' }] } } }).check
      assert.deepStrictEqual(reasonOf(down, 'reach'), { kind: 'failed', message: 'Database down' })
      const odd = yield* dataCenter({ repository: { json: { id: 1 } } }).check
      assert.deepStrictEqual(reasonOf(odd, 'reach'), UNREADABLE)
    }),
  )
})

const LINEAR = 'https://api.linear.app/graphql'
const viewer = { viewer: { id: 'u1', name: 'Ada Park', displayName: 'ada' }, organization: { name: 'Northwind' } }

/** A Linear check, its two queries answered in turn. */
const linear = (answers: ReadonlyArray<Canned>, auth: AccessInput['auth'] = 'pkce') => {
  let asked = 0
  const { fetch, sent } = stubFetch([
    ['POST', LINEAR, () => answers[Math.min((asked += 1) - 1, answers.length - 1)] ?? { status: 500, text: 'no answer' }],
  ])
  return {
    check: accessLinear(
      inputOf(fetch, {
        apiUrl: 'https://api.linear.app',
        webUrl: 'https://linear.app',
        credential: { kind: 'key', token: 'lin_api_x' },
        auth,
      }),
    ),
    sent,
  }
}

describe('checking a Linear connection', () => {
  it.effect('says who it signs in as, in which workspace, and how many teams it reads', () =>
    Effect.gen(function* () {
      const { check, sent } = linear([
        { json: { data: viewer } },
        { json: { data: { teams: { nodes: [{ key: 'MER' }, { key: 'OPS' }] } } } },
      ])
      assert.deepStrictEqual(yield* check, {
        account: { id: 'u1', login: 'ada', name: 'Ada Park' },
        lines: [
          line('account', 'ok', { fact: 'Ada Park · Northwind' }),
          line('read', 'ok', { count: 2 }),
          line('comment', 'ok'),
          line('move', 'ok'),
        ],
        expiresAt: null,
        scopes: null,
      })
      // A key is sent as it is; every question is a query, never a mutation.
      assert.strictEqual(sent[0]?.headers.authorization, 'lin_api_x')
      for (const request of sent) assert.match(JSON.stringify(request.body), /^\{"query":"query \{/)
    }),
  )

  it.effect('says what an API key may change isn’t said', () =>
    Effect.gen(function* () {
      const report = yield* linear([{ json: { data: viewer } }, { json: { data: { teams: { nodes: [] } } } }], 'token').check
      assert.deepStrictEqual(report.lines.slice(1), [
        line('read', 'ok', { count: 0 }),
        line('comment', 'unknown', { reason: UNSAID }),
        line('move', 'unknown', { reason: UNSAID }),
      ])
      assert.deepStrictEqual(report.account?.login, 'ada')
      // Someone without a display name goes by their name.
      const plain = yield* linear([{ json: { data: { ...viewer, viewer: { id: 'u1', name: 'Ada Park' } } } }]).check
      assert.deepStrictEqual(plain.account, { id: 'u1', login: 'Ada Park', name: 'Ada Park' })
    }),
  )

  it.effect('stops at the account where Linear doesn’t take the credential, or says something else went wrong', () =>
    Effect.gen(function* () {
      const unauthenticated = {
        status: 400,
        json: {
          errors: [
            {
              message: 'Authentication required, not authenticated',
              extensions: { type: 'authentication error', code: 'AUTHENTICATION_ERROR' },
            },
          ],
        },
      }
      assert.deepStrictEqual((yield* linear([unauthenticated]).check).lines, [line('account', 'no', { reason: { kind: 'refused' } })])
      assert.deepStrictEqual(reasonOf(yield* linear([{ status: 401, text: '' }]).check, 'account'), { kind: 'refused' })
      assert.deepStrictEqual(reasonOf(yield* linear([{ json: { errors: [{ message: 'Query too complex' }] } }]).check, 'account'), {
        kind: 'failed',
        message: 'Query too complex',
      })
      assert.deepStrictEqual(reasonOf(yield* linear([{ status: 500, text: 'down' }]).check, 'account'), { kind: 'failed', message: 'down' })
      assert.deepStrictEqual(reasonOf(yield* linear([{ json: { data: { viewer: null } } }]).check, 'account'), UNREADABLE)
      const teamless = yield* linear([
        { json: { data: viewer } },
        { json: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } },
      ]).check
      assert.deepStrictEqual(teamless.lines[1], line('read', 'no', { reason: { kind: 'failed', message: 'Forbidden' } }))
    }),
  )
})

const SITE = 'https://northwind.atlassian.net'
const CLOUD = `${SITE}/rest/api/3`
const PERMISSIONS = 'mypermissions?permissions=BROWSE_PROJECTS,TRANSITION_ISSUES,ADD_COMMENTS'
const permitted = (browse: boolean, transition: boolean, comment: boolean): Canned => ({
  json: {
    permissions: {
      BROWSE_PROJECTS: { key: 'BROWSE_PROJECTS', havePermission: browse },
      TRANSITION_ISSUES: { key: 'TRANSITION_ISSUES', havePermission: transition },
      ADD_COMMENTS: { key: 'ADD_COMMENTS', havePermission: comment },
    },
  },
})
const ada = { accountId: 'a1', displayName: 'Ada Park', emailAddress: 'ada@northwind.dev' }

const jiraCloud = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  const credential: Credential = { kind: 'basic', user: 'ada@northwind.dev', token: 'ATATT-secret' }
  // A board's address, pasted: the site is its origin.
  return { check: accessJira(inputOf(fetch, { apiUrl: CLOUD, webUrl: `${SITE}/jira/your-work`, credential })), sent }
}

describe('checking a Jira connection', () => {
  it.effect('on Cloud, says the site, who signs in by their email, and what Jira’s permissions allow in any project', () =>
    Effect.gen(function* () {
      const { check } = jiraCloud([
        ['GET', `${CLOUD}/myself`, { json: ada }],
        ['GET', `${CLOUD}/${PERMISSIONS}`, permitted(true, true, true)],
        ['GET', `${CLOUD}/project/search?maxResults=1`, { json: { total: 12, values: [{ id: '1' }] } }],
      ])
      assert.deepStrictEqual(yield* check, {
        account: { id: 'a1', login: 'ada@northwind.dev', name: 'Ada Park' },
        lines: [
          line('site', 'ok', { fact: 'northwind.atlassian.net' }),
          line('account', 'ok', { fact: 'ada@northwind.dev' }),
          line('read', 'ok', { count: 12 }),
          line('comment', 'ok'),
          line('move', 'ok'),
        ],
        expiresAt: null,
        scopes: null,
      })
    }),
  )

  it.effect('on Data Center, counts the projects it lists, and says a permission the account hasn’t', () =>
    Effect.gen(function* () {
      const api = 'https://jira.northwind.dev/jira/rest/api/2'
      const { fetch } = stubFetch([
        ['GET', `${api}/myself`, { json: { name: 'ada', key: 'JIRAUSER1', displayName: 'Ada Park' } }],
        ['GET', `${api}/${PERMISSIONS}`, permitted(true, false, true)],
        ['GET', `${api}/project`, { json: [{ key: 'PAY' }, { key: 'OPS' }] }],
      ])
      const report = yield* accessJira(inputOf(fetch, { apiUrl: api, webUrl: 'https://jira.northwind.dev/jira/', hosted: false }))
      assert.deepStrictEqual(report.account, { id: 'JIRAUSER1', login: 'ada', name: 'Ada Park' })
      assert.deepStrictEqual(report.lines, [
        line('site', 'ok', { fact: 'jira.northwind.dev' }),
        line('account', 'ok', { fact: 'Ada Park' }),
        line('read', 'ok', { count: 2 }),
        line('comment', 'ok'),
        line('move', 'no', { reason: { kind: 'role', role: null } }),
      ])
      // A list it can't read counts nothing, and the line stands.
      const odd = stubFetch([
        ['GET', `${api}/myself`, { json: { name: 'ada' } }],
        ['GET', `${api}/${PERMISSIONS}`, permitted(true, true, true)],
        ['GET', `${api}/project`, { json: { values: [] } }],
      ])
      const uncounted = yield* accessJira(inputOf(odd.fetch, { apiUrl: api, webUrl: 'https://jira.northwind.dev/jira', hosted: false }))
      assert.deepStrictEqual(uncounted.lines[2], line('read', 'ok', { count: null }))
    }),
  )

  it.effect('asks a token the site refuses through Atlassian’s gateway, as the adapter does', () =>
    Effect.gen(function* () {
      const gateway = 'https://api.atlassian.com/ex/jira/c-1/rest/api/3'
      const { check, sent } = jiraCloud([
        ['GET', `${CLOUD}/myself`, { status: 401, text: 'Client must be authenticated to access this resource.' }],
        ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: 'c-1' } }],
        ['GET', `${gateway}/myself`, { json: ada }],
        ['GET', `${gateway}/${PERMISSIONS}`, permitted(true, true, false)],
        ['GET', `${gateway}/project/search?maxResults=1`, { status: 500, text: 'down' }],
      ])
      const report = yield* check
      assert.deepStrictEqual(states(report), ['site ok', 'account ok', 'read ok', 'comment no', 'move ok'])
      // How many projects is only a nicety: unsaid where it couldn't be asked.
      assert.isNull(report.lines[2]?.count)
      assert.isTrue(sent.slice(3).every((request) => request.url.startsWith(gateway)))
      const refusedThere = yield* jiraCloud([
        ['GET', `${CLOUD}/myself`, { status: 401, text: '' }],
        ['GET', `${SITE}/_edge/tenant_info`, { json: { cloudId: 'c-1' } }],
        ['GET', `${gateway}/myself`, { status: 401, text: '' }],
      ]).check
      assert.deepStrictEqual(refusedThere.lines, [
        line('site', 'ok', { fact: 'northwind.atlassian.net' }),
        line('account', 'no', { reason: { kind: 'refused' } }),
      ])
      const noGateway = yield* jiraCloud([['GET', `${CLOUD}/myself`, { status: 401, text: '' }]]).check
      assert.deepStrictEqual(reasonOf(noGateway, 'account'), { kind: 'refused' })
    }),
  )

  it.effect('stops where the site doesn’t answer, or can’t say who signs in', () =>
    Effect.gen(function* () {
      const away = yield* accessJira(inputOf(offline, { apiUrl: CLOUD, webUrl: SITE }))
      assert.deepStrictEqual(away.lines, [
        line('site', 'no', { fact: 'northwind.atlassian.net', reason: { kind: 'failed', message: 'TypeError: fetch failed' } }),
      ])
      const down = yield* jiraCloud([['GET', `${CLOUD}/myself`, { status: 503, json: { errorMessages: ['Site is under maintenance'] } }]])
        .check
      assert.deepStrictEqual(reasonOf(down, 'account'), { kind: 'failed', message: 'Site is under maintenance' })
      const odd = yield* jiraCloud([['GET', `${CLOUD}/myself`, { json: { displayName: 'Ada' } }]]).check
      assert.deepStrictEqual(reasonOf(odd, 'account'), UNREADABLE)
    }),
  )

  it.effect('says why the permissions couldn’t be read, on each line they decide', () =>
    Effect.gen(function* () {
      const down = yield* jiraCloud([
        ['GET', `${CLOUD}/myself`, { json: { accountId: 'a1' } }],
        ['GET', `${CLOUD}/${PERMISSIONS}`, { status: 500, json: { errorMessages: ['Internal error'] } }],
      ]).check
      // An account whose email and name Jira keeps to itself is named by its id.
      assert.deepStrictEqual(down.lines[1], line('account', 'ok', { fact: 'a1' }))
      const failed = { kind: 'failed', message: 'Internal error' } as const
      assert.deepStrictEqual(down.lines.slice(2), [
        line('read', 'no', { reason: failed }),
        line('comment', 'no', { reason: failed }),
        line('move', 'no', { reason: failed }),
      ])
      const odd = yield* jiraCloud([
        ['GET', `${CLOUD}/myself`, { json: ada }],
        ['GET', `${CLOUD}/${PERMISSIONS}`, { json: { permissions: { BROWSE_PROJECTS: {} } } }],
      ]).check
      assert.deepStrictEqual(reasonOf(odd, 'read'), UNREADABLE)
      // A permission Jira leaves out is one the account hasn't.
      const partial = yield* jiraCloud([
        ['GET', `${CLOUD}/myself`, { json: ada }],
        ['GET', `${CLOUD}/${PERMISSIONS}`, { json: { permissions: { BROWSE_PROJECTS: { havePermission: true } } } }],
      ]).check
      assert.deepStrictEqual(states(partial).slice(2), ['read ok', 'comment no', 'move no'])
    }),
  )
})

const TRELLO = 'https://api.trello.com/1'
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const tokenOf = (identifier: string, write: boolean, dateCreated: string, dateExpires: string | null = null) => ({
  id: `t-${dateCreated}`,
  identifier,
  dateCreated,
  dateExpires,
  permissions: [
    { idModel: '*', modelType: 'Board', read: true, write },
    { idModel: '*', modelType: 'Organization', read: true, write: false },
  ],
})

/** A Trello check, each answer as a test says. */
const trello = (answers: { me?: Canned; boards?: Canned; tokens?: Canned }, credential?: Credential) => {
  const { fetch, sent } = stubFetch([
    [
      'GET',
      `${TRELLO}/members/me?fields=id,username,fullName`,
      answers.me ?? { json: { id: 'm1', username: 'ada', fullName: 'Ada Park' } },
    ],
    ['GET', `${TRELLO}/members/me/boards?fields=name&filter=open`, answers.boards ?? { json: [{ id: 'b1', name: 'Payments' }] }],
    [
      'GET',
      `${TRELLO}/members/me/tokens?fields=identifier,dateCreated,dateExpires,permissions`,
      answers.tokens ?? {
        json: [tokenOf('Althar', true, '2026-09-01T00:00:00.000Z'), tokenOf('Butler', false, '2026-10-01T00:00:00.000Z')],
      },
    ],
  ])
  return {
    check: accessTrello(
      inputOf(fetch, {
        apiUrl: TRELLO,
        webUrl: 'https://trello.com',
        credential: credential ?? { kind: 'app', key: KEY, token: 'ATTA-secret' },
      }),
    ),
    sent,
  }
}

describe('checking a Trello connection', () => {
  it.effect('names the key by its end, counts the open boards, and reads what Althar’s token may write', () =>
    Effect.gen(function* () {
      const { check, sent } = trello({})
      assert.deepStrictEqual(yield* check, {
        account: { id: 'm1', login: 'ada', name: 'Ada Park' },
        lines: [
          line('key', 'ok', { fact: '····8f90' }),
          line('account', 'ok', { fact: 'ada' }),
          line('read', 'ok', { count: 1 }),
          line('comment', 'ok'),
          line('move', 'ok'),
        ],
        expiresAt: null,
        scopes: null,
      })
      // Neither the key nor the token goes in an address.
      for (const request of sent) {
        assert.notInclude(request.url, KEY)
        assert.notInclude(request.url, 'ATTA-secret')
      }
      assert.strictEqual(sent[0]?.headers.authorization, `OAuth oauth_consumer_key="${KEY}", oauth_token="ATTA-secret"`)
    }),
  )

  it.effect('says when the newest of Althar’s tokens runs out, and what they may write together', () =>
    Effect.gen(function* () {
      const expiring = yield* trello({
        tokens: {
          json: [
            tokenOf('Althar', true, '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
            tokenOf('Althar', true, '2026-08-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
          ],
        },
      }).check
      assert.strictEqual(expiring.expiresAt, '2026-10-31T00:00:00.000Z')
      const readOnly = yield* trello({ tokens: { json: [tokenOf('Althar', false, '2026-10-01T00:00:00.000Z')] } }).check
      const write = { kind: 'scope', scope: 'write', url: null } as const
      assert.deepStrictEqual(readOnly.lines.slice(3), [line('comment', 'no', { reason: write }), line('move', 'no', { reason: write })])
      // Which of two is this one isn't said: unknown where they differ, or where none is Althar's.
      const mixed = yield* trello({
        tokens: { json: [tokenOf('Althar', false, '2026-10-01T00:00:00.000Z'), tokenOf('Althar', true, '2026-09-01T00:00:00.000Z')] },
      }).check
      assert.deepStrictEqual(states(mixed).slice(3), ['comment unknown', 'move unknown'])
      const none = yield* trello({ tokens: { json: [tokenOf('Butler', true, '2026-10-01T00:00:00.000Z'), { id: 't', identifier: null }] } })
        .check
      assert.deepStrictEqual(none.lines.slice(3), [
        line('comment', 'unknown', { reason: UNSAID }),
        line('move', 'unknown', { reason: UNSAID }),
      ])
      assert.isNull(none.expiresAt)
    }),
  )

  it.effect('says what went wrong reading the tokens, or that Trello wouldn’t list them', () =>
    Effect.gen(function* () {
      const refused = yield* trello({ tokens: { status: 401, text: 'unauthorized permission requested' } }).check
      assert.deepStrictEqual(states(refused).slice(3), ['comment unknown', 'move unknown'])
      const down = yield* trello({ tokens: { status: 500, text: 'down' } }).check
      assert.deepStrictEqual(reasonOf(down, 'comment'), { kind: 'failed', message: 'down' })
      const odd = yield* trello({ tokens: { json: { tokens: [] } } }).check
      assert.deepStrictEqual(reasonOf(odd, 'move'), UNREADABLE)
    }),
  )

  it.effect('stops at the key or the account where Trello doesn’t take them', () =>
    Effect.gen(function* () {
      const key = line('key', 'ok', { fact: '····8f90' })
      assert.deepStrictEqual((yield* trello({ me: { status: 401, text: 'invalid token' } }).check).lines, [
        key,
        line('account', 'no', { reason: { kind: 'refused' } }),
      ])
      // A token it won't take can come as a 400.
      assert.deepStrictEqual(reasonOf(yield* trello({ me: { status: 400, text: 'expired token' } }).check, 'account'), { kind: 'refused' })
      assert.deepStrictEqual((yield* trello({ me: { status: 401, text: 'invalid key' } }).check).lines, [
        line('key', 'no', { fact: '····8f90', reason: { kind: 'failed', message: 'invalid key' } }),
      ])
      assert.deepStrictEqual(reasonOf(yield* trello({ me: { status: 500, text: 'down' } }).check, 'account'), {
        kind: 'failed',
        message: 'down',
      })
      assert.deepStrictEqual(reasonOf(yield* trello({ me: { json: { id: 'm1' } } }).check, 'account'), UNREADABLE)
      const keyless = yield* trello({}, { kind: 'bearer', token: 't' }).check
      assert.deepStrictEqual(keyless.lines, [line('key', 'no', { reason: { kind: 'failed', message: 'No API key' } })])
    }),
  )

  it.effect('says what went wrong reading the boards', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(reasonOf(yield* trello({ boards: { status: 500, text: 'down' } }).check, 'read'), {
        kind: 'failed',
        message: 'down',
      })
      assert.deepStrictEqual(reasonOf(yield* trello({ boards: { json: [{ id: 1 }] } }).check, 'read'), UNREADABLE)
    }),
  )
})

describe('checking the fake service', () => {
  const asking = (repositories: ReadonlyArray<ReadonlyArray<string>>): AccessInput =>
    inputOf(offline, { apiUrl: '', webUrl: '', repositories })

  it.effect('reaches the repositories it has, and does everything there', () =>
    Effect.gen(function* () {
      const fake = makeFakeService()
      fake.addRepository(['northwind', 'api'])
      assert.deepStrictEqual(yield* fake.access(asking([['Northwind', 'API']])), {
        account: { id: '1', login: 'you', name: 'You' },
        lines: [
          line('account', 'ok', { fact: 'you' }),
          line('reach', 'ok', { fact: 'Northwind' }),
          line('push', 'ok'),
          line('changes', 'ok'),
          line('checks', 'ok'),
          line('issues', 'ok'),
        ],
        expiresAt: null,
        scopes: null,
      })
      const missing = yield* fake.access(asking([['northwind', 'web']]))
      assert.deepStrictEqual(reasonOf(missing, 'reach'), { kind: 'unseen', names: ['northwind/web'], url: null })
      assert.deepStrictEqual(states(yield* makeFakeService({ product: 'linear' }).access(asking([]))), [
        'account ok',
        'read ok',
        'comment ok',
        'move ok',
      ])
    }),
  )

  it.effect('stops at the account where a test says it fails', () =>
    Effect.gen(function* () {
      const fake = makeFakeService()
      fake.failNext('access', 'unauthorized')
      assert.deepStrictEqual((yield* fake.access(asking([]))).lines, [line('account', 'no', { reason: { kind: 'refused' } })])
      fake.failNext('access', 'unreachable')
      assert.deepStrictEqual(reasonOf(yield* fake.access(asking([])), 'account'), {
        kind: 'failed',
        message: 'The fake access failed (unreachable)',
      })
      assert.deepStrictEqual(
        fake.calls.filter((call) => call === 'access'),
        ['access', 'access'],
      )
    }),
  )
})
