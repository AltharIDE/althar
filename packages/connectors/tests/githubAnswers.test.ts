import { readFileSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'

import { makeGitHub, NO_QUEUE_KEPT_MS } from '../src/github'
import type { Check, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

/*
 * GitHub's answers that leave things out: a list's pull requests without
 * their size, a search hit whose fork or head is gone, a repository that
 * merges only some ways, and the checks GitHub can and can't run again.
 */

const API = 'https://api.github.com'
const REPO = `${API}/repos/meridian/api`
const repository: Repository = {
  id: '7',
  path: ['meridian', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://github.com/meridian/api',
  canPush: true,
  merges: ['squash'],
}

const github = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitHub({ fetch, apiUrl: API, webUrl: 'https://github.com', credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }) }),
    sent,
  }
}

const pull = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  node_id: 'PR_1',
  number: 12,
  title: 'Rate-limit refunds',
  body: null,
  html_url: 'https://github.com/meridian/api/pull/12',
  state: 'open',
  draft: false,
  merged_at: null,
  head: { ref: 'althar/mer-231', sha: 'abc' },
  base: { ref: 'main' },
  user: { id: 5, login: 'you', type: 'User' },
  updated_at: '2026-10-01T09:00:00Z',
  ...overrides,
})

const listed = (overrides: Record<string, unknown> = {}) => ({
  id: 'PR_kwDO12',
  number: 12,
  title: 'Rate-limit refunds',
  url: 'https://github.com/meridian/api/pull/12',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'althar/mer-231',
  baseRefName: 'main',
  headRefOid: 'abc',
  updatedAt: '2026-10-13T09:00:00Z',
  author: { __typename: 'User', login: 'you', databaseId: 5, name: 'You' },
  ...overrides,
})

const check = (id: string): Check => ({ id, name: 'test', state: 'failed', url: null, summary: null })

describe('GitHub answers that leave things out', () => {
  it.effect('says nothing of a pull request’s size where GitHub’s list leaves it out', () =>
    Effect.gen(function* () {
      const { host } = github([['GET', /\/pulls\?state=open&head=meridian%3Aalthar%2Fmer-231$/, { json: [pull()] }]])
      const found = yield* host.findChange(repository, 'althar/mer-231')
      assert.deepInclude(found, { number: 12, additions: null, deletions: null, changedFiles: null })
    }),
  )

  it.effect('lists a closed pull request, one whose fork or head is gone, and authors known only by their login', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'POST',
          `${API}/graphql`,
          {
            json: {
              data: {
                search: {
                  issueCount: 3,
                  nodes: [
                    listed({
                      state: 'CLOSED',
                      headRefOid: null,
                      author: { __typename: 'User', login: 'ninemate' },
                      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
                    }),
                    listed({
                      number: 13,
                      isCrossRepository: true,
                      headRepositoryOwner: null,
                      author: { __typename: 'Bot', login: 'renovate' },
                      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'EXPECTED' } } }] },
                    }),
                    listed({ number: 14, isCrossRepository: true, headRepositoryOwner: { login: 'dana' }, author: undefined }),
                  ],
                },
              },
            },
          },
        ],
      ])
      const list = yield* host.listChanges(repository, { state: 'all', limit: 3 })
      assert.isFalse(list.more)
      const [closed, fromBot, fromFork] = list.changes
      assert.deepInclude(closed, {
        state: 'closed',
        headSha: null,
        author: { id: 'ninemate', login: 'ninemate', name: null, bot: false },
        checks: 'passed',
        forkOwner: null,
      })
      // A fork GitHub no longer has: it is from a fork, but whose isn't said.
      assert.deepInclude(fromBot, {
        author: { id: 'renovate', login: 'renovate[bot]', name: null, bot: true },
        checks: 'running',
        forkOwner: null,
      })
      assert.deepInclude(fromFork, { author: null, forkOwner: 'dana', checks: null })
    }),
  )

  it.effect('merges a pull request seen without its head as it is now, without pinning a commit', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['POST', `${API}/graphql`, { json: { data: { search: { issueCount: 1, nodes: [listed({ headRefOid: null })] } } } }],
        ['PUT', `${REPO}/pulls/12/merge`, { json: { merged: true } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-13T10:00:00Z' }) }],
      ])
      const [seen] = (yield* host.listChanges(repository, { state: 'open', limit: 1 })).changes
      assert.isDefined(seen)
      if (seen === undefined) return
      const merged = yield* host.merge(repository, seen)
      assert.strictEqual(merged.state, 'merged')
      assert.deepStrictEqual(sent.find((request) => request.method === 'PUT')?.body, { merge_method: 'squash' })
    }),
  )

  it.effect('reads the ways a repository merges when it turns merge commits off and rebasing on', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          REPO,
          {
            json: {
              id: 7,
              full_name: 'meridian/api',
              default_branch: 'main',
              html_url: 'https://github.com/meridian/api',
              permissions: { push: true },
              allow_squash_merge: false,
              allow_merge_commit: false,
              allow_rebase_merge: true,
            },
          },
        ],
      ])
      assert.deepStrictEqual((yield* host.repository(['meridian', 'api'])).merges, ['rebase'])
    }),
  )

  it.effect('deletes nothing for a closed pull request whose fork is gone, since the branch went with it', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head: { ref: 'althar/mer-231', sha: 'abc', repo: null } }) }],
      ])
      yield* host.deleteBranch(repository, yield* host.change(repository, 12))
      assert.isFalse(sent.some((request) => request.method === 'DELETE'))
    }),
  )

  it.effect('has no address for a check run that gives none', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          { json: { check_runs: [{ id: 1, name: 'test', status: 'queued', app: { slug: 'github-actions' } }] } },
        ],
        ['GET', `${REPO}/commits/abc/status`, { json: { statuses: [] } }],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'run:1:github-actions', name: 'test', state: 'queued', url: null, summary: null },
      ])
    }),
  )

  it.effect('runs a GitHub Actions job again, and nothing else', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${REPO}/actions/jobs/31/rerun`, { status: 201, json: {} }]])
      assert.isTrue(yield* host.rerun(repository, check('run:31:github-actions')))
      assert.isFalse(yield* host.rerun(repository, check('run:32:codeql')))
      assert.isFalse(yield* host.rerun(repository, check('status:3')))
      assert.deepStrictEqual(
        sent.map((request) => `${request.method} ${request.url}`),
        [`POST ${REPO}/actions/jobs/31/rerun`],
      )
      // Refused, it says so in GitHub's words.
      const refusing = github([['POST', `${REPO}/actions/jobs/31/rerun`, { status: 403, json: { message: 'Must have admin rights' } }]])
      assert.deepInclude(yield* Effect.flip(refusing.host.rerun(repository, check('run:31:github-actions'))), {
        reason: 'forbidden',
        message: 'Must have admin rights',
      })
    }),
  )

  it.effect('leaves out a review that only commented on lines and said nothing itself', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', /\/issues\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/comments/, { json: [] }],
        [
          'GET',
          /\/pulls\/12\/reviews/,
          {
            json: [
              { id: 1, user: null, state: 'COMMENTED', submitted_at: '2026-10-01T09:00:00Z' },
              { id: 2, user: null, body: null, state: 'COMMENTED', submitted_at: '2026-10-01T09:01:00Z' },
              { id: 3, user: null, state: 'APPROVED', submitted_at: '2026-10-01T09:02:00Z' },
            ],
          },
        ],
      ])
      const activity = yield* host.activity(repository, 12, null)
      assert.deepStrictEqual(
        activity.reviews.map((review) => [review.id, review.verdict, review.body]),
        [['3', 'approved', '']],
      )
    }),
  )

  it.effect('reads a pull request put in its merge queue on GitHub’s site as queued, as althar#444 was', () =>
    Effect.gen(function* () {
      // GitHub's REST answer for althar#444 as it sat in main's merge queue, recorded 2026-10-31: nothing in it says so.
      const recorded = JSON.parse(readFileSync(new URL('fixtures/pull-444-queued.json', import.meta.url), 'utf8')) as Record<
        string,
        unknown
      >
      const althar: Repository = { ...repository, path: ['AltharIDE', 'althar'] }
      const { host, sent } = github([
        ['GET', `${API}/repos/AltharIDE/althar/pulls/444`, { json: recorded }],
        // GraphQL's, in GitHub's schema: its branch has a queue, and it is in it.
        [
          'POST',
          `${API}/graphql`,
          {
            json: {
              data: { repository: { pullRequest: { isMergeQueueEnabled: true, isInMergeQueue: true, timelineItems: { nodes: [] } } } },
            },
          },
        ],
      ])
      assert.deepInclude(yield* host.change(althar, 444, { queue: true }), { state: 'open', target: 'main', queued: true, leftQueue: null })
      assert.lengthOf(
        sent.filter((request) => request.method === 'POST'),
        1,
      )
      // A branch with a queue is asked each time.
      yield* host.change(althar, 444, { queue: true })
      assert.lengthOf(
        sent.filter((request) => request.method === 'POST'),
        2,
      )
    }),
  )

  it.effect('asks about a merge queue once a while per branch where there is none, and not at all while it knows so', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', /\/pulls\/1[23]$/, { json: pull() }],
        [
          'POST',
          `${API}/graphql`,
          {
            json: {
              data: { repository: { pullRequest: { isMergeQueueEnabled: false, isInMergeQueue: false, timelineItems: { nodes: [] } } } },
            },
          },
        ],
      ])
      const asked = () => sent.filter((request) => request.method === 'POST').length
      // Learned once, for main: no queue, so the read says nothing of one.
      assert.notProperty(yield* host.change(repository, 12, { queue: true }), 'queued')
      assert.strictEqual(asked(), 1)
      // Every pull request to main after, for the while it's kept, costs nothing more.
      yield* host.change(repository, 12, { queue: true })
      yield* host.change(repository, 13, { queue: true })
      yield* TestClock.adjust(Duration.millis(NO_QUEUE_KEPT_MS - 1))
      yield* host.change(repository, 12, { queue: true })
      assert.strictEqual(asked(), 1)
      // Past it, it is asked again, in case the queue was turned on since.
      yield* TestClock.adjust(Duration.millis(1))
      yield* host.change(repository, 12, { queue: true })
      assert.strictEqual(asked(), 2)
    }),
  )
})
