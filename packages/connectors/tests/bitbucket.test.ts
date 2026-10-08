import { assert, describe, it } from '@effect/vitest'
import { Effect, Logger } from 'effect'

import { iso, makeBitbucketCloud, mergesOf, statusState, strategyOf } from '../src/bitbucketCloud'
import * as dc from '../src/bitbucketDataCenter'
import type { Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

/*
 * Bitbucket Cloud's answers are recorded from public repositories on
 * bitbucket.org (atlassian/atlassian-connect-express and
 * atlassian/aws-s3-deploy, 7 October 2026), trimmed; what needs an account
 * (the account, its permission, writes) follows the API's own reference.
 * Data Center has no public instance: its answers follow the examples of its
 * REST reference.
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
  // The repository's own choice, a merge commit, first.
  merges: ['merge', 'squash', 'rebase'],
}

const cloud = (routes: ReadonlyArray<Route>, kind: 'basic' | 'bearer' = 'basic') => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeBitbucketCloud({
      fetch,
      apiUrl: CLOUD,
      webUrl: 'https://bitbucket.org',
      credential: Effect.succeed(kind === 'basic' ? { kind, user: 'you@meridian.dev', token: 'ATATT3x' } : { kind, token: 'ATCTT3x' }),
    }),
    sent,
  }
}

const vincent = {
  display_name: 'Vincent Nguyen',
  type: 'user',
  uuid: '{8921678d-cc20-474a-b7e3-8c6ff3b1a140}',
  account_id: '712020:cf50c3cb-714f-4214-be27-f5bace22a1f9',
  nickname: 'Vincent Nguyen',
}
const mitch = { display_name: 'Mitchell Mc Cue', type: 'user', uuid: '{64d8d852-4dda-429a-bb5e-7fe9ae157223}', nickname: 'Mitch McCue' }
const rovo = { display_name: 'Rovo Dev', type: 'app_user', uuid: '{84d3c1be-f829-4e0c-b305-1c11a143484a}', nickname: null }

const pull = (overrides: Record<string, unknown> = {}) => ({
  type: 'pullrequest',
  id: 552,
  title: 'ONECLOUD-13657/add on settings',
  description: '## Notes for Atlassian Maintainers:\n\nThis is a public repo.',
  state: 'OPEN',
  draft: true,
  source: {
    branch: { name: 'ONECLOUD-13657/add-on-settings', sync_strategies: ['merge_commit', 'rebase'] },
    commit: { hash: '7f9d4e6279c8', type: 'commit' },
    repository: { type: 'repository', full_name: 'atlassian/atlassian-connect-express' },
  },
  destination: {
    branch: { name: 'master' },
    commit: { hash: 'd00fcf783635', type: 'commit' },
    repository: { type: 'repository', full_name: 'atlassian/atlassian-connect-express' },
  },
  author: vincent,
  reviewers: [
    { display_name: 'Serena Wang', type: 'user', uuid: '{382024ee-9961-4359-ae8f-b48b42f0432a}', nickname: 'Serena Wang' },
    mitch,
  ],
  close_source_branch: false,
  links: { html: { href: 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552' } },
  created_on: '2025-08-21T07:23:15.940561+00:00',
  updated_on: '2025-08-22T07:42:42.339018+00:00',
  ...overrides,
})

// Recorded again on 7 October 2026, with the strategy the repository chose.
const master = {
  name: 'master',
  type: 'branch',
  merge_strategies: ['merge_commit', 'squash', 'fast_forward', 'squash_fast_forward', 'rebase_fast_forward', 'rebase_merge'],
  default_merge_strategy: 'merge_commit',
}

describe('Bitbucket Cloud as a code host', () => {
  it.effect('says who it is signed in as, with the account’s email and its API token', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([['GET', `${CLOUD}/user`, { json: { ...vincent, account_status: 'active' } }]])
      assert.deepStrictEqual(yield* host.account, { id: vincent.uuid, login: 'Vincent Nguyen', name: 'Vincent Nguyen' })
      assert.strictEqual(sent[0]?.headers.authorization, `Basic ${Buffer.from('you@meridian.dev:ATATT3x').toString('base64')}`)
      assert.deepStrictEqual(host.words, { noun: 'pull request', short: 'PR', prefix: '#' })
    }),
  )

  it.effect('reads a repository: its main branch, whether the account may push, and how it merges', () =>
    Effect.gen(function* () {
      const repository = {
        type: 'repository',
        uuid: ace.id,
        full_name: 'atlassian/atlassian-connect-express',
        name: 'atlassian-connect-express',
        is_private: false,
        mainbranch: { name: 'master', type: 'branch' },
        links: { html: { href: ace.webUrl }, clone: [{ name: 'https', href: `${ace.webUrl}.git` }] },
      }
      const permission = (full: string, level: string) => ({
        type: 'repository_permission',
        repository: { type: 'repository', full_name: full, name: 'atlassian-connect-express' },
        permission: level,
      })
      const { host, sent } = cloud([
        ['GET', ACE, { json: repository }],
        [
          'GET',
          `${CLOUD}/user/workspaces/atlassian/permissions/repositories?q=repository.name%20%3D%20%22atlassian-connect-express%22`,
          // Another workspace's repository of the same name isn't this one.
          { json: { values: [permission('meridian/atlassian-connect-express', 'admin'), permission(repository.full_name, 'write')] } },
        ],
        ['GET', `${ACE}/refs/branches/master`, { json: master }],
        [
          'GET',
          `${CLOUD}/repositories/meridian/empty`,
          { json: { ...repository, full_name: 'meridian/empty', name: 'empty', mainbranch: null } },
        ],
        ['GET', /\/user\/workspaces\/meridian\/permissions\/repositories/, { json: { values: [permission('meridian/empty', 'read')] } }],
      ])
      assert.deepStrictEqual(yield* host.repository(['atlassian', 'atlassian-connect-express']), ace)
      assert.deepStrictEqual(
        sent.map((request) => request.method),
        ['GET', 'GET', 'GET'],
      )
      // Empty, it has no main branch to merge into yet; read only, it can't be pushed to.
      const empty = yield* host.repository(['meridian', 'empty'])
      assert.deepInclude(empty, { defaultBranch: 'main', canPush: false, merges: [] })
      // A token that may not ask for its permission reads as one that can't push, and the repository is still read.
      const unasked = cloud([
        ['GET', ACE, { json: repository }],
        [
          'GET',
          /\/permissions\/repositories/,
          {
            status: 403,
            json: {
              type: 'error',
              error: {
                message: 'Your credentials lack one or more required privilege scopes.',
                detail: { granted: ['account'], required: ['repository'] },
              },
            },
          },
        ],
        ['GET', `${ACE}/refs/branches/master`, { json: master }],
      ])
      assert.deepStrictEqual(yield* unasked.host.repository(['atlassian', 'atlassian-connect-express']), { ...ace, canPush: false })
    }),
  )

  it('merges the way the repository chose, or else in Althar’s order of the ways a branch allows', () => {
    assert.deepStrictEqual(mergesOf(master.merge_strategies, master.default_merge_strategy), ['merge', 'squash', 'rebase'])
    assert.deepStrictEqual(mergesOf(['squash', 'fast_forward'], 'fast_forward'), ['rebase', 'squash'])
    // A choice the branch doesn't allow, or none, leaves Althar's order.
    assert.deepStrictEqual(mergesOf(['squash'], 'merge_commit'), ['squash'])
    assert.deepStrictEqual(mergesOf(master.merge_strategies), ['squash', 'merge', 'rebase'])
    assert.deepStrictEqual(mergesOf(['fast_forward', 'rebase_merge'], null), ['merge', 'rebase'])
    assert.deepStrictEqual(mergesOf([]), [])
    assert.strictEqual(strategyOf(master.merge_strategies, master.default_merge_strategy), 'merge_commit')
    assert.strictEqual(strategyOf(['squash'], 'merge_commit'), 'squash')
    assert.strictEqual(strategyOf(master.merge_strategies), 'squash')
    assert.strictEqual(strategyOf(['squash_fast_forward', 'merge_commit']), 'squash_fast_forward')
    assert.strictEqual(strategyOf(['fast_forward', 'rebase_fast_forward']), 'rebase_fast_forward')
    assert.isUndefined(strategyOf(['octopus']))
    // One Bitbucket adds later is still the repository's to choose.
    assert.strictEqual(strategyOf(['octopus'], 'octopus'), 'octopus')
  })

  it.effect('finds the open pull request from a branch of this repository, drafts too', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        ['GET', /pullrequests\?q=source\.branch\.name%20%3D%20%22ONECLOUD-13657%2Fadd-on-settings%22/, { json: { values: [pull()] } }],
        ['GET', /pullrequests\?q=/, { json: { values: [], pagelen: 10, size: 0 } }],
      ])
      assert.deepStrictEqual(yield* host.findChange(ace, 'ONECLOUD-13657/add-on-settings'), {
        id: `${ace.id}:552`,
        number: 552,
        title: 'ONECLOUD-13657/add on settings',
        body: '## Notes for Atlassian Maintainers:\n\nThis is a public repo.',
        url: 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552',
        state: 'open',
        draft: true,
        source: 'ONECLOUD-13657/add-on-settings',
        target: 'master',
        headSha: '7f9d4e6279c8',
        author: { id: vincent.uuid, login: 'Vincent Nguyen', name: 'Vincent Nguyen', bot: false },
        additions: null,
        deletions: null,
        changedFiles: null,
        updatedAt: '2025-08-22T07:42:42.339Z',
      })
      assert.strictEqual(
        decodeURIComponent(new URL(sent[0]?.url ?? '').searchParams.get('q') ?? ''),
        'source.branch.name = "ONECLOUD-13657/add-on-settings" AND source.repository.full_name = "atlassian/atlassian-connect-express" AND state = "OPEN"',
      )
      assert.isNull(yield* host.findChange(ace, 'say "hi"\\'))
      assert.include(decodeURIComponent(sent[1]?.url ?? ''), 'source.branch.name = "say \\"hi\\"\\\\"')
    }),
  )

  it.effect('opens a draft pull request, or adopts the one open from its branch without writing over it', () =>
    Effect.gen(function* () {
      let open = false
      const { host, sent } = cloud([
        ['GET', /pullrequests\?q=/, () => ({ json: { values: open ? [pull()] : [] } })],
        [
          'POST',
          `${ACE}/pullrequests`,
          () => {
            open = true
            return { status: 201, json: pull() }
          },
        ],
      ])
      const change = { title: 'MER-231: Rate-limit refunds', body: 'Body', source: 'althar/mer-231', target: 'master', draft: true }
      assert.strictEqual((yield* host.openChange(ace, change)).number, 552)
      assert.deepStrictEqual(sent.find((request) => request.method === 'POST')?.body, {
        title: 'MER-231: Rate-limit refunds',
        description: 'Body',
        source: { branch: { name: 'althar/mer-231' } },
        destination: { branch: { name: 'master' } },
        draft: true,
      })
      assert.strictEqual((yield* host.openChange(ace, change)).number, 552)
      assert.lengthOf(
        sent.filter((request) => request.method === 'POST'),
        1,
      )
    }),
  )

  it.effect('opens one from a fork’s branch, and finds it by the fork', () =>
    Effect.gen(function* () {
      const fork: Repository = { ...ace, id: '{fork}', path: ['you', 'atlassian-connect-express'] }
      const { host, sent } = cloud([
        ['GET', /pullrequests\?q=/, { json: { values: [] } }],
        ['POST', `${ACE}/pullrequests`, { status: 201, json: pull() }],
      ])
      const change = { title: 't', body: '', source: 'althar/mer-231', target: 'master', draft: false, from: fork }
      assert.strictEqual((yield* host.openChange(ace, change)).number, 552)
      assert.include(decodeURIComponent(sent[0]?.url ?? ''), 'source.repository.full_name = "you/atlassian-connect-express"')
      assert.deepStrictEqual((sent[1]?.body as { source: unknown } | undefined)?.source, {
        branch: { name: 'althar/mer-231' },
        repository: { full_name: 'you/atlassian-connect-express' },
      })
    }),
  )

  it.effect('adopts one opened meanwhile when Bitbucket refuses, and otherwise says why in its words', () =>
    Effect.gen(function* () {
      let asked = 0
      const raced = cloud([
        ['GET', /pullrequests\?q=/, () => ({ json: { values: (asked += 1) === 1 ? [] : [pull()] } })],
        [
          'POST',
          `${ACE}/pullrequests`,
          { status: 400, json: { type: 'error', error: { message: 'There is already a pull request open' } } },
        ],
      ])
      const change = { title: 't', body: '', source: 'ONECLOUD-13657/add-on-settings', target: 'master', draft: false }
      assert.strictEqual((yield* raced.host.openChange(ace, change)).number, 552)
      const refused = cloud([
        ['GET', /pullrequests\?q=/, { json: { values: [] } }],
        [
          'POST',
          `${ACE}/pullrequests`,
          { status: 400, json: { type: 'error', error: { message: 'source: There are no changes to be pulled', fields: {} } } },
        ],
      ])
      assert.deepInclude(yield* Effect.flip(refused.host.openChange(ace, change)), {
        reason: 'rejected',
        message: 'source: There are no changes to be pulled',
      })
    }),
  )

  it.effect('reads a pull request’s state: open, merged, declined or superseded', () =>
    Effect.gen(function* () {
      const { host } = cloud([
        ['GET', `${ACE}/pullrequests/45`, { json: pull({ id: 45, state: 'MERGED', draft: false, author: null }) }],
        ['GET', `${ACE}/pullrequests/48`, { json: pull({ id: 48, state: 'DECLINED', draft: undefined, description: null }) }],
        [
          'GET',
          `${ACE}/pullrequests/49`,
          { json: pull({ id: 49, state: 'SUPERSEDED', source: { branch: { name: 'gone' }, commit: null } }) },
        ],
      ])
      const merged = yield* host.change(ace, 45)
      assert.deepInclude(merged, { state: 'merged', author: null })
      const declined = yield* host.change(ace, 48)
      assert.deepInclude(declined, { state: 'closed', draft: false, body: '' })
      assert.deepInclude(yield* host.change(ace, 49), { state: 'closed', headSha: null })
    }),
  )

  it.effect('reads a pull request’s size from its diff’s stat, every page, and leaves it unsaid when Bitbucket won’t count', () =>
    Effect.gen(function* () {
      // Recorded from pull request 552, whose stat Bitbucket answers at the comparison it redirects to.
      const file = (path: string, added: number, removed: number, status = 'modified') => ({
        type: 'diffstat',
        status,
        lines_added: added,
        lines_removed: removed,
        old: status === 'added' ? null : { path, type: 'commit_file' },
        new: { path, type: 'commit_file' },
      })
      const second = `${ACE}/diffstat/atlassian/atlassian-connect-express:7f9d4e6279c8%0Dd00fcf783635?from_pullrequest_id=552&topic=true&page=2`
      const { host, sent } = cloud([
        ['GET', PR, { json: pull() }],
        [
          'GET',
          `${PR}/diffstat`,
          {
            json: {
              pagelen: 5,
              values: [
                file('lib/index.js', 2, 0),
                file('lib/store/dynamodb.js', 80, 7),
                file('lib/store/mongodb.js', 62, 22),
                file('lib/store/redis.js', 44, 8),
                file('lib/store/sequelize.js', 63, 6),
              ],
              page: 1,
              size: 8,
              next: second,
            },
          },
        ],
        [
          'GET',
          second,
          {
            json: {
              pagelen: 5,
              values: [file('lib/store/utils.js', 48, 1), file('lib/utils.js', 19, 0, 'added'), file('types/index.d.ts', 14, 0)],
              page: 2,
              size: 8,
            },
          },
        ],
      ])
      assert.deepInclude(yield* host.change(ace, 552), { additions: 332, deletions: 44, changedFiles: 8 })
      assert.lengthOf(sent, 3)
      const uncounted = cloud([
        ['GET', PR, { json: pull() }],
        ['GET', `${PR}/diffstat`, { status: 555, json: { type: 'error', error: { message: 'Timed out' } } }],
      ])
      assert.deepInclude(yield* uncounted.host.change(ace, 552), { additions: null, deletions: null, changedFiles: null })
      const binary = cloud([
        ['GET', PR, { json: pull() }],
        ['GET', `${PR}/diffstat`, { json: { values: [{ type: 'diffstat', status: 'modified', new: { path: 'logo.png' } }] } }],
      ])
      assert.deepInclude(yield* binary.host.change(ace, 552), { additions: 0, deletions: 0, changedFiles: 1 })
    }),
  )

  it.effect('marks a draft ready, sending back what it has so reviewers stay', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        ['GET', PR, { json: pull() }],
        ['PUT', PR, { json: pull({ draft: false }) }],
      ])
      const ready = yield* host.markReady(ace, yield* host.change(ace, 552))
      assert.isFalse(ready.draft)
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, {
        title: 'ONECLOUD-13657/add on settings',
        description: '## Notes for Atlassian Maintainers:\n\nThis is a public repo.',
        reviewers: [{ uuid: '{382024ee-9961-4359-ae8f-b48b42f0432a}' }, { uuid: mitch.uuid }],
        close_source_branch: false,
        draft: false,
      })
      const bare = cloud([
        ['GET', PR, { json: pull({ description: null, reviewers: [{ display_name: 'Former user' }], close_source_branch: undefined }) }],
        ['PUT', PR, { json: pull({ draft: false }) }],
      ])
      yield* bare.host.markReady(ace, yield* host.change(ace, 552))
      assert.deepStrictEqual(bare.sent.find((request) => request.method === 'PUT')?.body, {
        title: 'ONECLOUD-13657/add on settings',
        description: '',
        reviewers: [],
        draft: false,
      })
    }),
  )

  it.effect('merges the head it saw, in the first way the target branch allows', () =>
    Effect.gen(function* () {
      let merged = false
      const { host, sent } = cloud([
        ['GET', PR, () => ({ json: pull(merged ? { state: 'MERGED', draft: false } : { draft: false }) })],
        ['GET', `${ACE}/refs/branches/master`, { json: master }],
        [
          'POST',
          `${PR}/merge`,
          () => {
            merged = true
            return { json: pull({ state: 'MERGED' }) }
          },
        ],
      ])
      const seen = yield* host.change(ace, 552)
      // Git's forty characters name the same head as Bitbucket's twelve.
      const done = yield* host.merge(ace, { ...seen, headSha: '7f9d4e6279c8a1b2c3d4e5f60718293a4b5c6d7e' })
      assert.strictEqual(done.state, 'merged')
      // The way the repository chose, not Althar's first.
      assert.deepStrictEqual(sent.find((request) => request.method === 'POST')?.body, { merge_strategy: 'merge_commit' })
      const unchosen = cloud([
        ['GET', PR, { json: pull({ draft: false }) }],
        ['GET', `${ACE}/refs/branches/master`, { json: { ...master, default_merge_strategy: null } }],
        ['POST', `${PR}/merge`, { json: pull({ state: 'MERGED' }) }],
      ])
      yield* unchosen.host.merge(ace, { ...seen, headSha: null })
      assert.deepStrictEqual(unchosen.sent.find((request) => request.method === 'POST')?.body, { merge_strategy: 'squash' })
    }),
  )

  it.effect('won’t merge a head it hasn’t seen, and says why Bitbucket won’t', () =>
    Effect.gen(function* () {
      const moved = cloud([['GET', PR, { json: pull({ source: { branch: { name: 'x' }, commit: { hash: '0123456789ab' } } }) }]])
      const seen = { ...(yield* moved.host.change(ace, 552)), headSha: '7f9d4e6279c8' }
      const error = yield* Effect.flip(moved.host.merge(ace, seen))
      // The runtime reads a 409 as "changed since you looked", as it does GitHub's.
      assert.deepInclude(error, { reason: 'rejected', status: 409 })
      assert.isFalse(moved.sent.some((request) => request.method === 'POST'))
      const refusing = cloud([
        ['GET', PR, { json: pull() }],
        ['GET', `${ACE}/refs/branches/master`, { json: { name: 'master' } }],
        [
          'POST',
          `${PR}/merge`,
          { status: 400, json: { type: 'error', error: { message: 'You can’t merge until you resolve all merge checks.' } } },
        ],
      ])
      const refused = yield* Effect.flip(refusing.host.merge(ace, { ...seen, headSha: null }))
      assert.deepInclude(refused, { reason: 'rejected', message: 'You can’t merge until you resolve all merge checks.' })
      assert.deepStrictEqual(refusing.sent.find((request) => request.method === 'POST')?.body, {})
    }),
  )

  it('reads a commit status’s state', () => {
    assert.strictEqual(statusState('SUCCESSFUL'), 'passed')
    assert.strictEqual(statusState('FAILED'), 'failed')
    assert.strictEqual(statusState('INPROGRESS'), 'running')
    assert.strictEqual(statusState('STOPPED'), 'cancelled')
    assert.strictEqual(statusState('SOMETHING_NEW'), 'neutral')
  })

  it('keeps Bitbucket’s times as the model does', () => {
    assert.strictEqual(iso('2023-11-20T17:45:17.742314+00:00'), '2023-11-20T17:45:17.742Z')
    assert.strictEqual(iso('2026-10-07T04:48:34+01:00'), '2026-10-07T03:48:34.000Z')
  })

  it.effect('reads checks from the head’s statuses, and knows a Pipelines run by its link', () =>
    Effect.gen(function* () {
      const status = (overrides: Record<string, unknown>) => ({
        type: 'build',
        refname: 'renovate/nock-15.x',
        created_on: '2026-10-07T04:48:50.371216+00:00',
        updated_on: '2026-10-07T04:49:30.770286+00:00',
        ...overrides,
      })
      const { host, sent } = cloud([
        [
          'GET',
          `${ACE}/commit/bc4323d6cdc1/statuses?pagelen=100`,
          {
            json: {
              values: [
                status({
                  key: 'renovate/stability-days',
                  state: 'SUCCESSFUL',
                  name: 'renovate/stability-days',
                  url: 'https://docs.renovatebot.com/key-concepts/minimum-release-age/',
                  description: 'Updates have met minimum release age requirement',
                  refname: null,
                }),
                status({
                  key: 'default',
                  state: 'FAILED',
                  name: 'Pipeline - default',
                  url: 'https://bitbucket.org/atlassian/atlassian-connect-express/pipelines/results/3025',
                  description: '',
                }),
                // Before Pipelines moved, its links went through the add-on.
                status({
                  key: '-142338526',
                  state: 'INPROGRESS',
                  name: 'Pipeline #188 for feature/BCAT-5931',
                  url: 'https://bitbucket.org/atlassian/atlassian-connect-express/addon/pipelines/home#!/results/188',
                }),
                // Another repository's run has its logs there.
                status({ key: 'fork', state: 'STOPPED', url: 'https://bitbucket.org/someone/fork/pipelines/results/7' }),
                status({ key: 'jenkins', state: 'SUCCESSFUL', url: null }),
              ],
              pagelen: 100,
              size: 5,
              page: 1,
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.checks(ace, 'bc4323d6cdc1'), [
        {
          id: 'status:renovate/stability-days',
          name: 'renovate/stability-days',
          state: 'passed',
          url: 'https://docs.renovatebot.com/key-concepts/minimum-release-age/',
          summary: 'Updates have met minimum release age requirement',
        },
        {
          id: 'pipeline:3025',
          name: 'Pipeline - default',
          state: 'failed',
          url: 'https://bitbucket.org/atlassian/atlassian-connect-express/pipelines/results/3025',
          summary: null,
        },
        {
          id: 'pipeline:188',
          name: 'Pipeline #188 for feature/BCAT-5931',
          state: 'running',
          url: 'https://bitbucket.org/atlassian/atlassian-connect-express/addon/pipelines/home#!/results/188',
          summary: null,
        },
        {
          id: 'status:fork',
          name: 'fork',
          state: 'cancelled',
          url: 'https://bitbucket.org/someone/fork/pipelines/results/7',
          summary: null,
        },
        { id: 'status:jenkins', name: 'jenkins', state: 'passed', url: null, summary: null },
      ])
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('reads the end of a failed Pipelines step’s log, and nothing for other checks', () =>
    Effect.gen(function* () {
      const long = Array.from({ length: 300 }, (_, n) => `line ${n}`).join('\n')
      const step = (uuid: string, result: string | null) => ({
        type: 'pipeline_step',
        uuid,
        name: null,
        state: { name: 'COMPLETED', type: 'pipeline_step_state_completed', result: result === null ? null : { name: result } },
      })
      const run = `${ACE}/pipelines`
      const { host, sent } = cloud([
        ['GET', `${run}/3025/steps?pagelen=100`, { json: { values: [step('{a}', 'SUCCESSFUL'), step('{b}', 'FAILED')], pagelen: 2 } }],
        ['GET', `${run}/3025/steps/%7Bb%7D/log`, { text: long }],
        ['GET', `${run}/3024/steps?pagelen=100`, { json: { values: [step('{c}', 'SUCCESSFUL'), { uuid: '{d}', state: null }] } }],
        ['GET', `${run}/3023/steps?pagelen=100`, { json: { values: [step('{e}', 'ERROR')] } }],
        [
          'GET',
          `${run}/3023/steps/%7Be%7D/log`,
          { status: 404, json: { error: { message: 'Not Found', detail: 'Log in step {e} does not exist.' } } },
        ],
        ['GET', `${run}/3022/steps?pagelen=100`, { status: 500, text: 'down' }],
      ])
      const check = { name: 'Pipeline - default', state: 'failed' as const, url: null, summary: null }
      const log = yield* host.checkLog(ace, { ...check, id: 'pipeline:3025' })
      assert.strictEqual(log?.split('\n').length, 150)
      assert.isTrue(log?.endsWith('line 299'))
      assert.strictEqual(sent[1]?.headers.accept, '*/*')
      assert.isNull(yield* host.checkLog(ace, { ...check, id: 'pipeline:3024' }))
      assert.isNull(yield* host.checkLog(ace, { ...check, id: 'pipeline:3023' }))
      assert.isNull(yield* host.checkLog(ace, { ...check, id: 'status:jenkins' }))
      assert.strictEqual((yield* Effect.flip(host.checkLog(ace, { ...check, id: 'pipeline:3022' }))).reason, 'unreachable')
    }),
  )

  const comment = (id: number, user: object, updated: string, overrides: Record<string, unknown> = {}) => ({
    type: 'pullrequest_comment',
    id,
    content: { raw: `Comment ${id}`, markup: 'markdown' },
    user,
    created_on: updated,
    updated_on: updated,
    deleted: false,
    pending: false,
    links: { html: { href: `https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552/_/diff#comment-${id}` } },
    ...overrides,
  })
  const inline = { from: null, to: 364, path: 'lib/store/sequelize.js', start_from: null, start_to: null }
  const comments = [
    comment(672805515, rovo, '2025-08-21T07:30:06.270878+00:00'),
    comment(672854442, mitch, '2025-08-21T09:08:55.320008+00:00', { inline, parent: null }),
    comment(672856085, vincent, '2025-08-21T09:27:42.939185+00:00', { inline, parent: { id: 672854442 } }),
    comment(672862654, vincent, '2025-08-21T09:26:28.539650+00:00', {
      inline: { ...inline, to: null, from: 360 },
      parent: { id: 672856085 },
    }),
    // A reply to one Bitbucket no longer lists starts a thread of its own, which a reply can still join.
    comment(672870474, vincent, '2025-08-21T09:40:24.782151+00:00', { parent: { id: 1 }, content: { raw: null } }),
    comment(672870475, vincent, '2025-08-21T09:41:00.000000+00:00', { deleted: true }),
    comment(672870476, mitch, '2025-08-21T09:42:00.000000+00:00', { pending: true }),
    comment(672870477, { display_name: 'Former user' }, '2025-08-21T09:43:00.000000+00:00', { user: undefined, links: undefined }),
  ]
  const activity = (entries: ReadonlyArray<object>, next?: string) => ({
    values: entries,
    pagelen: 50,
    ...(next === undefined ? {} : { next }),
  })
  const approval = (user: object, date: string) => ({ approval: { date, user, pullrequest: { type: 'pullrequest', id: 552 } } })
  const changes = (user: object, date: string) => ({ changes_requested: { date, user, pullrequest: { type: 'pullrequest', id: 552 } } })
  const member = (user: { readonly uuid: string }, yes: boolean): Route => [
    'GET',
    `${CLOUD}/workspaces/atlassian/members/${encodeURIComponent(user.uuid)}`,
    yes ? { json: { type: 'workspace_membership', user } } : { status: 404, json: { type: 'error', error: { message: 'Not a member' } } },
  ]

  it.effect('finds each reply’s thread even should an answer loop', () =>
    Effect.gen(function* () {
      const { host } = cloud([
        [
          'GET',
          `${PR}/comments?pagelen=100`,
          {
            json: {
              values: [
                comment(1, mitch, '2025-08-21T09:08:55.320008+00:00', { parent: { id: 2 } }),
                comment(2, mitch, '2025-08-21T09:09:55.320008+00:00', { parent: { id: 1 } }),
              ],
              pagelen: 100,
            },
          },
        ],
        ['GET', `${PR}/activity?pagelen=50`, { json: activity([]) }],
        member(mitch, true),
      ])
      const said = yield* host.activity(ace, 552, null)
      assert.deepStrictEqual(
        said.comments.map((one) => one.id),
        ['1', '2'],
      )
    }),
  )

  it.effect('reads what was said since a cursor, each reply in its thread, and who of the workspace said it', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        [
          'GET',
          `${PR}/comments?pagelen=100`,
          { json: { values: comments.slice(0, 4), next: `${PR}/comments?pagelen=100&page=2`, pagelen: 100 } },
        ],
        ['GET', `${PR}/comments?pagelen=100&page=2`, { json: { values: comments.slice(4), pagelen: 100 } }],
        [
          'GET',
          `${PR}/activity?pagelen=50`,
          {
            json: activity(
              [
                { update: { date: '2025-08-22T07:42:42.339018+00:00', state: 'OPEN' } },
                changes(mitch, '2025-08-21T10:00:00.000000+00:00'),
                approval(vincent, '2025-08-21T09:50:00.000000+00:00'),
                { comment: { id: 672854442, created_on: '2025-08-21T09:08:23.253704+00:00' } },
              ],
              `${PR}/activity?pagelen=50&ctx=older`,
            ),
          },
        ],
        [
          'GET',
          `${PR}/activity?pagelen=50&ctx=older`,
          {
            json: activity(
              [{ update: { date: '2025-08-21T07:23:15.940561+00:00', state: 'OPEN' } }],
              `${PR}/activity?pagelen=50&ctx=oldest`,
            ),
          },
        ],
        member(mitch, true),
        member(vincent, false),
      ])
      const said = yield* host.activity(ace, 552, '2025-08-21T09:00:00.000Z')
      assert.deepStrictEqual(
        said.comments.map((one) => [one.id, one.author.login, one.member, one.threadId, one.path, one.line, one.body]),
        [
          ['672854442', 'Mitch McCue', true, '672854442', 'lib/store/sequelize.js', 364, 'Comment 672854442'],
          ['672862654', 'Vincent Nguyen', false, '672854442', 'lib/store/sequelize.js', 360, 'Comment 672862654'],
          ['672856085', 'Vincent Nguyen', false, '672854442', 'lib/store/sequelize.js', 364, 'Comment 672856085'],
          ['672870474', 'Vincent Nguyen', false, '672870474', null, null, ''],
          ['672870477', 'ghost', false, '672870477', null, null, 'Comment 672870477'],
        ],
      )
      assert.strictEqual(
        said.comments[0]?.url,
        'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552/_/diff#comment-672854442',
      )
      assert.isNull(said.comments[4]?.url)
      assert.deepStrictEqual(
        said.reviews.map((review) => [review.verdict, review.author.login, review.member, review.at]),
        [
          ['approved', 'Vincent Nguyen', false, '2025-08-21T09:50:00.000Z'],
          ['changes_requested', 'Mitch McCue', true, '2025-08-21T10:00:00.000Z'],
        ],
      )
      assert.strictEqual(said.reviews[0]?.url, 'https://bitbucket.org/atlassian/atlassian-connect-express/pull-requests/552')
      assert.strictEqual(said.cursor, '2025-08-21T10:00:00.000Z')
      // The activity is newest first: a page that ends before the cursor is the last one asked for.
      assert.isTrue(sent.some((request) => request.url.includes('ctx=older')))
      assert.isFalse(sent.some((request) => request.url.includes('ctx=oldest')))
      // Each author asked about once.
      assert.lengthOf(
        sent.filter((request) => request.url.includes('/members/')),
        2,
      )
    }),
  )

  it.effect('reads everything from the start without a cursor, a bot’s comments included', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        ['GET', `${PR}/comments?pagelen=100`, { json: { values: comments.slice(0, 1) } }],
        [
          'GET',
          `${PR}/activity?pagelen=50`,
          { json: activity([approval(mitch, '2025-08-21T07:00:00.000000+00:00')], `${PR}/activity?p=2`) },
        ],
        ['GET', `${PR}/activity?p=2`, { json: activity([changes({ display_name: 'Former user' }, '2025-08-21T06:00:00.000000+00:00')]) }],
        member(rovo, false),
        member(mitch, true),
      ])
      const said = yield* host.activity(ace, 552, null)
      assert.deepStrictEqual(
        said.comments.map((one) => [one.author.login, one.author.bot, one.threadId]),
        [['Rovo Dev', true, '672805515']],
      )
      assert.deepStrictEqual(
        said.reviews.map((review) => [review.verdict, review.author.login, review.member]),
        [
          ['changes_requested', 'Former user', false],
          ['approved', 'Mitch McCue', true],
        ],
      )
      assert.strictEqual(said.cursor, '2025-08-21T07:30:06.270Z')
      assert.isTrue(sent.some((request) => request.url.endsWith('p=2')))
      const quiet = cloud([
        ['GET', `${PR}/comments?pagelen=100`, { json: { values: [] } }],
        ['GET', `${PR}/activity?pagelen=50`, { json: activity([]) }],
      ])
      assert.deepStrictEqual(yield* quiet.host.activity(ace, 552, '2025-08-21T09:00:00.000Z'), {
        comments: [],
        reviews: [],
        cursor: '2025-08-21T09:00:00.000Z',
      })
    }),
  )

  it.effect('follows a next page only on Bitbucket’s API, where the credential may go', () =>
    Effect.gen(function* () {
      const { host, sent } = cloud([
        [
          'GET',
          `${PR}/comments?pagelen=100`,
          { json: { values: comments.slice(0, 1), next: 'https://bitbucket.example.com/2.0/comments?page=2' } },
        ],
        [
          'GET',
          `${PR}/activity?pagelen=50`,
          { json: activity([approval(mitch, '2025-08-21T07:00:00.000000+00:00')], `${CLOUD}.example.com/activity?page=2`) },
        ],
        member(rovo, false),
        member(mitch, true),
      ])
      const said = yield* host.activity(ace, 552, null)
      assert.lengthOf(said.comments, 1)
      assert.lengthOf(said.reviews, 1)
      assert.isFalse(sent.some((request) => request.url.includes('example.com')))
    }),
  )

  it.effect('counts everyone an outsider when the workspace’s members can’t be read, says so once, and goes on listening', () =>
    Effect.gen(function* () {
      const logged: Array<{ readonly level: string; readonly message: unknown }> = []
      const logger = Logger.make(({ logLevel, message }) => logged.push({ level: logLevel, message }))
      const scopes = {
        status: 403,
        json: {
          type: 'error',
          error: {
            message: 'Your credentials lack one or more required privilege scopes.',
            detail: { granted: [], required: ['workspace'] },
          },
        },
      }
      const { host, sent } = cloud([
        ['GET', `${PR}/comments?pagelen=100`, { json: { values: comments.slice(1, 3) } }],
        ['GET', `${PR}/activity?pagelen=50`, { json: activity([]) }],
        ['GET', /\/members\//, scopes],
      ])
      const first = yield* host.activity(ace, 552, null).pipe(Effect.provide(Logger.layer([logger])))
      assert.deepStrictEqual(
        first.comments.map((one) => [one.author.login, one.member]),
        [
          ['Mitch McCue', false],
          ['Vincent Nguyen', false],
        ],
      )
      const again = yield* host.activity(ace, 552, null).pipe(Effect.provide(Logger.layer([logger])))
      assert.lengthOf(again.comments, 2)
      assert.lengthOf(
        sent.filter((request) => request.url.includes('/members/')),
        4,
      )
      const warnings = logged.filter((entry) => entry.level === 'Warn')
      assert.lengthOf(warnings, 1)
      assert.include(String(warnings[0]?.message), 'Your credentials lack one or more required privilege scopes.')
    }),
  )

  it.effect('replies in a thread, or in the conversation', () =>
    Effect.gen(function* () {
      const answer = comment(672900000, vincent, '2025-08-22T08:00:00.000000+00:00')
      const { host, sent } = cloud([['POST', `${PR}/comments`, { status: 201, json: answer }]])
      const threaded = yield* host.reply(ace, 552, { body: 'Done', threadId: '672854442' })
      assert.deepInclude(threaded, { threadId: '672854442', member: true })
      assert.deepStrictEqual(sent[0]?.body, { content: { raw: 'Done' }, parent: { id: 672854442 } })
      const loose = yield* host.reply(ace, 552, { body: 'Done', threadId: null })
      assert.strictEqual(loose.threadId, '672900000')
      assert.deepStrictEqual(sent[1]?.body, { content: { raw: 'Done' } })
    }),
  )

  it.effect('pushes over HTTPS with the token, as Bitbucket’s own user for it', () =>
    Effect.gen(function* () {
      const target = yield* cloud([]).host.pushTarget(ace)
      assert.strictEqual(target.url, 'https://bitbucket.org/atlassian/atlassian-connect-express.git')
      assert.strictEqual(target.header, `Authorization: Basic ${Buffer.from('x-bitbucket-api-token-auth:ATATT3x').toString('base64')}`)
      const access = yield* cloud([], 'bearer').host.pushTarget(ace)
      assert.strictEqual(access.header, `Authorization: Basic ${Buffer.from('x-token-auth:ATCTT3x').toString('base64')}`)
    }),
  )
})

const SERVER = 'https://git.meridian.dev'
const DC = `${SERVER}/rest/api/latest`
const MY = `${DC}/projects/PRJ/repos/my-repo`
const PULL = `${MY}/pull-requests/101`

const prj: Repository = {
  id: '1',
  path: ['PRJ', 'my-repo'],
  defaultBranch: 'master',
  webUrl: `${SERVER}/projects/PRJ/repos/my-repo`,
  canPush: true,
  // The repository's own choice, a merge commit, first.
  merges: ['merge', 'squash'],
}

const center = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: dc.makeBitbucketDataCenter({
      fetch,
      apiUrl: `${DC}/`,
      webUrl: `${SERVER}/`,
      credential: Effect.succeed({ kind: 'bearer', token: 'BBDC-t' }),
    }),
    sent,
  }
}

const jane = {
  name: 'jcitizen',
  emailAddress: 'jane@example.com',
  id: 101,
  displayName: 'Jane Citizen',
  active: true,
  slug: 'jcitizen',
  type: 'NORMAL',
}
const tom = { name: 'tom', emailAddress: 'tom@example.com', id: 115026, displayName: 'Tom', active: true, slug: 'tom', type: 'NORMAL' }
const bot = { name: 'bot-prj-1', id: 7, displayName: 'Project token', active: true, slug: 'bot-prj-1', type: 'SERVICE' }

const page = (values: ReadonlyArray<unknown>, nextPageStart?: number) => ({
  size: values.length,
  limit: 100,
  isLastPage: nextPageStart === undefined,
  values,
  start: 0,
  ...(nextPageStart === undefined ? {} : { nextPageStart }),
})

const ref = (branch: string, commit: string, project = 'PRJ') => ({
  id: `refs/heads/${branch}`,
  displayId: branch,
  latestCommit: commit,
  type: 'BRANCH',
  repository: { slug: 'my-repo', id: 1, name: 'My repo', project: { key: project, id: 1, name: 'My Cool Project' } },
})

const pr = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  version: 3,
  title: 'Talking Nerdy',
  description: 'It’s a kludge, but put the tuple from the database in the cache.',
  state: 'OPEN',
  open: true,
  closed: false,
  draft: true,
  createdDate: 1359075920000,
  updatedDate: 1359085920000,
  fromRef: ref('feature-ABC-123', 'babecafebabecafebabecafebabecafebabecafe'),
  toRef: ref('master', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
  locked: false,
  author: { user: tom, role: 'AUTHOR', approved: false, status: 'UNAPPROVED' },
  reviewers: [
    { user: jane, lastReviewedCommit: '7549846524f8aed2bd1c0249993ae1bf9d3c9998', role: 'REVIEWER', approved: true, status: 'APPROVED' },
  ],
  participants: [],
  links: { self: [{ href: `${SERVER}/projects/PRJ/repos/my-repo/pull-requests/101` }] },
  ...overrides,
})

/** Data Center says who is signed in only in a header. */
const whoami = (name: string | null, id?: string): Route => [
  'GET',
  `${DC}/application-properties`,
  {
    json: { version: '9.4.2', buildNumber: '9004002', buildDate: '1718694830000', displayName: 'Bitbucket' },
    headers: { ...(name === null ? {} : { 'x-ausername': name }), ...(id === undefined ? {} : { 'x-auserid': id }) },
  },
]

describe('Bitbucket Data Center as a code host', () => {
  it.effect('says who it is signed in as, from the header it answers with', () =>
    Effect.gen(function* () {
      const { host, sent } = center([whoami('jcitizen', '101'), ['GET', `${DC}/users?filter=jcitizen&limit=100`, { json: page([jane]) }]])
      assert.deepStrictEqual(yield* host.account, { id: '101', login: 'jcitizen', name: 'Jane Citizen' })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer BBDC-t')
      assert.deepStrictEqual(host.capabilities, { drafts: true, checkLogs: false, threads: true })
      // A project's token signs in as a service account, which the users aren't listed with.
      const project = center([whoami('bot-prj-1', '7'), ['GET', /\/users\?filter=/, { json: page([]) }]])
      assert.deepStrictEqual(yield* project.host.account, { id: '7', login: 'bot-prj-1', name: null })
      const unlisted = center([whoami('bot-prj-1'), ['GET', /\/users\?filter=/, { status: 401, json: { errors: [{ message: 'No' }] } }]])
      assert.deepStrictEqual(yield* unlisted.host.account, { id: 'bot-prj-1', login: 'bot-prj-1', name: null })
      // Signed in as no one, the token is no good.
      assert.strictEqual((yield* Effect.flip(center([whoami(null)]).host.account)).reason, 'unauthorized')
    }),
  )

  it.effect('tells an account that may not do something from a token that no longer works, though both are 401', () =>
    Effect.gen(function* () {
      const denied = {
        status: 401,
        json: { errors: [{ context: null, message: 'You are not permitted to access this resource', exceptionName: null }] },
      }
      const signedIn = center([whoami('jcitizen'), ['GET', MY, denied]])
      assert.deepInclude(yield* Effect.flip(signedIn.host.repository(['PRJ', 'my-repo'])), {
        reason: 'forbidden',
        status: 401,
        message: 'You are not permitted to access this resource',
      })
      const expired = center([
        ['GET', `${DC}/application-properties`, { status: 401, json: { errors: [{ message: 'Authentication failed' }] } }],
        ['GET', MY, denied],
      ])
      assert.strictEqual((yield* Effect.flip(expired.host.repository(['PRJ', 'my-repo']))).reason, 'unauthorized')
    }),
  )

  it.effect('reads a repository from its remote: its default branch, whether the account may push, and how it merges', () =>
    Effect.gen(function* () {
      const repository = {
        slug: 'my-repo',
        id: 1,
        name: 'My repo',
        hierarchyId: 'e3c939f9ef4a7fae272e',
        scmId: 'git',
        state: 'AVAILABLE',
        forkable: true,
        project: { key: 'PRJ', id: 1, name: 'My Cool Project', public: false, type: 'NORMAL' },
        public: false,
        links: {
          clone: [{ href: `${SERVER}/scm/prj/my-repo.git`, name: 'http' }],
          self: [{ href: `${SERVER}/projects/PRJ/repos/my-repo/browse` }],
        },
      }
      const strategy = (id: string, enabled: boolean) => ({ id, enabled, flag: '', name: id })
      const { host, sent } = center([
        ['GET', `${DC}/projects/prj/repos/my-repo`, { json: repository }],
        ['GET', `${MY}/default-branch`, { json: { id: 'refs/heads/master', displayId: 'master', type: 'BRANCH' } }],
        ['GET', `${DC}/repos?projectkey=PRJ&name=My%20repo&permission=REPO_WRITE&limit=100`, { json: page([{ id: 2 }, { id: 1 }]) }],
        [
          'GET',
          `${MY}/settings/pull-requests`,
          {
            json: {
              mergeConfig: {
                defaultStrategy: strategy('no-ff', true),
                strategies: [strategy('no-ff', true), strategy('ff', true), strategy('squash', true), strategy('rebase-ff-only', false)],
                type: 'REPOSITORY',
              },
              requiredApprovers: 0,
            },
          },
        ],
        [
          'GET',
          `${DC}/projects/~DANA/repos/scratch`,
          { json: { ...repository, slug: 'scratch', id: 9, project: { key: '~DANA' }, links: {} } },
        ],
        ['GET', `${DC}/projects/~DANA/repos/scratch/default-branch`, { json: { id: 'refs/heads/main', displayId: 'main' } }],
        ['GET', /\/repos\?projectkey=~DANA/, { json: page([]) }],
        ['GET', `${DC}/projects/~DANA/repos/scratch/settings/pull-requests`, { json: {} }],
      ])
      // An HTTPS remote's path, under the server's own path, with the project's key as git spells it.
      assert.deepStrictEqual(yield* host.repository(['bitbucket', 'scm', 'prj', 'my-repo']), prj)
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer BBDC-t')
      const own = yield* host.repository(['~DANA', 'scratch'])
      assert.deepStrictEqual(own, {
        id: '9',
        path: ['~DANA', 'scratch'],
        defaultBranch: 'main',
        webUrl: `${SERVER}/projects/~DANA/repos/scratch`,
        canPush: false,
        merges: [],
      })
    }),
  )

  it('merges the way the repository chose, or else in Althar’s order of the ways it allows', () => {
    assert.deepStrictEqual(dc.mergesOf(['no-ff', 'ff', 'squash'], 'no-ff'), ['merge', 'squash'])
    assert.deepStrictEqual(dc.mergesOf(['no-ff', 'ff', 'squash']), ['squash', 'merge'])
    assert.deepStrictEqual(dc.mergesOf(['ff-only', 'rebase-no-ff'], 'squash'), ['merge', 'rebase'])
    assert.strictEqual(dc.strategyOf(['no-ff', 'squash'], 'no-ff'), 'no-ff')
    assert.strictEqual(dc.strategyOf(['no-ff', 'squash'], 'ff-only'), 'squash')
    assert.strictEqual(dc.strategyOf(['ff', 'no-ff']), 'no-ff')
    assert.strictEqual(dc.strategyOf(['squash-ff-only', 'squash']), 'squash')
    assert.strictEqual(dc.strategyOf(['ff-only', 'rebase-ff-only']), 'rebase-ff-only')
    assert.isUndefined(dc.strategyOf([]))
  })

  it.effect('finds the open pull request from a branch into this repository', () =>
    Effect.gen(function* () {
      const { host, sent } = center([
        [
          'GET',
          `${MY}/pull-requests?at=refs%2Fheads%2Ffeature-ABC-123&direction=OUTGOING&state=OPEN`,
          // From this branch into a fork's parent isn't this repository's.
          { json: page([pr({ id: 7, toRef: ref('master', 'deadbeef', 'UPSTREAM') }), pr()]) },
        ],
        ['GET', /pull-requests\?at=refs%2Fheads%2Fother/, { json: page([pr({ fromRef: ref('other-too', 'babecafe') })]) }],
      ])
      assert.deepStrictEqual(yield* host.findChange(prj, 'feature-ABC-123'), {
        id: '1:101',
        number: 101,
        title: 'Talking Nerdy',
        body: 'It’s a kludge, but put the tuple from the database in the cache.',
        url: `${SERVER}/projects/PRJ/repos/my-repo/pull-requests/101`,
        state: 'open',
        draft: true,
        source: 'feature-ABC-123',
        target: 'master',
        headSha: 'babecafebabecafebabecafebabecafebabecafe',
        author: { id: '115026', login: 'tom', name: 'Tom', bot: false },
        additions: null,
        deletions: null,
        changedFiles: null,
        updatedAt: '2013-01-25T03:52:00.000Z',
      })
      assert.isNull(yield* host.findChange(prj, 'other'))
      assert.lengthOf(sent, 2)
    }),
  )

  it.effect('opens a draft pull request, adopts one open from its branch, and says why Data Center refuses', () =>
    Effect.gen(function* () {
      let open = false
      const { host, sent } = center([
        ['GET', /pull-requests\?at=/, () => ({ json: page(open ? [pr()] : []) })],
        [
          'POST',
          `${MY}/pull-requests`,
          () => {
            open = true
            return { status: 201, json: pr() }
          },
        ],
      ])
      const change = { title: 'Talking Nerdy', body: 'Body', source: 'feature-ABC-123', target: 'master', draft: true }
      assert.strictEqual((yield* host.openChange(prj, change)).number, 101)
      assert.deepStrictEqual(sent.find((request) => request.method === 'POST')?.body, {
        title: 'Talking Nerdy',
        description: 'Body',
        fromRef: { id: 'refs/heads/feature-ABC-123', repository: { slug: 'my-repo', project: { key: 'PRJ' } } },
        toRef: { id: 'refs/heads/master', repository: { slug: 'my-repo', project: { key: 'PRJ' } } },
        draft: true,
      })
      assert.strictEqual((yield* host.openChange(prj, change)).number, 101)
      assert.lengthOf(
        sent.filter((request) => request.method === 'POST'),
        1,
      )
      let asked = 0
      const raced = center([
        ['GET', /pull-requests\?at=/, () => ({ json: page((asked += 1) === 1 ? [] : [pr()]) })],
        [
          'POST',
          `${MY}/pull-requests`,
          {
            status: 409,
            json: {
              errors: [
                {
                  context: null,
                  message: 'Only one pull request may be open for a given source and target branch',
                  exceptionName: 'com.atlassian.bitbucket.pull.DuplicatePullRequestException',
                },
              ],
            },
          },
        ],
      ])
      assert.strictEqual((yield* raced.host.openChange(prj, change)).number, 101)
      const refused = center([
        ['GET', /pull-requests\?at=/, { json: page([]) }],
        [
          'POST',
          `${MY}/pull-requests`,
          { status: 409, json: { errors: [{ message: 'The target branch is already up-to-date with the source branch.' }] } },
        ],
      ])
      assert.deepInclude(yield* Effect.flip(refused.host.openChange(prj, change)), {
        reason: 'rejected',
        message: 'The target branch is already up-to-date with the source branch.',
      })
    }),
  )

  it.effect('opens one from a fork’s branch into the repository it was forked from, and finds it from the fork', () =>
    Effect.gen(function* () {
      const fork: Repository = { ...prj, id: '2', path: ['~YOU', 'my-repo'] }
      const { host, sent } = center([
        ['GET', /\/projects\/~YOU\/repos\/my-repo\/pull-requests\?at=/, { json: page([]) }],
        ['POST', `${MY}/pull-requests`, { status: 201, json: pr() }],
      ])
      const change = { title: 't', body: '', source: 'feature-ABC-123', target: 'master', draft: false, from: fork }
      assert.strictEqual((yield* host.openChange(prj, change)).number, 101)
      assert.deepStrictEqual((sent[1]?.body as { fromRef: unknown } | undefined)?.fromRef, {
        id: 'refs/heads/feature-ABC-123',
        repository: { slug: 'my-repo', project: { key: '~YOU' } },
      })
    }),
  )

  it.effect('reads a pull request’s state: open, merged, declined', () =>
    Effect.gen(function* () {
      const { host } = center([
        ['GET', `${MY}/pull-requests/1`, { json: pr({ id: 1, state: 'MERGED', draft: undefined, author: null, links: undefined }) }],
        ['GET', `${MY}/pull-requests/2`, { json: pr({ id: 2, state: 'DECLINED', description: null }) }],
      ])
      const merged = yield* host.change(prj, 1)
      assert.deepInclude(merged, { state: 'merged', draft: false, author: null, url: `${prj.webUrl}/pull-requests/1` })
      assert.deepInclude(yield* host.change(prj, 2), { state: 'closed', body: '' })
    }),
  )

  it.effect('marks a draft ready at the version it read, keeping its reviewers', () =>
    Effect.gen(function* () {
      const { host, sent } = center([
        ['GET', PULL, { json: pr() }],
        ['PUT', PULL, { json: pr({ draft: false, version: 4 }) }],
      ])
      assert.isFalse((yield* host.markReady(prj, yield* host.change(prj, 101))).draft)
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, {
        version: 3,
        title: 'Talking Nerdy',
        description: 'It’s a kludge, but put the tuple from the database in the cache.',
        reviewers: [{ user: { name: 'jcitizen' } }],
        draft: false,
      })
      const ready = center([['GET', PULL, { json: pr({ draft: false, description: undefined, reviewers: undefined }) }]])
      assert.isFalse((yield* ready.host.markReady(prj, yield* host.change(prj, 101))).draft)
      assert.isFalse(ready.sent.some((request) => request.method === 'PUT'))
    }),
  )

  const settings = (defaultStrategy?: object) => ({
    json: {
      mergeConfig: {
        ...(defaultStrategy === undefined ? {} : { defaultStrategy }),
        strategies: [
          { id: 'no-ff', enabled: true },
          { id: 'squash', enabled: true },
        ],
      },
    },
  })

  it.effect('merges the head it saw, at the version it read, in the first way the repository allows', () =>
    Effect.gen(function* () {
      const { host, sent } = center([
        ['GET', PULL, { json: pr({ draft: false }) }],
        ['GET', `${MY}/settings/pull-requests`, settings({ id: 'no-ff', enabled: true, flag: '--no-ff', name: 'Merge commit' })],
        ['POST', `${PULL}/merge?version=3`, { json: pr({ state: 'MERGED', version: 4 }) }],
      ])
      const merged = yield* host.merge(prj, yield* host.change(prj, 101))
      assert.strictEqual(merged.state, 'merged')
      // The way the repository chose, not Althar's first.
      assert.deepStrictEqual(sent.find((request) => request.method === 'POST')?.body, { strategyId: 'no-ff' })
      // A choice that is off leaves Althar's order.
      const off = center([
        ['GET', PULL, { json: pr({ draft: false }) }],
        ['GET', `${MY}/settings/pull-requests`, settings({ id: 'rebase-ff-only', enabled: false })],
        ['POST', `${PULL}/merge?version=3`, { json: pr({ state: 'MERGED', version: 4 }) }],
      ])
      yield* off.host.merge(prj, yield* host.change(prj, 101))
      assert.deepStrictEqual(off.sent.find((request) => request.method === 'POST')?.body, { strategyId: 'squash' })
      const moved = center([['GET', PULL, { json: pr({ fromRef: ref('feature-ABC-123', '0123456789abcdef0123456789abcdef01234567') }) }]])
      const error = yield* Effect.flip(
        moved.host.merge(prj, { ...merged, state: 'open', headSha: 'babecafebabecafebabecafebabecafebabecafe' }),
      )
      // The runtime reads a 409 as "changed since you looked", as it does GitHub's.
      assert.deepInclude(error, { reason: 'rejected', status: 409 })
      assert.isFalse(moved.sent.some((request) => request.method === 'POST'))
    }),
  )

  it.effect('tells a 409 for a pull request changed meanwhile from one Data Center won’t merge, in its own words', () =>
    Effect.gen(function* () {
      const conflict = (message: string) => ({ status: 409, json: { errors: [{ context: null, message, exceptionName: null }] } })
      const outOfDate = center([
        ['GET', PULL, { json: pr({ fromRef: { ...ref('feature-ABC-123', ''), latestCommit: null } }) }],
        ['GET', `${MY}/settings/pull-requests`, { json: {} }],
        ['POST', `${PULL}/merge?version=3`, conflict('You are attempting to modify a pull request based on out-of-date information.')],
        ['GET', `${PULL}/merge`, { json: { canMerge: true, conflicted: false, outcome: 'CLEAN', vetoes: [] } }],
      ])
      const seen = yield* center([['GET', PULL, { json: pr() }]]).host.change(prj, 101)
      assert.deepInclude(yield* Effect.flip(outOfDate.host.merge(prj, seen)), { reason: 'rejected', status: 409 })
      assert.deepStrictEqual(outOfDate.sent.find((request) => request.method === 'POST')?.body, {})
      const vetoed = center([
        ['GET', PULL, { json: pr() }],
        ['GET', `${MY}/settings/pull-requests`, settings()],
        ['POST', `${PULL}/merge?version=3`, conflict('Merging the pull request has been vetoed.')],
        [
          'GET',
          `${PULL}/merge`,
          {
            json: {
              canMerge: false,
              conflicted: false,
              outcome: 'CLEAN',
              vetoes: [
                { summaryMessage: 'Not all required builds are successful yet', detailedMessage: 'You need 1 more successful build.' },
                { summaryMessage: 'Requires approvals' },
                {},
              ],
            },
          },
        ],
      ])
      const refused = yield* Effect.flip(vetoed.host.merge(prj, seen))
      assert.deepInclude(refused, { reason: 'rejected', message: 'You need 1 more successful build. Requires approvals' })
      assert.isUndefined(refused.status)
      const conflicted = center([
        ['GET', PULL, { json: pr() }],
        ['GET', `${MY}/settings/pull-requests`, settings()],
        ['POST', `${PULL}/merge?version=3`, conflict('The pull request has conflicts and cannot be merged.')],
        ['GET', `${PULL}/merge`, { json: { canMerge: false, conflicted: true, outcome: 'CONFLICTED' } }],
      ])
      assert.strictEqual(
        (yield* Effect.flip(conflicted.host.merge(prj, seen))).message,
        'The pull request has conflicts and cannot be merged.',
      )
    }),
  )

  it('reads a build’s state', () => {
    assert.strictEqual(dc.buildState('SUCCESSFUL'), 'passed')
    assert.strictEqual(dc.buildState('FAILED'), 'failed')
    assert.strictEqual(dc.buildState('INPROGRESS'), 'running')
    assert.strictEqual(dc.buildState('CANCELLED'), 'cancelled')
    assert.strictEqual(dc.buildState('UNKNOWN'), 'neutral')
  })

  it.effect('reads the head’s build statuses, every page, and keeps no logs', () =>
    Effect.gen(function* () {
      const build = (key: string, state: string, overrides: Record<string, unknown> = {}) => ({
        key,
        name: `${key} build`,
        state,
        url: `https://bamboo.example.com/browse/${key}`,
        description: 'A description of the build goes here',
        dateAdded: 1587533099278,
        ...overrides,
      })
      const { host, sent } = center([
        [
          'GET',
          `${SERVER}/rest/build-status/latest/commits/babecafe?limit=100&start=0`,
          { json: page([build('TEST-REP3', 'FAILED'), build('TEST-REP4', 'INPROGRESS', { name: null, url: null, description: '' })], 2) },
        ],
        ['GET', `${SERVER}/rest/build-status/latest/commits/babecafe?limit=100&start=2`, { json: page([build('DEPLOY', 'SUCCESSFUL')]) }],
      ])
      assert.deepStrictEqual(yield* host.checks(prj, 'babecafe'), [
        {
          id: 'status:TEST-REP3',
          name: 'TEST-REP3 build',
          state: 'failed',
          url: 'https://bamboo.example.com/browse/TEST-REP3',
          summary: 'A description of the build goes here',
        },
        { id: 'status:TEST-REP4', name: 'TEST-REP4', state: 'running', url: null, summary: null },
        {
          id: 'status:DEPLOY',
          name: 'DEPLOY build',
          state: 'passed',
          url: 'https://bamboo.example.com/browse/DEPLOY',
          summary: 'A description of the build goes here',
        },
      ])
      assert.lengthOf(sent, 2)
      assert.isNull(yield* host.checkLog(prj, { id: 'status:TEST-REP3', name: 'TEST-REP3', state: 'failed', url: null, summary: null }))
    }),
  )

  const reply = (id: number, author: object, updatedDate: number, comments: ReadonlyArray<object> = []) => ({
    properties: { key: 'value' },
    id,
    version: 1,
    text: `Comment ${id}`,
    author,
    createdDate: updatedDate,
    updatedDate,
    comments,
    tasks: [],
    severity: 'NORMAL',
    state: 'OPEN',
    permittedOperations: { editable: true, deletable: true },
  })
  const at = (iso: string) => Date.parse(iso)
  const activities = page([
    { id: 5, createdDate: at('2026-10-01T10:30:00Z'), user: jane, action: 'REVIEWED' },
    { id: 4, createdDate: at('2026-10-01T10:20:00Z'), user: tom, action: 'APPROVED' },
    {
      id: 3,
      createdDate: at('2026-10-01T10:10:00Z'),
      user: tom,
      action: 'COMMENTED',
      commentAction: 'REPLIED',
      comment: reply(12, tom, at('2026-10-01T10:10:00Z')),
    },
    {
      id: 2,
      createdDate: at('2026-10-01T09:00:00Z'),
      user: jane,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: reply(11, jane, at('2026-10-01T09:00:00Z'), [
        reply(12, tom, at('2026-10-01T10:10:00Z'), [reply(13, bot, at('2026-10-01T10:15:00Z'))]),
        { ...reply(14, jane, at('2026-10-01T10:16:00Z')), pending: true },
      ]),
      commentAnchor: { line: 1, lineType: 'CONTEXT', fileType: 'FROM', path: 'path/to/file', srcPath: 'path/to/file' },
    },
    {
      id: 1,
      createdDate: at('2026-10-01T08:00:00Z'),
      user: jane,
      action: 'COMMENTED',
      commentAction: 'ADDED',
      comment: { ...reply(10, jane, at('2026-10-01T08:00:00Z')), text: null, comments: undefined },
      commentAnchor: null,
    },
    { id: 0, createdDate: at('2026-10-01T07:00:00Z'), user: tom, action: 'RESCOPED', fromHash: 'abcde', added: { commits: [], total: 0 } },
  ])
  const writes = (user: { readonly name: string }, yes: ReadonlyArray<object>): Route => [
    'GET',
    `${DC}/users?filter=${user.name}&permission=REPO_WRITE&permission.projectKey=PRJ&permission.repositorySlug=my-repo&limit=100`,
    { json: page(yes) },
  ]

  it.effect('reads what was said since a cursor: each comment in its top-level comment’s thread, and the verdicts', () =>
    Effect.gen(function* () {
      const { host, sent } = center([
        ['GET', `${PULL}/activities?limit=100&start=0`, { json: activities }],
        writes(tom, [tom]),
        writes(bot, []),
        writes(jane, [{ ...jane, id: 999 }]),
      ])
      const said = yield* host.activity(prj, 101, '2026-10-01T10:00:00.000Z')
      assert.deepStrictEqual(
        said.comments.map((one) => [one.id, one.author.login, one.author.bot, one.member, one.threadId, one.path, one.line, one.at]),
        [
          ['12', 'tom', false, true, '11', 'path/to/file', 1, '2026-10-01T10:10:00.000Z'],
          ['13', 'bot-prj-1', true, false, '11', 'path/to/file', 1, '2026-10-01T10:15:00.000Z'],
        ],
      )
      assert.strictEqual(said.comments[0]?.url, `${prj.webUrl}/pull-requests/101/overview?commentId=12`)
      assert.deepStrictEqual(
        said.reviews.map((review) => [review.id, review.verdict, review.author.login, review.member, review.at]),
        [
          ['4', 'approved', 'tom', true, '2026-10-01T10:20:00.000Z'],
          ['5', 'changes_requested', 'jcitizen', false, '2026-10-01T10:30:00.000Z'],
        ],
      )
      assert.strictEqual(said.cursor, '2026-10-01T10:30:00.000Z')
      assert.lengthOf(
        sent.filter((request) => request.url.includes('permission=REPO_WRITE')),
        3,
      )
    }),
  )

  it.effect('hears a reply since the cursor in a thread begun before the activities read, by finding its top-level comment', () =>
    Effect.gen(function* () {
      const replied = (id: number, comment: number, when: string) => ({
        id,
        createdDate: at(when),
        user: tom,
        action: 'COMMENTED',
        commentAction: 'REPLIED',
        comment: reply(comment, tom, at(when)),
      })
      // The thread's own ADDED activity is past the thousand read: only the replies to it are among them.
      const recent = page([
        replied(42, 31, '2026-10-01T10:40:00Z'),
        replied(41, 33, '2026-10-01T10:35:00Z'),
        replied(40, 29, '2026-10-01T10:30:00Z'),
        replied(39, 25, '2026-10-01T09:00:00Z'),
      ])
      const top = {
        ...reply(30, jane, at('2026-09-01T09:00:00Z'), [
          reply(32, tom, at('2026-10-01T10:30:00Z'), [reply(31, tom, at('2026-10-01T10:40:00Z'))]),
          reply(33, bot, at('2026-10-01T10:35:00Z')),
        ]),
        // The reference describes a path in parts; an answer gives it as text.
        anchor: { line: 7, lineType: 'ADDED', fileType: 'TO', path: { components: ['src', 'limit.ts'], name: 'limit.ts' } },
      }
      const { host, sent } = center([
        ['GET', `${PULL}/activities?limit=100&start=0`, { json: recent }],
        ['GET', `${PULL}/comments/31`, { json: { ...reply(31, tom, at('2026-10-01T10:40:00Z')), parent: { id: 32 } } }],
        ['GET', `${PULL}/comments/32`, { json: { ...reply(32, tom, at('2026-10-01T10:30:00Z')), parent: { id: 30 } } }],
        ['GET', `${PULL}/comments/30`, { json: top }],
        // A reply deleted since is passed over.
        ['GET', `${PULL}/comments/29`, { status: 404, json: { errors: [{ message: 'Comment 29 does not exist.' }] } }],
        writes(tom, [tom]),
        writes(bot, []),
      ])
      const said = yield* host.activity(prj, 101, '2026-10-01T10:00:00.000Z')
      assert.deepStrictEqual(
        said.comments.map((one) => [one.id, one.author.login, one.threadId, one.path, one.line]),
        [
          ['32', 'tom', '30', 'src/limit.ts', 7],
          ['33', 'bot-prj-1', '30', 'src/limit.ts', 7],
          ['31', 'tom', '30', 'src/limit.ts', 7],
        ],
      )
      // The thread is read once for its two replies, and a reply before the cursor isn't looked for.
      assert.deepStrictEqual(
        sent.filter((request) => request.url.includes('/comments/')).map((request) => request.url.slice(PULL.length)),
        ['/comments/31', '/comments/32', '/comments/30', '/comments/29'],
      )
    }),
  )

  it.effect('reads every page of activity from the start without a cursor', () =>
    Effect.gen(function* () {
      const { host } = center([
        [
          'GET',
          `${PULL}/activities?limit=100&start=0`,
          { json: { ...activities, values: activities.values.slice(0, 3), isLastPage: false, nextPageStart: 3 } },
        ],
        ['GET', `${PULL}/activities?limit=100&start=3`, { json: { ...activities, values: activities.values.slice(3) } }],
        writes(jane, [jane]),
        writes(tom, []),
        writes(bot, []),
      ])
      const said = yield* host.activity(prj, 101, null)
      assert.deepStrictEqual(
        said.comments.map((one) => [one.id, one.threadId, one.member, one.body]),
        [
          ['10', '10', true, ''],
          ['11', '11', true, 'Comment 11'],
          ['12', '11', false, 'Comment 12'],
          ['13', '11', false, 'Comment 13'],
        ],
      )
      assert.isNull(said.comments[0]?.path)
      assert.strictEqual(said.reviews.length, 2)
      const quiet = center([['GET', `${PULL}/activities?limit=100&start=0`, { json: page([]) }]])
      assert.deepStrictEqual(yield* quiet.host.activity(prj, 101, '2026-10-01T10:00:00.000Z'), {
        comments: [],
        reviews: [],
        cursor: '2026-10-01T10:00:00.000Z',
      })
    }),
  )

  it.effect('replies in a thread, or in the conversation', () =>
    Effect.gen(function* () {
      const { host, sent } = center([['POST', `${PULL}/comments`, { status: 201, json: reply(20, jane, at('2026-10-01T11:00:00Z')) }]])
      assert.deepInclude(yield* host.reply(prj, 101, { body: 'Done', threadId: '11' }), {
        threadId: '11',
        member: true,
        body: 'Comment 20',
      })
      assert.deepStrictEqual(sent[0]?.body, { text: 'Done', parent: { id: 11 } })
      assert.strictEqual((yield* host.reply(prj, 101, { body: 'Done', threadId: null })).threadId, '20')
      assert.deepStrictEqual(sent[1]?.body, { text: 'Done' })
    }),
  )

  it.effect('pushes over HTTPS with the access token as a bearer header', () =>
    Effect.gen(function* () {
      const target = yield* center([]).host.pushTarget(prj)
      assert.deepStrictEqual(target, { url: `${SERVER}/scm/prj/my-repo.git`, header: 'Authorization: Bearer BBDC-t' })
    }),
  )
})
