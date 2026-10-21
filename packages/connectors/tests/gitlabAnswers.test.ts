import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeGitLab } from '../src/gitlab'
import type { ChangeRequest, Check, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

/*
 * GitLab's answers that leave things out: a person without a name, a merge
 * request without a head or a draft flag, a project GitLab can't size, a
 * trigger job with no address; and the jobs it runs again.
 */

const API = 'https://gitlab.com/api/v4'
const PROJECT = `${API}/projects/34675721`
const GRAPHQL = 'https://gitlab.com/api/graphql'
const repository: Repository = {
  id: '34675721',
  path: ['meridian', 'payments', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://gitlab.com/meridian/payments/api',
  canPush: true,
  merges: ['merge'],
}

const gitlab = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitLab({
      fetch,
      apiUrl: `${API}/`,
      webUrl: 'https://gitlab.com/',
      credential: Effect.succeed({ kind: 'bearer', token: 'glpat-t' }),
    }),
    sent,
  }
}

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 544266512,
  iid: 12,
  title: 'Rate-limit refunds',
  description: 'Refunds skip the limiter.',
  state: 'opened',
  updated_at: '2026-10-07T16:41:00.548Z',
  target_branch: 'main',
  source_branch: 'althar/mer-231',
  author: { id: 5, username: 'you' },
  sha: 'a4f0330b',
  web_url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12',
  ...overrides,
})

const change: ChangeRequest = {
  id: '544266512',
  number: 12,
  title: 'Rate-limit refunds',
  body: '',
  url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12',
  state: 'open',
  draft: true,
  source: 'althar/mer-231',
  target: 'main',
  headSha: 'a4f0330b',
  author: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  updatedAt: '',
}

const job = (id: string): Check => ({ id, name: 'unit', state: 'failed', url: null, summary: null })

describe('GitLab answers that leave things out', () => {
  it.effect('says who it is signed in as when the account has no name', () =>
    Effect.gen(function* () {
      const { host } = gitlab([['GET', `${API}/user`, { json: { id: 5, username: 'you' } }]])
      assert.deepStrictEqual(yield* host.account, { id: '5', login: 'you', name: null })
    }),
  )

  it.effect('lists ready merge requests, a pipeline still running and one that holds nothing up', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        [
          'GET',
          /\/merge_requests\?/,
          {
            json: [
              request({ detailed_merge_status: 'ci_still_running' }),
              request({ iid: 13, detailed_merge_status: 'mergeable', author: { id: 6, username: 'renovate', bot: true } }),
            ],
          },
        ],
      ])
      const list = yield* host.listChanges(repository, { state: 'open', draft: false, limit: 5 })
      assert.strictEqual(new URL(sent[0]?.url ?? '').searchParams.get('wip'), 'no')
      assert.isFalse(list.more)
      assert.deepStrictEqual(
        list.changes.map((listed) => [listed.number, listed.draft, listed.reviewDecision, listed.checks, listed.author]),
        [
          [12, false, null, 'running', { id: '5', login: 'you', name: null, bot: false }],
          [13, false, null, null, { id: '6', login: 'renovate', name: null, bot: true }],
        ],
      )
    }),
  )

  it.effect('reads a merge request with no head yet, and leaves its size unknown where GitLab can’t find it', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        ['GET', `${PROJECT}/merge_requests/12`, { json: request({ sha: null, changes_count: '3' }) }],
        ['POST', GRAPHQL, { json: { data: { project: { mergeRequest: null } } } }],
      ])
      const read = yield* host.change(repository, 12)
      assert.deepInclude(read, { headSha: null, additions: null, deletions: null, changedFiles: 3 })
      assert.isTrue(sent.some((one) => one.method === 'POST'))
    }),
  )

  it.effect('counts a merge request with no head once, and reuses the count while it still has none', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        ['GET', `${PROJECT}/merge_requests/12`, { json: request({ sha: undefined }) }],
        [
          'POST',
          GRAPHQL,
          { json: { data: { project: { mergeRequest: { diffStatsSummary: { additions: 12, deletions: 4, fileCount: 2 } } } } } },
        ],
      ])
      const first = yield* host.change(repository, 12)
      const again = yield* host.change(repository, 12)
      assert.deepStrictEqual([first.additions, first.deletions, first.changedFiles], [12, 4, 2])
      assert.deepStrictEqual([again.additions, again.deletions, again.changedFiles], [12, 4, 2])
      assert.lengthOf(
        sent.filter((one) => one.method === 'POST'),
        1,
      )
    }),
  )

  it.effect('marks ready by its older work-in-progress flag, and takes one that says neither as ready', () =>
    Effect.gen(function* () {
      const old = gitlab([
        ['GET', `${PROJECT}/merge_requests/12`, { json: request({ title: 'Draft: Rate-limit refunds', work_in_progress: true }) }],
        ['PUT', `${PROJECT}/merge_requests/12`, { json: request({ work_in_progress: false }) }],
      ])
      assert.isFalse((yield* old.host.markReady(repository, change)).draft)
      assert.deepStrictEqual(old.sent.find((one) => one.method === 'PUT')?.body, { title: 'Rate-limit refunds' })
      const unsaid = gitlab([['GET', `${PROJECT}/merge_requests/12`, { json: request() }]])
      assert.isFalse((yield* unsaid.host.markReady(repository, change)).draft)
      assert.deepStrictEqual(
        unsaid.sent.map((one) => one.method),
        ['GET'],
      )
    }),
  )

  it.effect('says GitLab’s own words when it can’t merge and the merge request says nothing of why', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12/merge`, { status: 405, json: { message: '405 Method Not Allowed' } }],
        ['GET', `${PROJECT}/merge_requests/12`, { json: request() }],
      ])
      assert.deepInclude(yield* Effect.flip(host.merge(repository, change)), {
        reason: 'rejected',
        status: 405,
        message: '405 Method Not Allowed',
      })
    }),
  )

  it.effect('has no address for a trigger job that gives none, and reads its child pipeline’s state', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        ['GET', `${PROJECT}/pipelines?sha=abc&per_page=20`, { json: [{ id: 2, sha: 'abc', source: 'push' }] }],
        ['GET', `${PROJECT}/pipelines/2/jobs?per_page=100`, { json: [] }],
        [
          'GET',
          `${PROJECT}/pipelines/2/bridges?per_page=100`,
          { json: [{ id: 9, name: 'docs:trigger', status: 'running', downstream_pipeline: { status: 'pending' } }] },
        ],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'bridge:34675721:9', name: 'docs:trigger', state: 'queued', url: null, summary: null },
      ])
    }),
  )

  it.effect('reads a job’s whole log when asked for all of it', () =>
    Effect.gen(function* () {
      const log = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n')
      const { host } = gitlab([['GET', `${PROJECT}/jobs/1/trace`, { text: log }]])
      assert.strictEqual(yield* host.checkLog(repository, job('job:34675721:1'), true), log)
    }),
  )

  it.effect('runs a pipeline’s job again in the project it ran in, and nothing that isn’t a job', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([['POST', `${API}/projects/45049979/jobs/17/retry`, { status: 201, json: { id: 18 } }]])
      assert.isTrue(yield* host.rerun(repository, job('job:45049979:17')))
      assert.isFalse(yield* host.rerun(repository, job('bridge:34675721:9')))
      assert.deepStrictEqual(
        sent.map((one) => `${one.method} ${one.url}`),
        [`POST ${API}/projects/45049979/jobs/17/retry`],
      )
      const refusing = gitlab([['POST', `${API}/projects/45049979/jobs/17/retry`, { status: 403, json: { message: '403 Forbidden' } }]])
      assert.strictEqual((yield* Effect.flip(refusing.host.rerun(repository, job('job:45049979:17')))).reason, 'forbidden')
    }),
  )
})
