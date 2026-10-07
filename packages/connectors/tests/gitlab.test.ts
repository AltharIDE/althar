import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { jobState, makeGitLab, mergesOf, readyTitle } from '../src/gitlab'
import type { ChangeRequest, Issue, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

const API = 'https://gitlab.com/api/v4'
const PROJECT = `${API}/projects/34675721`
const repository: Repository = {
  id: '34675721',
  path: ['meridian', 'payments', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://gitlab.com/meridian/payments/api',
  canPush: true,
  merges: ['squash', 'merge'],
}

const gitlab = (routes: ReadonlyArray<Route>, token = 'glpat-t') => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitLab({ fetch, apiUrl: `${API}/`, webUrl: 'https://gitlab.com/', credential: Effect.succeed({ kind: 'bearer', token }) }),
    sent,
  }
}

const user = (id: number, username: string, overrides: Record<string, unknown> = {}) => ({
  id,
  username,
  public_email: '',
  name: username === 'you' ? 'You Person' : username,
  state: 'active',
  locked: false,
  avatar_url: `https://gitlab.com/uploads/-/system/user/avatar/${id}/avatar.png`,
  web_url: `https://gitlab.com/${username}`,
  ...overrides,
})

// Trimmed from gitlab.com's answer for gitlab-org/cli!4015, renamed.
const request = (overrides: Record<string, unknown> = {}) => ({
  id: 544266512,
  iid: 12,
  project_id: 34675721,
  title: 'Draft: Rate-limit refunds',
  description: 'Refunds skip the limiter.',
  state: 'opened',
  created_at: '2026-10-07T06:22:22.583Z',
  updated_at: '2026-10-07T16:41:00.548Z',
  target_branch: 'main',
  source_branch: 'althar/mer-231',
  user_notes_count: 0,
  author: user(5, 'you', { bot: false }),
  draft: true,
  work_in_progress: true,
  sha: 'a4f0330b1b8cfb0a3392696524005025d3342099',
  web_url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12',
  references: { short: '!12', relative: '!12', full: 'meridian/payments/api!12' },
  detailed_merge_status: 'mergeable',
  has_conflicts: false,
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

// Trimmed from gitlab.com's jobs for a gitlab-org/cli pipeline.
const job = (id: number, name: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  stage: 'test',
  status,
  allow_failure: false,
  web_url: `https://gitlab.com/meridian/payments/api/-/jobs/${id}`,
  failure_reason: null,
  ...overrides,
})

const note = (id: number, author: ReturnType<typeof user>, body: string, at: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: null,
  body,
  attachment: null,
  author,
  created_at: at,
  updated_at: at,
  system: false,
  noteable_id: 544266512,
  noteable_type: 'MergeRequest',
  project_id: 34675721,
  resolvable: false,
  ...overrides,
})

describe('GitLab as a code host', () => {
  it.effect('says who it is signed in as, with a bearer token', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([['GET', `${API}/user`, { json: user(5, 'you') }]])
      assert.deepStrictEqual(yield* host.account, { id: '5', login: 'you', name: 'You Person' })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer glpat-t')
      assert.deepStrictEqual(host.words, { noun: 'merge request', short: 'MR', prefix: '!' })
    }),
  )

  it.effect('reads a project in nested groups, whether the account may push, and how it merges', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        [
          'GET',
          `${API}/projects/meridian%2Fpayments%2Fapi`,
          {
            json: {
              id: 34675721,
              path_with_namespace: 'meridian/payments/api',
              default_branch: 'trunk',
              web_url: 'https://gitlab.com/meridian/payments/api',
              visibility: 'private',
              merge_method: 'merge',
              squash_option: 'default_off',
              permissions: { project_access: null, group_access: { access_level: 30, notification_level: 3 } },
            },
          },
        ],
        // Trimmed from gitlab.com's answer for gitlab-org/cli, read without signing in: no settings, no permissions.
        [
          'GET',
          `${API}/projects/gitlab-org%2Fcli`,
          {
            json: {
              id: 34675721,
              path_with_namespace: 'gitlab-org/cli',
              default_branch: 'main',
              web_url: 'https://gitlab.com/gitlab-org/cli',
              merge_method: null,
              squash_option: null,
              permissions: null,
              visibility: 'public',
            },
          },
        ],
        [
          'GET',
          `${API}/projects/meridian%2Fempty`,
          {
            json: {
              id: 9,
              path_with_namespace: 'meridian/empty',
              default_branch: null,
              web_url: 'https://gitlab.com/meridian/empty',
              permissions: { project_access: { access_level: 20 } },
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.repository(['meridian', 'payments', 'api']), {
        id: '34675721',
        path: ['meridian', 'payments', 'api'],
        defaultBranch: 'trunk',
        webUrl: 'https://gitlab.com/meridian/payments/api',
        canPush: true,
        merges: ['squash', 'merge'],
      })
      const outside = yield* host.repository(['gitlab-org', 'cli'])
      assert.deepStrictEqual([outside.canPush, outside.merges], [false, ['merge']])
      const empty = yield* host.repository(['meridian', 'empty'])
      assert.deepStrictEqual([empty.defaultBranch, empty.canPush], ['main', false])
      assert.strictEqual(sent[0]?.url, `${API}/projects/meridian%2Fpayments%2Fapi`)
    }),
  )

  it('merges in the order Althar prefers, as the project allows', () => {
    assert.deepStrictEqual(mergesOf('merge', 'default_on'), ['squash', 'merge'])
    assert.deepStrictEqual(mergesOf('rebase_merge', 'default_off'), ['squash', 'merge'])
    assert.deepStrictEqual(mergesOf('ff', 'never'), ['rebase'])
    assert.deepStrictEqual(mergesOf('merge', 'always'), ['squash'])
    assert.deepStrictEqual(mergesOf(null, null), ['merge'])
  })

  it('takes every draft prefix GitLab knows off a title', () => {
    assert.strictEqual(readyTitle('Draft: Rate-limit refunds'), 'Rate-limit refunds')
    assert.strictEqual(readyTitle('[Draft] (draft) draft - Rate-limit refunds'), 'Rate-limit refunds')
    assert.strictEqual(readyTitle('Drafting the refunds'), 'Drafting the refunds')
  })

  it.effect('opens a draft merge request once, adopting one already open from the branch', () =>
    Effect.gen(function* () {
      let opened = false
      const { host, sent } = gitlab([
        [
          'POST',
          `${PROJECT}/merge_requests`,
          () => {
            if (!opened) {
              opened = true
              return { status: 201, json: request() }
            }
            return { status: 409, json: { message: ['Another open merge request already exists for this source branch: !12'] } }
          },
        ],
        ['GET', `${PROJECT}/merge_requests?state=opened&source_branch=althar%2Fmer-231`, { json: [request()] }],
      ])
      const asked = {
        title: 'Rate-limit refunds',
        body: 'Refunds skip the limiter.',
        source: 'althar/mer-231',
        target: 'main',
        draft: true,
      }
      const first = yield* host.openChange(repository, asked)
      assert.deepStrictEqual(first, {
        id: '544266512',
        number: 12,
        title: 'Rate-limit refunds',
        body: 'Refunds skip the limiter.',
        url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12',
        state: 'open',
        draft: true,
        source: 'althar/mer-231',
        target: 'main',
        headSha: 'a4f0330b1b8cfb0a3392696524005025d3342099',
        author: { id: '5', login: 'you', name: 'You Person', bot: false },
        additions: null,
        deletions: null,
        changedFiles: null,
        updatedAt: '2026-10-07T16:41:00.548Z',
      })
      assert.deepStrictEqual(sent[0]?.body, {
        source_branch: 'althar/mer-231',
        target_branch: 'main',
        title: 'Draft: Rate-limit refunds',
        description: 'Refunds skip the limiter.',
      })
      assert.strictEqual((yield* host.openChange(repository, asked)).number, 12)
      yield* host.openChange(repository, { ...asked, title: 'Ready now', draft: false })
      assert.deepInclude(sent.at(-2)?.body, { title: 'Ready now' })
    }),
  )

  it.effect('passes on a refusal it can’t adopt', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        ['POST', `${PROJECT}/merge_requests`, { status: 409, json: { message: ['Another open merge request already exists'] } }],
        ['GET', `${PROJECT}/merge_requests?state=opened&source_branch=x`, { json: [] }],
      ])
      const error = yield* Effect.flip(host.openChange(repository, { title: 't', body: '', source: 'x', target: 'main', draft: false }))
      assert.deepStrictEqual([error.reason, error.status], ['rejected', 409])
      assert.isNull(yield* host.findChange(repository, 'x'))
    }),
  )

  it.effect('reads a merge request, however GitLab says where it stands', () =>
    Effect.gen(function* () {
      const answers = [
        request({ state: 'merged', draft: false, work_in_progress: false, changes_count: '1000+' }),
        request({ state: 'closed', draft: undefined, work_in_progress: false, changes_count: '3' }),
        request({ state: 'locked', draft: undefined, work_in_progress: undefined, sha: null, author: null, description: null }),
      ]
      const { host } = gitlab([['GET', `${PROJECT}/merge_requests/12`, () => ({ json: answers.shift() })]])
      const merged = yield* host.change(repository, 12)
      assert.deepStrictEqual([merged.state, merged.draft, merged.changedFiles], ['merged', false, 1000])
      const closed = yield* host.change(repository, 12)
      assert.deepStrictEqual([closed.state, closed.changedFiles], ['closed', 3])
      const locked = yield* host.change(repository, 12)
      assert.deepStrictEqual([locked.state, locked.draft, locked.headSha, locked.author, locked.body], ['open', false, null, null, ''])
    }),
  )

  it.effect('marks a draft ready by taking the prefix off its title', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12`, { json: request({ title: 'Rate-limit refunds', draft: false, work_in_progress: false }) }],
      ])
      const ready = yield* host.markReady(repository, change)
      assert.isFalse(ready.draft)
      assert.deepStrictEqual(sent[0]?.body, { title: 'Rate-limit refunds' })
    }),
  )

  it.effect('merges only the head it saw, squashed where the project prefers it', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([['PUT', `${PROJECT}/merge_requests/12/merge`, { json: request({ state: 'merged', draft: false }) }]])
      assert.strictEqual((yield* host.merge(repository, change)).state, 'merged')
      assert.deepStrictEqual(sent[0]?.body, { squash: true, sha: 'a4f0330b' })
      yield* host.merge({ ...repository, merges: ['merge'] }, { ...change, headSha: null })
      assert.deepStrictEqual(sent[1]?.body, { squash: false })
    }),
  )

  it.effect('says why it can’t merge, in GitLab’s words', () =>
    Effect.gen(function* () {
      const statuses = ['ci_must_pass', 'something_new']
      const { host } = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12/merge`, { status: 405, json: { message: '405 Method Not Allowed' } }],
        ['GET', `${PROJECT}/merge_requests/12`, () => ({ json: request({ detailed_merge_status: statuses.shift() }) })],
      ])
      const pipeline = yield* Effect.flip(host.merge(repository, change))
      assert.deepStrictEqual([pipeline.reason, pipeline.message], ['rejected', 'A CI/CD pipeline must succeed before merge.'])
      assert.strictEqual((yield* Effect.flip(host.merge(repository, change))).message, '405 Method Not Allowed')
    }),
  )

  it.effect('tells a head that moved, and an account that may not merge, from a token that stopped working', () =>
    Effect.gen(function* () {
      const moved = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12/merge`, { status: 409, json: { message: 'SHA does not match HEAD of source branch' } }],
      ])
      assert.strictEqual((yield* Effect.flip(moved.host.merge(repository, change))).status, 409)
      const refused = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12/merge`, { status: 401, json: { message: '401 Unauthorized' } }],
        ['GET', `${API}/user`, { json: user(5, 'you') }],
      ])
      assert.strictEqual((yield* Effect.flip(refused.host.merge(repository, change))).reason, 'forbidden')
      const revoked = gitlab([
        ['PUT', `${PROJECT}/merge_requests/12/merge`, { status: 401, json: { message: '401 Unauthorized' } }],
        ['GET', `${API}/user`, { status: 401, json: { message: '401 Unauthorized' } }],
      ])
      assert.strictEqual((yield* Effect.flip(revoked.host.merge(repository, change))).reason, 'unauthorized')
    }),
  )

  it('reads a job’s state', () => {
    assert.deepStrictEqual(
      ['success', 'running', 'canceled', 'canceling', 'skipped', 'manual', 'pending', 'created', 'scheduled'].map((status) =>
        jobState(status, false),
      ),
      ['passed', 'running', 'cancelled', 'cancelled', 'skipped', 'skipped', 'queued', 'queued', 'queued'],
    )
    assert.strictEqual(jobState('failed', false), 'failed')
    assert.strictEqual(jobState('failed', true), 'neutral')
  })

  it.effect('reads the checks on a head from its newest pipeline’s jobs', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        [
          'GET',
          `${PROJECT}/pipelines?sha=abc&per_page=20`,
          {
            json: [
              { id: 3, sha: 'abc', ref: 'main', status: 'success', source: 'external' },
              { id: 2, sha: 'abc', ref: 'althar/mer-231', status: 'failed', source: 'push' },
            ],
          },
        ],
        [
          'GET',
          `${PROJECT}/pipelines/2/jobs?per_page=100`,
          {
            json: [
              job(17007488983, 'unit', 'failed', { failure_reason: 'script_failure' }),
              job(17007488982, 'lint', 'failed', { allow_failure: true }),
              job(17007488981, 'deploy', 'manual', { web_url: null }),
            ],
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        {
          id: 'job:34675721:17007488983',
          name: 'unit',
          state: 'failed',
          url: 'https://gitlab.com/meridian/payments/api/-/jobs/17007488983',
          summary: 'script_failure',
        },
        {
          id: 'job:34675721:17007488982',
          name: 'lint',
          state: 'neutral',
          url: 'https://gitlab.com/meridian/payments/api/-/jobs/17007488982',
          summary: null,
        },
        { id: 'job:34675721:17007488981', name: 'deploy', state: 'skipped', url: null, summary: null },
      ])
    }),
  )

  it.effect('finds a merged results pipeline through the head’s merge request', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        ['GET', /\/pipelines\?sha=/, { json: [] }],
        [
          'GET',
          `${PROJECT}/repository/commits/abc/merge_requests`,
          { json: [request({ iid: 11, state: 'merged', sha: 'abc' }), request({ sha: 'abc' })] },
        ],
        [
          'GET',
          `${PROJECT}/merge_requests/12`,
          { json: request({ sha: 'abc', head_pipeline: { id: 7, project_id: 45049979, sha: 'merge-commit' } }) },
        ],
        ['GET', `${API}/projects/45049979/pipelines/7/jobs?per_page=100`, { json: [job(1, 'unit', 'running')] }],
        ['GET', `${PROJECT}/repository/commits/def/merge_requests`, { json: [request({ sha: 'other' })] }],
      ])
      assert.deepStrictEqual(
        (yield* host.checks(repository, 'abc')).map((check) => [check.id, check.state]),
        [['job:45049979:1', 'running']],
      )
      assert.deepStrictEqual(yield* host.checks(repository, 'def'), [])
    }),
  )

  it.effect('reads the end of a failed job’s log, and nothing for a log it can’t read', () =>
    Effect.gen(function* () {
      const log = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n')
      const { host } = gitlab([
        ['GET', `${PROJECT}/jobs/1/trace`, { text: log }],
        ['GET', `${PROJECT}/jobs/2/trace`, { status: 403, json: { message: '403 Forbidden' } }],
      ])
      const check = { id: 'job:34675721:1', name: 'unit', state: 'failed' as const, url: null, summary: null }
      const read = yield* host.checkLog(repository, check)
      assert.isTrue(read?.endsWith('line 399'))
      assert.strictEqual(read?.split('\n').length, 150)
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'job:34675721:2' }))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'status:3' }))
    }),
  )

  it.effect('hears what was said since a cursor: comments, threads on lines, and verdicts', () =>
    Effect.gen(function* () {
      const you = user(5, 'you')
      const reviewer = user(6, 'reviewer')
      const stranger = user(7, 'stranger')
      const duo = user(8, 'duo', { bot: true })
      const discussions = [
        {
          id: 'd-old',
          individual_note: true,
          notes: [note(100, stranger, 'Old news', '2026-10-01T08:00:00.000Z')],
        },
        {
          id: 'd-said',
          individual_note: true,
          notes: [note(101, stranger, 'Why not a token bucket?', '2026-10-01T09:00:00.000Z')],
        },
        {
          id: '6a9c1750b37d513a43987b574953fceb50b03ce7',
          individual_note: false,
          notes: [
            note(102, reviewer, 'This skips the limiter', '2026-10-01T09:05:00.000Z', {
              type: 'DiffNote',
              resolvable: true,
              resolved: false,
              position: {
                base_sha: 'b',
                head_sha: 'h',
                old_path: 'src/refunds.ts',
                new_path: 'src/refunds.ts',
                old_line: null,
                new_line: 27,
              },
            }),
            note(103, you, 'Fixed', '2026-10-01T09:06:00.000Z', {
              type: 'DiffNote',
              position: { old_path: 'gone.ts', new_path: null, old_line: 4 },
            }),
          ],
        },
        {
          id: 'd-approved',
          individual_note: true,
          notes: [note(104, reviewer, 'approved this merge request', '2026-10-01T09:10:00.000Z', { system: true })],
        },
        {
          id: 'd-changes',
          individual_note: true,
          notes: [note(105, stranger, 'requested changes', '2026-10-01T09:11:00.000Z', { system: true })],
        },
        {
          id: 'd-pushed',
          individual_note: true,
          notes: [note(106, you, 'added 1 commit', '2026-10-01T09:12:00.000Z', { system: true })],
        },
        { id: 'd-bot', individual_note: true, notes: [note(107, duo, 'A summary', '2026-10-01T09:13:00.000Z')] },
      ]
      const { host, sent } = gitlab([
        ['GET', `${PROJECT}/merge_requests/12/discussions?per_page=100&page=1`, { json: discussions }],
        ['GET', `${PROJECT}/members/all/6`, { json: { id: 6, username: 'reviewer', access_level: 40 } }],
        ['GET', `${PROJECT}/members/all/5`, { json: { id: 5, username: 'you', access_level: 30 } }],
        ['GET', `${PROJECT}/members/all/8`, { json: { id: 8, username: 'duo', access_level: 10 } }],
      ])
      const activity = yield* host.activity(repository, 12, '2026-10-01T09:00:00.000Z')
      assert.deepStrictEqual(
        activity.comments.map((comment) => [
          comment.id,
          comment.author.login,
          comment.member,
          comment.threadId,
          comment.path,
          comment.line,
        ]),
        [
          ['101', 'stranger', false, null, null, null],
          ['102', 'reviewer', true, '6a9c1750b37d513a43987b574953fceb50b03ce7', 'src/refunds.ts', 27],
          ['103', 'you', true, '6a9c1750b37d513a43987b574953fceb50b03ce7', 'gone.ts', 4],
          ['107', 'duo', false, null, null, null],
        ],
      )
      assert.isTrue(activity.comments[3]?.author.bot)
      assert.strictEqual(activity.comments[0]?.url, 'https://gitlab.com/meridian/payments/api/-/merge_requests/12#note_101')
      assert.deepStrictEqual(
        activity.reviews.map((review) => [review.id, review.author.login, review.member, review.verdict, review.at]),
        [
          ['104', 'reviewer', true, 'approved', '2026-10-01T09:10:00.000Z'],
          ['105', 'stranger', false, 'changes_requested', '2026-10-01T09:11:00.000Z'],
        ],
      )
      assert.strictEqual(activity.cursor, '2026-10-01T09:13:00.000Z')
      // Each author asked about once, and a stranger is no one GitLab knows of.
      assert.strictEqual(sent.filter((request) => request.url.includes('/members/all/')).length, 4)
      const quiet = yield* host.activity(repository, 12, '2026-10-02T00:00:00.000Z')
      assert.deepStrictEqual([quiet.comments, quiet.reviews, quiet.cursor], [[], [], '2026-10-02T00:00:00.000Z'])
    }),
  )

  it.effect('reads every page of a busy merge request’s threads', () =>
    Effect.gen(function* () {
      const said = (id: number) => ({
        id: `d${id}`,
        individual_note: true,
        notes: [note(id, user(5, 'you'), `Comment ${id}`, `2026-10-01T09:${String(id % 60).padStart(2, '0')}:00.000Z`)],
      })
      const { host } = gitlab([
        ['GET', /discussions\?per_page=100&page=1$/, { json: Array.from({ length: 100 }, (_, index) => said(index)) }],
        ['GET', /discussions\?per_page=100&page=2$/, { json: [said(100)] }],
        ['GET', `${PROJECT}/members/all/5`, { json: { access_level: 50 } }],
      ])
      const activity = yield* host.activity(repository, 12, null)
      assert.strictEqual(activity.comments.length, 101)
      assert.isTrue(activity.comments.some((comment) => comment.body === 'Comment 100'))
    }),
  )

  it.effect('replies in a thread, or in the conversation', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        [
          'POST',
          `${PROJECT}/merge_requests/12/notes`,
          { status: 201, json: note(201, user(5, 'you'), 'Done', '2026-10-01T10:00:00.000Z') },
        ],
        [
          'POST',
          `${PROJECT}/merge_requests/12/discussions/6a9c/notes`,
          { status: 201, json: note(202, user(5, 'you'), 'Fixed in abc', '2026-10-01T10:01:00.000Z', { type: 'DiffNote' }) },
        ],
      ])
      const conversation = yield* host.reply(repository, 12, { body: 'Done', threadId: null })
      assert.deepStrictEqual([conversation.id, conversation.threadId, conversation.body], ['201', null, 'Done'])
      const thread = yield* host.reply(repository, 12, { body: 'Fixed in abc', threadId: '6a9c' })
      assert.deepStrictEqual([thread.id, thread.threadId], ['202', '6a9c'])
      assert.deepStrictEqual(sent[1]?.body, { body: 'Fixed in abc' })
    }),
  )

  it.effect('pushes as oauth2, with the token as its password', () =>
    Effect.gen(function* () {
      const { host } = gitlab([])
      assert.deepStrictEqual(yield* host.pushTarget(repository), {
        url: 'https://gitlab.com/meridian/payments/api.git',
        header: `Authorization: Basic ${Buffer.from('oauth2:glpat-t').toString('base64')}`,
      })
    }),
  )
})

// Trimmed from gitlab.com's answer for gitlab-org/cli#8592, renamed.
const issue = (overrides: Record<string, unknown> = {}) => ({
  id: 205729782,
  iid: 231,
  project_id: 34675721,
  title: 'Rate-limit refunds like charges',
  description: 'Refunds skip the limiter.',
  state: 'opened',
  labels: ['payments', 'type::bug'],
  assignees: [user(5, 'you')],
  updated_at: '2026-10-07T16:25:33.584Z',
  web_url: 'https://gitlab.com/meridian/payments/api/-/work_items/231',
  references: { short: '#231', relative: '#231', full: 'meridian/payments/api#231' },
  issue_type: 'issue',
  type: 'ISSUE',
  severity: 'UNKNOWN',
  status: null,
  ...overrides,
})

describe('GitLab as a tracker', () => {
  it.effect('reads an issue by its project and number', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        ['GET', `${API}/projects/meridian%2Fpayments%2Fapi/issues/231`, { json: issue() }],
        [
          'GET',
          `${API}/projects/meridian%2Fpayments%2Fapi/issues/232`,
          { json: issue({ iid: 232, state: 'closed', description: null, assignees: null, labels: undefined }) },
        ],
      ])
      assert.deepStrictEqual(yield* host.issue('meridian/payments/api#231'), {
        id: '205729782',
        ref: 'meridian/payments/api#231',
        key: '#231',
        title: 'Rate-limit refunds like charges',
        body: 'Refunds skip the limiter.',
        url: 'https://gitlab.com/meridian/payments/api/-/work_items/231',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [{ id: '5', login: 'you', name: 'You Person', bot: false }],
        labels: ['payments', 'type::bug'],
        container: 'meridian/payments/api',
        updatedAt: '2026-10-07T16:25:33.584Z',
      })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer glpat-t')
      const closed = yield* host.issue('meridian/payments/api#232')
      assert.deepStrictEqual(
        [closed.status, closed.body, closed.assignees, closed.labels],
        [{ name: 'Closed', category: 'done' }, '', [], []],
      )
      assert.strictEqual((yield* Effect.flip(host.issue('MER-231'))).reason, 'not_found')
      assert.strictEqual((yield* Effect.flip(host.issue('#231'))).reason, 'not_found')
    }),
  )

  it.effect('lists the account’s open issues, everywhere or in one project', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        [
          'GET',
          `${API}/issues?scope=assigned_to_me&state=opened&order_by=updated_at&sort=desc&per_page=5`,
          {
            json: [issue(), issue({ iid: 9, references: undefined, web_url: 'https://gitlab.com/meridian/web/-/issues/9' })],
          },
        ],
        [
          'GET',
          `${API}/projects/meridian%2Fweb/issues?scope=assigned_to_me&state=opened&order_by=updated_at&sort=desc&per_page=50`,
          { json: [issue({ iid: 9, references: undefined })] },
        ],
      ])
      assert.deepStrictEqual(
        (yield* host.mine({ limit: 5 })).map((found) => [found.ref, found.container]),
        [
          ['meridian/payments/api#231', 'meridian/payments/api'],
          ['meridian/web#9', 'meridian/web'],
        ],
      )
      assert.deepStrictEqual(
        (yield* host.mine({ container: 'meridian/web' })).map((found) => found.ref),
        ['meridian/web#9'],
      )
      assert.strictEqual(sent.length, 2)
    }),
  )

  it.effect('comments on an issue, and leaves linking to the merge request’s mention', () =>
    Effect.gen(function* () {
      const { host, sent } = gitlab([
        ['POST', `${API}/projects/meridian%2Fpayments%2Fapi/issues/231/notes`, { status: 201, json: { id: 1 } }],
      ])
      const found: Issue = {
        id: '205729782',
        ref: 'meridian/payments/api#231',
        key: '#231',
        title: 't',
        body: '',
        url: '',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [],
        labels: [],
        container: 'meridian/payments/api',
        updatedAt: '',
      }
      yield* host.comment(found, 'Picked up')
      assert.deepStrictEqual(sent[0]?.body, { body: 'Picked up' })
      yield* host.link(found, { url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12', title: 'MR !12' })
      assert.strictEqual(sent.length, 1)
      assert.isFalse(host.capabilities.links)
      assert.strictEqual((yield* Effect.flip(host.comment({ ...found, ref: 'MER-1' }, 'x'))).reason, 'not_found')
    }),
  )
})
