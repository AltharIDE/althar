import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { checkRunState, makeGitHub, tail } from '../src/github'
import type { Issue, Repository } from '../src/model'
import { type Route, stubFetch, variablesOf } from './stub'

const API = 'https://api.github.com'
const REPO = `${API}/repos/meridian/api`
const repository: Repository = {
  id: '7',
  path: ['meridian', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://github.com/meridian/api',
  canPush: true,
  merges: ['squash', 'merge'],
}

const github = (routes: ReadonlyArray<Route>, apiUrl = API) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitHub({ fetch, apiUrl, webUrl: 'https://github.com', credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }) }),
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
  draft: true,
  merged_at: null,
  head: { ref: 'althar/mer-231', sha: 'abc' },
  base: { ref: 'main' },
  user: { id: 5, login: 'you', type: 'User' },
  additions: 10,
  deletions: 2,
  changed_files: 3,
  updated_at: '2026-10-01T09:00:00Z',
  ...overrides,
})

describe('GitHub as a code host', () => {
  it.effect('says who it is signed in as, with GitHub’s headers', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['GET', `${API}/user`, { json: { id: 5, login: 'you', name: 'You' } }]])
      assert.deepStrictEqual(yield* host.account, { id: '5', login: 'you', name: 'You' })
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer ghu_t')
      assert.strictEqual(sent[0]?.headers['x-github-api-version'], '2022-11-28')
    }),
  )

  it.effect('reads a repository, and whether the account may push', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          REPO,
          {
            json: {
              id: 7,
              full_name: 'meridian/api',
              default_branch: 'trunk',
              html_url: 'https://github.com/meridian/api',
              permissions: { push: true },
              allow_squash_merge: true,
              allow_merge_commit: true,
              allow_rebase_merge: false,
            },
          },
        ],
        [
          'GET',
          `${API}/repos/meridian/web`,
          { json: { id: 8, full_name: 'meridian/web', default_branch: 'main', html_url: 'https://github.com/meridian/web' } },
        ],
      ])
      assert.deepStrictEqual(yield* host.repository(['meridian', 'api']), { ...repository, defaultBranch: 'trunk' })
      // Without push, GitHub doesn't say how it merges: a merge commit, as it would by default.
      const web = yield* host.repository(['meridian', 'web'])
      assert.isFalse(web.canPush)
      assert.deepStrictEqual(web.merges, ['merge'])
    }),
  )

  it.effect('merges in the first way the repository allows, only the head it last saw, and says why it can’t', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['PUT', `${REPO}/pulls/12/merge`, { json: { merged: true } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ merged_at: '2026-10-01T12:00:00Z', state: 'closed' }) }],
      ])
      const open = yield* host.change(repository, 12)
      const merged = yield* host.merge(repository, open)
      assert.strictEqual(merged.state, 'merged')
      const asked = sent.find((request) => request.method === 'PUT')
      assert.deepStrictEqual(asked?.body, { merge_method: 'squash', sha: open.headSha })
      const refusing = github([
        ['PUT', `${REPO}/pulls/12/merge`, { status: 405, json: { message: 'Pull Request is not mergeable' } }],
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
      ])
      const refused = yield* Effect.flip(refusing.host.merge({ ...repository, merges: [] }, yield* refusing.host.change(repository, 12)))
      assert.deepInclude(refused, { reason: 'rejected', message: 'Pull Request is not mergeable' })
      assert.deepStrictEqual(refusing.sent.find((request) => request.method === 'PUT')?.body, {
        merge_method: 'merge',
        sha: open.headSha,
      })
    }),
  )

  it.effect('finds the open pull request from a branch', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', /\/pulls\?state=open&head=meridian%3Aalthar%2Fmer-231$/, { json: [pull()] }],
        ['GET', /\/pulls\?state=open&head=meridian%3Aother$/, { json: [] }],
      ])
      const found = yield* host.findChange(repository, 'althar/mer-231')
      assert.deepStrictEqual(found, {
        id: 'PR_1',
        number: 12,
        title: 'Rate-limit refunds',
        body: '',
        url: 'https://github.com/meridian/api/pull/12',
        state: 'open',
        draft: true,
        source: 'althar/mer-231',
        target: 'main',
        headSha: 'abc',
        author: { id: '5', login: 'you', name: null, bot: false },
        additions: 10,
        deletions: 2,
        changedFiles: 3,
        updatedAt: '2026-10-01T09:00:00Z',
      })
      assert.isNull(yield* host.findChange(repository, 'other'))
      assert.lengthOf(sent, 2)
    }),
  )

  it.effect('opens a draft pull request, or adopts the one already open from its branch', () =>
    Effect.gen(function* () {
      let opened = 0
      const { host, sent } = github([
        [
          'POST',
          `${REPO}/pulls`,
          () =>
            (opened += 1) === 1
              ? { status: 201, json: pull() }
              : {
                  status: 422,
                  json: {
                    message: 'Validation Failed',
                    errors: [{ message: 'A pull request already exists for meridian:althar/mer-231.' }],
                  },
                },
        ],
        ['GET', /\/pulls\?state=open&head=/, { json: [pull({ draft: false })] }],
      ])
      const change = { title: 'MER-231: Rate-limit refunds', body: 'Body', source: 'althar/mer-231', target: 'main', draft: true }
      assert.strictEqual((yield* host.openChange(repository, change)).number, 12)
      assert.deepStrictEqual(sent[0]?.body, {
        title: 'MER-231: Rate-limit refunds',
        body: 'Body',
        head: 'althar/mer-231',
        base: 'main',
        draft: true,
      })
      const adopted = yield* host.openChange(repository, change)
      assert.strictEqual(adopted.number, 12)
      assert.isFalse(adopted.draft)
    }),
  )

  it.effect('fails to open when GitHub refuses for another reason, or the one it says exists is gone', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'POST',
          `${REPO}/pulls`,
          { status: 422, json: { message: 'Validation Failed', errors: [{ message: 'No commits between main and x' }] } },
        ],
      ])
      const error = yield* Effect.flip(host.openChange(repository, { title: 't', body: '', source: 'x', target: 'main', draft: true }))
      assert.strictEqual(error.reason, 'rejected')
      const vanished = github([
        ['POST', `${REPO}/pulls`, { status: 422, json: { message: 'A pull request already exists' } }],
        ['GET', /\/pulls\?state=open&head=/, { json: [] }],
      ])
      assert.strictEqual(
        (yield* Effect.flip(vanished.host.openChange(repository, { title: 't', body: '', source: 'x', target: 'main', draft: true })))
          .reason,
        'rejected',
      )
    }),
  )

  it.effect('reads a pull request’s state: merged, closed, open', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-02T00:00:00Z', user: null }) }],
        ['GET', `${REPO}/pulls/13`, { json: pull({ number: 13, state: 'closed', draft: undefined, additions: undefined }) }],
      ])
      const merged = yield* host.change(repository, 12)
      assert.strictEqual(merged.state, 'merged')
      assert.isNull(merged.author)
      const closed = yield* host.change(repository, 13)
      assert.strictEqual(closed.state, 'closed')
      assert.isFalse(closed.draft)
      assert.isNull(closed.additions)
    }),
  )

  it.effect('marks a draft ready through GraphQL, on github.com and on an instance', () =>
    Effect.gen(function* () {
      const cloud = github([
        ['POST', 'https://api.github.com/graphql', { json: { data: { markPullRequestReadyForReview: { pullRequest: { id: 'PR_1' } } } } }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
      ])
      const ready = yield* cloud.host.markReady(repository, { ...(yield* cloud.host.change(repository, 12)), draft: true, id: 'PR_1' })
      assert.isFalse(ready.draft)
      assert.deepStrictEqual(variablesOf(cloud.sent.find((request) => request.method === 'POST')), {
        id: 'PR_1',
      })
      const instance = github(
        [
          ['POST', 'https://git.meridian.dev/api/graphql', { json: { data: {} } }],
          ['GET', 'https://git.meridian.dev/api/v3/repos/meridian/api/pulls/12', { json: pull({ draft: false }) }],
        ],
        'https://git.meridian.dev/api/v3/',
      )
      assert.isFalse((yield* instance.host.markReady(repository, { ...(yield* cloud.host.change(repository, 12)), id: 'PR_1' })).draft)
    }),
  )

  it('reads a check run’s state', () => {
    assert.strictEqual(checkRunState('queued', null), 'queued')
    assert.strictEqual(checkRunState('in_progress', null), 'running')
    assert.strictEqual(checkRunState('completed', 'success'), 'passed')
    assert.strictEqual(checkRunState('completed', 'failure'), 'failed')
    assert.strictEqual(checkRunState('completed', 'timed_out'), 'failed')
    assert.strictEqual(checkRunState('completed', 'skipped'), 'skipped')
    assert.strictEqual(checkRunState('completed', 'cancelled'), 'cancelled')
    assert.strictEqual(checkRunState('completed', 'neutral'), 'neutral')
    assert.strictEqual(checkRunState('completed', 'stale'), 'neutral')
  })

  it.effect('reads checks from check runs and commit statuses alike', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          {
            json: {
              check_runs: [
                {
                  id: 1,
                  name: 'test',
                  status: 'completed',
                  conclusion: 'failure',
                  html_url: 'https://x/1',
                  output: { title: '2 failed' },
                  app: { slug: 'github-actions' },
                },
                { id: 2, name: 'lint', status: 'in_progress', details_url: 'https://x/2', app: null },
              ],
            },
          },
        ],
        [
          'GET',
          `${REPO}/commits/abc/status`,
          {
            json: {
              statuses: [
                { id: 3, context: 'ci/circle', state: 'success', target_url: 'https://c/3', description: 'Passed' },
                { id: 4, context: 'deploy', state: 'pending' },
                { id: 5, context: 'security', state: 'error' },
              ],
            },
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'run:1:github-actions', name: 'test', state: 'failed', url: 'https://x/1', summary: '2 failed' },
        { id: 'run:2:', name: 'lint', state: 'running', url: 'https://x/2', summary: null },
        { id: 'status:3', name: 'ci/circle', state: 'passed', url: 'https://c/3', summary: 'Passed' },
        { id: 'status:4', name: 'deploy', state: 'running', url: null, summary: null },
        { id: 'status:5', name: 'security', state: 'failed', url: null, summary: null },
      ])
    }),
  )

  it.effect('reads the end of a GitHub Actions job’s log, and nothing for other checks', () =>
    Effect.gen(function* () {
      const long = Array.from({ length: 400 }, (_, n) => `line ${n}`).join('\n')
      const { host } = github([
        ['GET', `${REPO}/actions/jobs/1/logs`, { text: long }],
        ['GET', `${REPO}/actions/jobs/9/logs`, { status: 404, json: { message: 'Not Found' } }],
        ['GET', `${REPO}/actions/jobs/8/logs`, { status: 500, text: 'down' }],
      ])
      const check = { name: 'test', state: 'failed' as const, url: null, summary: null }
      const log = yield* host.checkLog(repository, { ...check, id: 'run:1:github-actions' })
      assert.strictEqual(log?.split('\n').length, 150)
      assert.isTrue(log?.endsWith('line 399'))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'run:9:github-actions' }))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'status:3' }))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'run:2:circleci' }))
      assert.strictEqual((yield* Effect.flip(host.checkLog(repository, { ...check, id: 'run:8:github-actions' }))).reason, 'unreachable')
    }),
  )

  it('keeps at most a few thousand characters of a log', () => {
    assert.lengthOf(tail('x'.repeat(20_000)), 12_000)
  })

  it.effect('reads what was said on a pull request since a cursor, oldest first', () =>
    Effect.gen(function* () {
      const user = (login: string, type = 'User') => ({ id: login.length, login, type })
      const { host, sent } = github([
        [
          'GET',
          /\/issues\/12\/comments\?per_page=100/,
          {
            json: [
              {
                id: 30,
                user: user('dana'),
                author_association: 'COLLABORATOR',
                body: 'Seconds or a date?',
                updated_at: '2026-10-01T10:05:00Z',
                html_url: 'https://c/30',
              },
              { id: 31, user: user('ci[bot]', 'Bot'), author_association: 'NONE', body: null, updated_at: '2026-10-01T10:01:00Z' },
            ],
          },
        ],
        [
          'GET',
          /\/pulls\/12\/comments\?per_page=100/,
          {
            json: [
              {
                id: 40,
                user: user('dana'),
                author_association: 'MEMBER',
                body: 'Here',
                updated_at: '2026-10-01T10:02:00Z',
                path: 'src/limit.ts',
                line: 14,
              },
              {
                id: 41,
                user: null,
                body: 'Reply',
                updated_at: '2026-10-01T10:03:00Z',
                path: 'src/limit.ts',
                original_line: 14,
                in_reply_to_id: 40,
              },
            ],
          },
        ],
        [
          'GET',
          /\/pulls\/12\/reviews\?per_page=100$/,
          {
            json: [
              {
                id: 50,
                user: user('dana'),
                author_association: 'OWNER',
                body: 'Fix the header',
                state: 'CHANGES_REQUESTED',
                submitted_at: '2026-10-01T10:04:00Z',
              },
              { id: 51, user: user('lee'), body: '', state: 'COMMENTED', submitted_at: '2026-10-01T10:06:00Z' },
              { id: 52, user: user('lee'), body: 'Old', state: 'APPROVED', submitted_at: '2026-10-01T09:00:00Z' },
              { id: 53, user: user('lee'), body: '', state: 'PENDING', submitted_at: null },
              {
                id: 54,
                user: user('kim'),
                author_association: 'FIRST_TIME_CONTRIBUTOR',
                body: 'Nice',
                state: 'COMMENTED',
                submitted_at: '2026-10-01T10:07:00Z',
              },
            ],
          },
        ],
      ])
      const activity = yield* host.activity(repository, 12, '2026-10-01T10:00:00Z')
      assert.include(sent[0]?.url, 'since=2026-10-01T10%3A00%3A00Z')
      assert.deepStrictEqual(
        activity.comments.map((comment) => [
          comment.id,
          comment.author.login,
          comment.author.bot,
          comment.member,
          comment.threadId,
          comment.line,
        ]),
        [
          ['31', 'ci[bot]', true, false, null, null],
          ['40', 'dana', false, true, '40', 14],
          ['41', 'ghost', false, false, '40', 14],
          ['30', 'dana', false, true, null, null],
        ],
      )
      assert.deepStrictEqual(
        activity.reviews.map((review) => [review.id, review.verdict, review.member]),
        [
          ['50', 'changes_requested', true],
          ['54', 'commented', false],
        ],
      )
      assert.strictEqual(activity.cursor, '2026-10-01T10:07:00Z')
    }),
  )

  it.effect('reads everything said, from the start, without a cursor', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', /\/issues\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/comments/, { json: [] }],
        ['GET', /\/pulls\/12\/reviews/, { json: [{ id: 1, user: null, state: 'APPROVED', submitted_at: '2026-10-01T09:00:00Z' }] }],
      ])
      const activity = yield* host.activity(repository, 12, null)
      assert.notInclude(sent[0]?.url, 'since')
      assert.strictEqual(activity.reviews[0]?.verdict, 'approved')
      assert.strictEqual(activity.cursor, '2026-10-01T09:00:00Z')
    }),
  )

  it.effect('replies in a line’s thread, or in the conversation', () =>
    Effect.gen(function* () {
      const answer = { id: 60, user: { id: 5, login: 'you' }, body: 'Done', updated_at: '2026-10-01T11:00:00Z' }
      const { host, sent } = github([
        ['POST', `${REPO}/pulls/12/comments/40/replies`, { status: 201, json: { ...answer, path: 'src/limit.ts', in_reply_to_id: 40 } }],
        ['POST', `${REPO}/issues/12/comments`, { status: 201, json: answer }],
      ])
      assert.strictEqual((yield* host.reply(repository, 12, { body: 'Done', threadId: '40' })).threadId, '40')
      assert.isNull((yield* host.reply(repository, 12, { body: 'Done', threadId: null })).threadId)
      assert.deepStrictEqual(sent[0]?.body, { body: 'Done' })
    }),
  )

  it.effect('pushes over HTTPS with the token, never the person’s own credentials', () =>
    Effect.gen(function* () {
      const { host } = github([])
      const target = yield* host.pushTarget(repository)
      assert.strictEqual(target.url, 'https://github.com/meridian/api.git')
      assert.strictEqual(target.header, `Authorization: Basic ${Buffer.from('x-access-token:ghu_t').toString('base64')}`)
    }),
  )
})

describe('GitHub as a tracker', () => {
  const issue = (overrides: Record<string, unknown> = {}) => ({
    id: 900,
    number: 12,
    title: 'Refunds ignore the rate limit',
    body: 'They should not.',
    html_url: 'https://github.com/meridian/api/issues/12',
    state: 'open',
    assignees: [{ id: 5, login: 'you' }],
    labels: ['bug', { name: 'payments' }, { name: null }],
    updated_at: '2026-10-01T08:00:00Z',
    ...overrides,
  })

  it.effect('reads an issue by owner/repo#number', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/issues/12`, { json: issue() }],
        [
          'GET',
          `${REPO}/issues/13`,
          { json: issue({ number: 13, state: 'closed', state_reason: 'completed', body: null, assignees: null, labels: undefined }) },
        ],
        ['GET', `${REPO}/issues/14`, { json: issue({ number: 14, state: 'closed', state_reason: 'not_planned' }) }],
      ])
      const open = yield* host.issue('meridian/api#12')
      assert.deepStrictEqual(open, {
        id: '900',
        ref: 'meridian/api#12',
        key: '#12',
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        url: 'https://github.com/meridian/api/issues/12',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [{ id: '5', login: 'you', name: null, bot: false }],
        labels: ['bug', 'payments'],
        container: 'meridian/api',
        updatedAt: '2026-10-01T08:00:00Z',
      })
      const done = yield* host.issue('meridian/api#13')
      assert.strictEqual(done.status.category, 'done')
      assert.deepStrictEqual([done.body, done.assignees, done.labels], ['', [], []])
      assert.strictEqual((yield* host.issue('meridian/api#14')).status.category, 'cancelled')
      assert.strictEqual((yield* Effect.flip(host.issue('MER-231'))).reason, 'not_found')
    }),
  )

  it.effect('lists the account’s open issues, in a repository or everywhere, without pull requests', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${API}/user`, { json: { id: 5, login: 'you' } }],
        ['GET', /\/repos\/meridian\/api\/issues\?assignee=you&state=open/, { json: [issue(), issue({ number: 15, pull_request: {} })] }],
        ['GET', /\/issues\?filter=assigned&state=open/, { json: [issue({ repository_url: 'https://api.github.com/repos/meridian/web' })] }],
      ])
      const here = yield* host.mine({ container: 'meridian/api', limit: 10 })
      assert.deepStrictEqual(
        here.map((found) => found.ref),
        ['meridian/api#12'],
      )
      assert.include(sent[1]?.url, 'per_page=10')
      const everywhere = yield* host.mine()
      assert.strictEqual(everywhere[0]?.ref, 'meridian/web#12')
    }),
  )

  it.effect('comments on an issue, and has no links to attach', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${REPO}/issues/12/comments`, { status: 201, json: {} }]])
      const found: Issue = {
        id: '900',
        ref: 'meridian/api#12',
        key: '#12',
        title: 't',
        body: '',
        url: 'https://github.com/meridian/api/issues/12',
        status: { name: 'Open', category: 'todo' },
        priority: null,
        assignees: [],
        labels: [],
        container: 'meridian/api',
        updatedAt: '2026-10-01T08:00:00Z',
      }
      yield* host.comment(found, 'Picked up by Althar')
      assert.deepStrictEqual(sent[0]?.body, { body: 'Picked up by Althar' })
      yield* host.link(found, { url: 'https://x', title: 'x' })
      assert.lengthOf(sent, 1)
      assert.isFalse(host.capabilities.links)
    }),
  )
})
