import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import type { Fetch } from '../src/http'
import type { Service } from '../src/model'
import { identify } from '../src/servers'
import { type Answer as Canned, stubFetch } from './stub'

/** A page, as a server that isn't the one asked for answers. */
const page: Canned = { status: 404, text: '<!doctype html><title>Not found</title>' }

const offline: Fetch = () => Promise.reject(new TypeError('fetch failed'))

describe('identifying a company’s own server', () => {
  it.effect('knows GitLab by the header it marks every answer with, a stranger’s included, or by its version', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'GET',
          'https://gitlab.northwind.dev/api/v4/version',
          { status: 401, json: { message: '401 Unauthorized' }, headers: { 'x-gitlab-meta': '{"correlation_id":"c1","version":"1"}' } },
        ],
        ['GET', 'https://code.northwind.dev/api/v4/version', { json: { version: '17.5.0', revision: 'abc' } }],
      ])
      assert.deepStrictEqual(yield* identify(fetch, 'gitlab', ' gitlab.northwind.dev '), {
        product: 'gitlab',
        webUrl: 'https://gitlab.northwind.dev',
        reason: null,
      })
      // Asked without signing in.
      assert.isUndefined(sent[0]?.headers.authorization)
      assert.strictEqual((yield* identify(fetch, 'gitlab', 'https://code.northwind.dev/northwind/api')).product, 'gitlab')
    }),
  )

  it.effect('knows Bitbucket Data Center by its application’s name', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        ['GET', 'https://git.northwind.dev/rest/api/1.0/application-properties', { json: { displayName: 'Bitbucket', version: '8.19.0' } }],
        ['GET', 'https://wiki.northwind.dev/rest/api/1.0/application-properties', { json: { displayName: 'Confluence', version: '9.0' } }],
      ])
      assert.deepStrictEqual(yield* identify(fetch, 'bitbucket', 'https://git.northwind.dev/'), {
        product: 'bitbucket_dc',
        webUrl: 'https://git.northwind.dev',
        reason: null,
      })
      assert.deepStrictEqual(yield* identify(fetch, 'bitbucket', 'wiki.northwind.dev'), {
        product: null,
        webUrl: 'https://wiki.northwind.dev',
        reason: 'other',
      })
    }),
  )

  it.effect('knows GitHub Enterprise Server by the version its meta says', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        [
          'GET',
          'https://github.northwind.dev/api/v3/meta',
          { json: { installed_version: '3.14.2', verifiable_password_authentication: true } },
        ],
      ])
      assert.deepStrictEqual(yield* identify(fetch, 'github', 'github.northwind.dev/northwind/api'), {
        product: 'github',
        webUrl: 'https://github.northwind.dev',
        reason: null,
      })
      const elsewhere = stubFetch([['GET', 'https://github.northwind.dev/api/v3/meta', { json: { hooks: [] } }]])
      assert.strictEqual((yield* identify(elsewhere.fetch, 'github', 'github.northwind.dev')).reason, 'other')
    }),
  )

  it.effect('tells Jira Cloud from Data Center by its server info, where it lives as well', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([
        [
          'GET',
          'https://northwind.atlassian.net/rest/api/2/serverInfo',
          { json: { deploymentType: 'Cloud', baseUrl: 'https://northwind.atlassian.net' } },
        ],
        [
          'GET',
          'https://jira.northwind.dev/rest/api/2/serverInfo',
          { json: { deploymentType: 'Server', baseUrl: 'https://jira.northwind.dev/' } },
        ],
        // A Jira under a path: the origin answers with a page, the path with Jira.
        ['GET', 'https://issues.northwind.dev/rest/api/2/serverInfo', page],
        [
          'GET',
          'https://issues.northwind.dev/jira/rest/api/2/serverInfo',
          { json: { deploymentType: 'Server', baseUrl: 'https://issues.northwind.dev/jira' } },
        ],
        // A custom domain whose Jira says it lives somewhere else: kept where it was asked.
        [
          'GET',
          'https://tickets.northwind.dev/rest/api/2/serverInfo',
          { json: { deploymentType: 'Cloud', baseUrl: 'https://northwind.atlassian.net' } },
        ],
        ['GET', 'https://refused.northwind.dev/rest/api/2/serverInfo', { status: 403, json: { deploymentType: 'Server' } }],
      ])
      assert.deepStrictEqual(yield* identify(fetch, 'jira', 'https://northwind.atlassian.net/jira/your-work'), {
        product: 'jira_cloud',
        webUrl: 'https://northwind.atlassian.net',
        reason: null,
      })
      assert.deepStrictEqual(yield* identify(fetch, 'jira', 'jira.northwind.dev'), {
        product: 'jira_dc',
        webUrl: 'https://jira.northwind.dev',
        reason: null,
      })
      assert.deepStrictEqual(yield* identify(fetch, 'jira', 'https://issues.northwind.dev/jira/secure/Dashboard.jspa'), {
        product: 'jira_dc',
        webUrl: 'https://issues.northwind.dev/jira',
        reason: null,
      })
      assert.deepStrictEqual(yield* identify(fetch, 'jira', 'tickets.northwind.dev'), {
        product: 'jira_cloud',
        webUrl: 'https://tickets.northwind.dev',
        reason: null,
      })
      assert.strictEqual((yield* identify(fetch, 'jira', 'refused.northwind.dev')).reason, 'other')
    }),
  )

  it.effect('says when nothing answers, in time or at all', () =>
    Effect.gen(function* () {
      for (const service of ['gitlab', 'bitbucket', 'github', 'jira'] as const)
        assert.deepStrictEqual(yield* identify(offline, service, 'https://git.northwind.dev/team'), {
          product: null,
          webUrl: 'https://git.northwind.dev',
          reason: 'unreachable',
        })
      const silent: Fetch = () => new Promise(() => undefined)
      const fiber = yield* Effect.forkChild(identify(silent, 'gitlab', 'gitlab.northwind.dev'))
      yield* TestClock.adjust('6 seconds')
      assert.strictEqual((yield* Fiber.join(fiber)).reason, 'unreachable')
    }),
  )

  it.effect('says when something else answers, there or under the path typed', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        ['GET', 'https://code.northwind.dev/api/v4/version', page],
        ['GET', 'https://code.northwind.dev/git/api/v4/version', page],
      ])
      assert.deepStrictEqual(yield* identify(fetch, 'gitlab', 'https://code.northwind.dev/git/northwind'), {
        product: null,
        webUrl: 'https://code.northwind.dev',
        reason: 'other',
      })
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        ['https://code.northwind.dev/api/v4/version', 'https://code.northwind.dev/git/api/v4/version'],
      )
      // Linear and Trello run on no company's server: whatever answers is something else.
      for (const service of ['linear', 'trello'] satisfies ReadonlyArray<Service>)
        assert.strictEqual((yield* identify(fetch, service, 'code.northwind.dev')).reason, 'other')
    }),
  )

  it.effect('says when what was typed isn’t an address', () =>
    Effect.gen(function* () {
      for (const typed of ['', '   ', 'not a server', 'localhost', 'ftp://files.northwind.dev', 'https://'])
        assert.deepStrictEqual(yield* identify(offline, 'gitlab', typed), { product: null, webUrl: typed.trim(), reason: 'invalid' })
    }),
  )
})
