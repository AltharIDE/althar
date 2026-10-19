import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeBitbucketCloud } from '../src/bitbucketCloud'
import type { Check, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

/*
 * Bitbucket Cloud's answers that leave things out: people known only by
 * their id or not at all, a pull request without its head, its reviewers or
 * the repository its branch is on; and one declined already.
 */

const CLOUD = 'https://api.bitbucket.org/2.0'
const ACE = `${CLOUD}/repositories/atlassian/atlassian-connect-express`
const PR = `${ACE}/pullrequests/552`

const ace: Repository = {
  id: '{47b154f6-a82d-4e03-99ce-44fb75b4827c}',
  path: ['atlassian', 'atlassian-connect-express'],
  defaultBranch: 'master',
  webUrl: 'https://bitbucket.org/atlassian/atlassian-connect-express',
  canPush: true,
  merges: ['merge', 'squash', 'rebase'],
}

const cloud = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeBitbucketCloud({
      fetch,
      apiUrl: CLOUD,
      webUrl: 'https://bitbucket.org',
      credential: Effect.succeed({ kind: 'basic', user: 'you@meridian.dev', token: 'ATATT3x' }),
    }),
    sent,
  }
}

const pull = (overrides: Record<string, unknown> = {}) => ({
  id: 552,
  title: 'ONECLOUD-13657/add on settings',
  description: 'Settings for an add-on.',
  state: 'OPEN',
  draft: false,
  source: {
    branch: { name: 'ONECLOUD-13657/add-on-settings' },
    commit: { hash: '7f9d4e6279c8' },
    repository: { full_name: 'atlassian/atlassian-connect-express' },
  },
  destination: { branch: { name: 'master' } },
  author: { display_name: 'Vincent Nguyen', type: 'user', uuid: '{8921678d}', nickname: 'Vincent Nguyen' },
  links: { html: { href: 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552' } },
  updated_on: '2025-08-22T07:42:42.339018+00:00',
  ...overrides,
})

const step = (uuid: string, result: string) => ({ uuid, state: { name: 'COMPLETED', result: { name: result } } })

describe('Bitbucket Cloud answers that leave things out', () => {
  it.effect('lists authors known only by their id, or not at all, and an approval said only as a state', () =>
    Effect.gen(function* () {
      const { host } = cloud([
        [
          'GET',
          /\/pullrequests\?/,
          {
            json: {
              values: [
                pull({ author: { uuid: '{84d3c1be}', type: 'app_user' }, participants: [{ state: 'approved' }] }),
                pull({ id: 553, author: {}, participants: [{ approved: false, state: null }] }),
              ],
            },
          },
        ],
      ])
      const list = yield* host.listChanges(ace, { state: 'open', limit: 5 })
      assert.deepStrictEqual(
        list.changes.map((change) => [change.number, change.author, change.reviewDecision]),
        [
          [552, { id: '{84d3c1be}', login: '{84d3c1be}', name: null, bot: true }, 'approved'],
          [553, { id: 'ghost', login: 'ghost', name: null, bot: false }, null],
        ],
      )
    }),
  )

  it.effect('marks a draft ready that has no reviewers to send back', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        ['GET', PR, { json: pull({ draft: true, reviewers: undefined }) }],
        ['PUT', PR, { json: pull({ draft: false }) }],
      ])
      assert.isFalse((yield* host.markReady(ace, yield* host.change(ace, 552))).draft)
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, {
        title: 'ONECLOUD-13657/add on settings',
        description: 'Settings for an add-on.',
        reviewers: [],
        draft: false,
      })
    }),
  )

  it.effect('merges a pull request whose head Bitbucket doesn’t say, as there is nothing to hold it to', () =>
    Effect.gen(function* () {
      const branch = { branch: { name: 'ONECLOUD-13657/add-on-settings' } }
      const { host, sent } = cloud([
        ['GET', PR, { json: pull({ source: branch }) }],
        ['GET', `${ACE}/refs/branches/master`, { json: { name: 'master', merge_strategies: ['squash'] } }],
        ['POST', `${PR}/merge`, { json: pull({ state: 'MERGED', source: branch }) }],
      ])
      const seen = yield* host.change(ace, 552)
      assert.isNull(seen.headSha)
      assert.notProperty(seen, 'headRepository')
      yield* host.merge(ace, { ...seen, headSha: '7f9d4e6279c8' })
      assert.deepStrictEqual(sent.find((request) => request.method === 'POST')?.body, { merge_strategy: 'squash' })
    }),
  )

  it.effect('leaves a pull request declined already as it is', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([['GET', PR, { json: pull({ state: 'DECLINED' }) }]])
      const closed = yield* host.closeChange(ace, yield* host.change(ace, 552))
      assert.strictEqual(closed.state, 'closed')
      assert.isFalse(sent.some((request) => request.method === 'POST'))
    }),
  )

  it.effect('deletes a branch in the repository itself where Bitbucket doesn’t say whose it is, and none whose fork is gone', () =>
    Effect.gen(function* () {
      const unsaid = cloud([
        ['GET', PR, { json: pull({ state: 'MERGED', source: { branch: { name: 'settings' } } }) }],
        ['DELETE', `${ACE}/refs/branches/settings`, { status: 204 }],
      ])
      yield* unsaid.host.deleteBranch(ace, yield* unsaid.host.change(ace, 552))
      assert.isTrue(unsaid.sent.some((request) => request.method === 'DELETE' && request.url === `${ACE}/refs/branches/settings`))

      const forkGone = cloud([
        ['GET', PR, { json: pull({ state: 'DECLINED', source: { branch: { name: 'settings' }, repository: null } }) }],
      ])
      const change = yield* forkGone.host.change(ace, 552)
      assert.deepStrictEqual(change.headRepository, [])
      yield* forkGone.host.deleteBranch(ace, change)
      assert.isFalse(forkGone.sent.some((request) => request.method === 'DELETE'))
    }),
  )

  it.effect('reads a failed Pipelines step’s whole log when asked for all of it', () =>
    Effect.gen(function* () {
      const long = Array.from({ length: 300 }, (_, n) => `line ${n}`).join('\n')
      const { host } = cloud([
        ['GET', `${ACE}/pipelines/3025/steps?pagelen=100`, { json: { values: [step('{b}', 'FAILED')] } }],
        ['GET', `${ACE}/pipelines/3025/steps/%7Bb%7D/log`, { text: long }],
      ])
      const check: Check = { id: 'pipeline:3025', name: 'Pipeline', state: 'failed', url: null, summary: null }
      assert.strictEqual(yield* host.checkLog(ace, check, true), long)
      assert.strictEqual((yield* host.checkLog(ace, check))?.split('\n').length, 150)
    }),
  )
})
