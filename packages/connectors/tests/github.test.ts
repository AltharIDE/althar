import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'

import { checkRunState, leftQueueOf, LISTING_KEPT_MS, makeGitHub, searchOf, tail } from '../src/github'
import { fromOutside, type Issue, type Repository } from '../src/model'
import { type Route, type Sent, stubFetch, variablesOf } from './stub'

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
        ['PUT', `${REPO}/pulls/12/merge`, { json: { merged: true, sha: 'merge-sha' } }],
        // GitHub's replica can still say open just after: what the merge answered is what counts.
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
      ])
      const open = yield* host.change(repository, 12)
      const merged = yield* host.merge(repository, open)
      assert.deepInclude(merged, { state: 'merged', number: 12, headSha: open.headSha, url: open.url })
      const asked = sent.find((request) => request.method === 'PUT')
      assert.deepStrictEqual(asked?.body, { merge_method: 'squash', sha: open.headSha })
      // Not read back: one read, before the merge.
      assert.strictEqual(sent.filter((request) => request.method === 'GET').length, 1)
      // Where GitHub doesn't say it merged, it is read back.
      const unsaid = github([
        ['PUT', `${REPO}/pulls/12/merge`, { json: {} }],
        ['GET', `${REPO}/pulls/12`, { json: pull({ merged_at: '2026-10-01T12:00:00Z', state: 'closed' }) }],
      ])
      assert.strictEqual((yield* unsaid.host.merge(repository, open)).state, 'merged')
      assert.strictEqual(unsaid.sent.filter((request) => request.method === 'GET').length, 1)
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

  it.effect('puts a pull request in its branch’s merge queue where GitHub refuses a merge for one, and reads it there when asked', () =>
    Effect.gen(function* () {
      const queue = (pull: Record<string, unknown> = {}) => ({
        json: {
          data: {
            repository: { pullRequest: { isMergeQueueEnabled: true, isInMergeQueue: false, timelineItems: { nodes: [] }, ...pull } },
          },
        },
      })
      const enqueuing = (request: Sent) => JSON.stringify(request.body).includes('enqueuePullRequest')
      const refusal = { status: 405, json: { message: 'Repository rule violations found\n\nChanges must be made through the merge queue' } }
      const { host, sent } = github([
        ['PUT', `${REPO}/pulls/12/merge`, refusal],
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        [
          'POST',
          `${API}/graphql`,
          (request) => (enqueuing(request) ? { json: { data: { enqueuePullRequest: { mergeQueueEntry: { position: 1 } } } } } : queue()),
        ],
      ])
      const open = yield* host.change(repository, 12)
      // Refused for its queue, it goes in, at the head Althar saw, and is open still: GitHub merges it later.
      assert.deepInclude(yield* host.merge(repository, open), { state: 'open', queued: true, number: 12, headSha: 'abc' })
      const [asked, enqueued] = sent.filter((request) => request.method === 'POST')
      assert.deepStrictEqual(variablesOf(asked), { owner: 'meridian', name: 'api', number: 12 })
      assert.deepStrictEqual(variablesOf(enqueued), { id: 'PR_1', head: 'abc' })
      // In it already, as pressing Merge again finds it, it isn't put in twice.
      const already = github([
        ['PUT', `${REPO}/pulls/12/merge`, refusal],
        ['POST', `${API}/graphql`, queue({ isInMergeQueue: true })],
      ])
      assert.deepInclude(yield* already.host.merge(repository, open), { state: 'open', queued: true })
      assert.lengthOf(already.sent.filter(enqueuing), 0)
      // Refused on a branch with no queue, or where GitHub won't say, it is the refusal it was.
      for (const answer of [queue({ isMergeQueueEnabled: false }), { status: 502, json: {} }]) {
        const plain = github([
          ['PUT', `${REPO}/pulls/12/merge`, { status: 405, json: { message: 'Pull Request is not mergeable' } }],
          ['POST', `${API}/graphql`, answer],
        ])
        assert.deepInclude(yield* Effect.flip(plain.host.merge(repository, open)), {
          reason: 'rejected',
          message: 'Pull Request is not mergeable',
        })
        assert.lengthOf(plain.sent.filter(enqueuing), 0)
      }
      // Read, it says where it stands with the queue only when asked: out of it, and why the queue took it out.
      const reading = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ timelineItems: { nodes: [{ reason: 'failed_checks' }] } })],
      ])
      assert.notProperty(yield* reading.host.change(repository, 12), 'queued')
      assert.lengthOf(
        reading.sent.filter((request) => request.method === 'POST'),
        0,
      )
      assert.deepInclude(yield* reading.host.change(repository, 12, { queue: true }), { queued: false, leftQueue: 'checks' })
      const inIt = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, queue({ isInMergeQueue: true })],
      ])
      assert.deepInclude(yield* inIt.host.change(repository, 12, { queue: true }), { queued: true, leftQueue: null })
      // A pull request GraphQL doesn't find, as REST did a moment before, on a branch known to have a queue, isn't taken for
      // one out of it.
      let found = true
      const unfound = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, () => (found ? queue({ isInMergeQueue: true }) : { json: { data: { repository: null } } })],
      ])
      yield* unfound.host.change(repository, 12, { queue: true })
      found = false
      assert.strictEqual((yield* Effect.flip(unfound.host.change(repository, 12, { queue: true }))).reason, 'not_found')
      // On a branch not known to have one, where GitHub won't say, the read stands without, and isn't asked again soon.
      const unsaid = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ draft: false }) }],
        ['POST', `${API}/graphql`, { status: 502, json: {} }],
      ])
      assert.notProperty(yield* unsaid.host.change(repository, 12, { queue: true }), 'queued')
      assert.notProperty(yield* unsaid.host.change(repository, 12, { queue: true }), 'queued')
      assert.lengthOf(
        unsaid.sent.filter((request) => request.method === 'POST'),
        1,
      )
      // Merged, there is no queue to ask about.
      const merged = github([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-28T12:00:00Z' }) }]])
      assert.notProperty(yield* merged.host.change(repository, 12, { queue: true }), 'queued')
      // GitHub's reasons, in Althar's words; one it gives that Althar doesn't know is still a reason.
      assert.deepStrictEqual(['failed_checks', 'merge_conflict', 'manual', 'merged', 'timed_out', null].map(leftQueueOf), [
        'checks',
        'conflict',
        'removed',
        'merged',
        'other',
        null,
      ])
    }),
  )

  it.effect('closes a pull request unmerged, leaves one already closed as it is, and says why it can’t', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['PATCH', `${REPO}/pulls/12`, { json: pull({ state: 'closed' }) }],
      ])
      const closed = yield* host.closeChange(repository, yield* host.change(repository, 12))
      assert.strictEqual(closed.state, 'closed')
      assert.deepStrictEqual(sent.find((request) => request.method === 'PATCH')?.body, { state: 'closed' })
      // Merged meanwhile, it isn't touched: it says it is merged.
      const already = github([['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', merged_at: '2026-10-02T00:00:00Z' }) }]])
      assert.strictEqual((yield* already.host.closeChange(repository, closed)).state, 'merged')
      assert.isFalse(already.sent.some((request) => request.method === 'PATCH'))
      // An account that can't push here is refused, in GitHub's words.
      const refusing = github([
        ['GET', `${REPO}/pulls/12`, { json: pull() }],
        ['PATCH', `${REPO}/pulls/12`, { status: 403, json: { message: 'Resource not accessible by integration' } }],
      ])
      const refused = yield* Effect.flip(refusing.host.closeChange(repository, closed))
      assert.deepInclude(refused, { reason: 'forbidden', status: 403, message: 'Resource not accessible by integration' })
    }),
  )

  it.effect('deletes a closed pull request’s branch where its head is, a fork’s too, and never an open one’s', () =>
    Effect.gen(function* () {
      const head = { ref: 'althar/mer-231', sha: 'abc', repo: { full_name: 'meridian/api' } }
      const { host, sent } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head }) }],
        ['DELETE', `${REPO}/git/refs/heads/althar/mer-231`, { status: 204 }],
      ])
      const change = yield* host.change(repository, 12)
      yield* host.deleteBranch(repository, change)
      assert.deepStrictEqual(
        sent.map((request) => `${request.method} ${request.url}`),
        [`GET ${REPO}/pulls/12`, `GET ${REPO}/pulls/12`, `DELETE ${REPO}/git/refs/heads/althar/mer-231`],
      )
      // From a fork, the fork's branch goes; one already gone, as GitHub says when asked after, is nothing to do.
      const fork = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head: { ...head, repo: { full_name: 'you/api' } } }) }],
        ['DELETE', `${API}/repos/you/api/git/refs/heads/althar/mer-231`, { status: 422, json: { message: 'Reference does not exist' } }],
        ['GET', `${API}/repos/you/api/git/ref/heads/althar/mer-231`, { status: 404, json: { message: 'Not Found' } }],
      ])
      yield* fork.host.deleteBranch(repository, change)
      assert.isTrue(fork.sent.some((request) => request.method === 'DELETE' && request.url.startsWith(`${API}/repos/you/api/`)))
      // A 422 for a branch still there (its default branch, a validation, throttling) is GitHub refusing, said in its words.
      const kept = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ state: 'closed', head }) }],
        ['DELETE', `${REPO}/git/refs/heads/althar/mer-231`, { status: 422, json: { message: 'Cannot delete the default branch' } }],
        ['GET', `${REPO}/git/ref/heads/althar/mer-231`, { json: { ref: 'refs/heads/althar/mer-231', object: { sha: 'abc' } } }],
      ])
      const stays = yield* Effect.flip(kept.host.deleteBranch(repository, change))
      assert.deepInclude(stays, { reason: 'rejected', status: 422, message: 'Cannot delete the default branch' })
      // Still open, its branch stays: deleting it would close the pull request behind the person's back.
      const open = github([['GET', `${REPO}/pulls/12`, { json: pull({ head }) }]])
      const refused = yield* Effect.flip(open.host.deleteBranch(repository, change))
      assert.deepInclude(refused, { reason: 'rejected', message: 'PR #12 is still open, so its branch stays.' })
      assert.isFalse(open.sent.some((request) => request.method === 'DELETE'))
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

  it.effect('opens one from a fork’s branch into the repository it was forked from, and finds it by the fork’s owner', () =>
    Effect.gen(function* () {
      const fork: Repository = { ...repository, id: '9', path: ['you', 'api'], webUrl: 'https://github.com/you/api' }
      const { host, sent } = github([
        ['POST', `${REPO}/pulls`, { status: 201, json: pull() }],
        ['GET', /\/repos\/meridian\/api\/pulls\?state=open&head=you%3Aalthar%2Fmer-231$/, { json: [pull()] }],
      ])
      const change = { title: 'Rate-limit refunds', body: '', source: 'althar/mer-231', target: 'main', draft: false, from: fork }
      assert.strictEqual((yield* host.openChange(repository, change)).number, 12)
      assert.strictEqual((sent[0]?.body as { head: string } | undefined)?.head, 'you:althar/mer-231')
      assert.strictEqual((yield* host.findChange(repository, 'althar/mer-231', fork))?.number, 12)
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

  it.effect('says when a pull request conflicts with its target, once GitHub has worked it out', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/pulls/12`, { json: pull({ mergeable: false, mergeable_state: 'dirty' }) }],
        ['GET', `${REPO}/pulls/13`, { json: pull({ number: 13, mergeable: true, mergeable_state: 'blocked' }) }],
        ['GET', `${REPO}/pulls/14`, { json: pull({ number: 14, mergeable: null, mergeable_state: 'unknown' }) }],
        ['GET', `${REPO}/pulls/15`, { json: pull({ number: 15 }) }],
      ])
      assert.isTrue((yield* host.change(repository, 12)).conflicts)
      // Blocked by a rule is not a conflict.
      assert.isFalse((yield* host.change(repository, 13)).conflicts)
      // Still working it out, or not said at all, as in a list: nothing is claimed.
      assert.notProperty(yield* host.change(repository, 14), 'conflicts')
      assert.notProperty(yield* host.change(repository, 15), 'conflicts')
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

  it.effect('reads a commit’s statuses alone where check runs are refused, as a fine-grained token’s are', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          { status: 403, json: { message: 'Resource not accessible by personal access token' } },
        ],
        ['GET', `${REPO}/commits/abc/status`, { json: { statuses: [{ id: 3, context: 'ci/circle', state: 'success' }] } }],
      ])
      assert.deepStrictEqual(yield* host.checks(repository, 'abc'), [
        { id: 'status:3', name: 'ci/circle', state: 'passed', url: null, summary: null },
      ])
      // Anything else that keeps check runs from being read still fails the checks.
      const limited = github([
        [
          'GET',
          `${REPO}/commits/abc/check-runs?per_page=100`,
          { status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: { message: 'API rate limit exceeded' } },
        ],
      ])
      assert.strictEqual((yield* Effect.flip(limited.host.checks(repository, 'abc'))).reason, 'rate_limited')
    }),
  )

  it.effect('reads the end of a GitHub Actions job’s log from the storage GitHub redirects to, without the token', () =>
    Effect.gen(function* () {
      const long = Array.from({ length: 400 }, (_, n) => `2026-10-18T19:42:01.0000000Z line ${n}`).join('\n')
      // As GitHub answers: a 302 to the log in its storage, signed for a minute, which refuses a request that carries a token too.
      const blob = 'https://productionresultssa0.blob.core.windows.net/actions-results/abc/logs/job/job-logs.txt?sv=2025-01-05&sig=x'
      const { host, sent } = github([
        ['GET', `${REPO}/actions/jobs/1/logs`, { status: 302, headers: { location: blob } }],
        [
          'GET',
          blob,
          (request) =>
            request.headers.authorization === undefined
              ? { text: long }
              : { status: 400, text: '\uFEFF<?xml version="1.0"?><Error><Code>InvalidAuthenticationInfo</Code></Error>' },
        ],
      ])
      const check = { name: 'verify', state: 'failed' as const, url: null, summary: null }
      const log = yield* host.checkLog(repository, { ...check, id: 'run:1:github-actions' })
      assert.strictEqual(log?.split('\n').length, 150)
      assert.isTrue(log?.endsWith('line 399'))
      assert.strictEqual(sent[0]?.headers.authorization, 'Bearer ghu_t')
      assert.strictEqual(sent[1]?.url, blob)
      assert.isUndefined(sent[1]?.headers.authorization)
      assert.isUndefined(sent[1]?.headers['x-github-api-version'])
      // With `whole`, all of it.
      assert.strictEqual((yield* host.checkLog(repository, { ...check, id: 'run:1:github-actions' }, true))?.split('\n').length, 400)
    }),
  )

  it.effect('says why a GitHub Actions job’s log can’t be read, and reads nothing for other checks', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/actions/jobs/9/logs`, { status: 410, json: { message: 'Gone' } }],
        ['GET', `${REPO}/actions/jobs/7/logs`, { status: 403, json: { message: 'Resource not accessible by personal access token' } }],
        ['GET', `${REPO}/actions/jobs/6/logs`, { status: 302, headers: { location: 'https://storage.example/log?sig=old' } }],
        ['GET', 'https://storage.example/log?sig=old', { status: 403, text: '<Error><Code>AuthenticationFailed</Code></Error>' }],
        ['GET', `${REPO}/actions/jobs/8/logs`, { status: 500, text: 'down' }],
      ])
      const check = { name: 'test', state: 'failed' as const, url: null, summary: null }
      const failed = (id: string) => Effect.flip(host.checkLog(repository, { ...check, id }))
      assert.strictEqual((yield* failed('run:9:github-actions')).reason, 'not_found')
      const refused = yield* failed('run:7:github-actions')
      assert.strictEqual(refused.reason, 'forbidden')
      assert.strictEqual(refused.message, 'Resource not accessible by personal access token')
      // The storage's own XML isn't words: where it was, and what it answered, are.
      const storage = yield* failed('run:6:github-actions')
      assert.strictEqual(storage.reason, 'rejected')
      assert.strictEqual(storage.message, 'storage.example answered 403')
      assert.strictEqual((yield* failed('run:8:github-actions')).reason, 'unreachable')
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'status:3' }))
      assert.isNull(yield* host.checkLog(repository, { ...check, id: 'run:2:circleci' }))
    }),
  )

  it.effect('reads what a check run from another service reported of itself', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['GET', `${REPO}/check-runs/2`, { json: { output: { title: '1 new alert', summary: 'SQL injection', text: 'in src/db.ts:12' } } }],
        ['GET', `${REPO}/check-runs/3`, { json: { output: { title: 'Failed', summary: null, text: '' } } }],
      ])
      const check = { name: 'CodeQL', state: 'failed' as const, url: null, summary: null }
      assert.strictEqual(
        yield* host.checkReport!(repository, { ...check, id: 'run:2:github-advanced-security' }),
        'SQL injection\n\nin src/db.ts:12',
      )
      assert.isNull(yield* host.checkReport!(repository, { ...check, id: 'run:3:circleci' }))
      assert.isNull(yield* host.checkReport!(repository, { ...check, id: 'status:4' }))
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

  it.effect('reads a pull request to review: whether its author is one of the repository’s people, and the fork it comes from', () =>
    Effect.gen(function* () {
      const base = { ref: 'main', sha: 'b45e', repo: { full_name: 'meridian/api' } }
      const { host } = github([
        // A collaborator's branch of the repository's own: from inside.
        [
          'GET',
          `${REPO}/pulls/12`,
          {
            json: pull({
              head: { ref: 'fix', sha: 'abc', repo: { full_name: 'Meridian/API' } },
              base,
              author_association: 'COLLABORATOR',
              user: { id: 9, login: 'ana', type: 'User' },
            }),
          },
        ],
        // A first contribution, from a fork: outside twice over.
        [
          'GET',
          `${REPO}/pulls/13`,
          {
            json: pull({
              number: 13,
              head: { ref: 'send-back', sha: 'd4c8ae4', repo: { full_name: 'ninemate/api' } },
              base,
              author_association: 'FIRST_TIME_CONTRIBUTOR',
              user: { id: 10, login: 'ninemate', type: 'User' },
            }),
          },
        ],
        // A member's branch on a fork GitHub no longer has: a fork, with no path.
        [
          'GET',
          `${REPO}/pulls/14`,
          { json: pull({ number: 14, head: { ref: 'gone', sha: 'e1', repo: null }, base, author_association: 'MEMBER' }) },
        ],
        // An answer that says neither, as an older GitHub's might: from inside, by nobody named.
        ['GET', `${REPO}/pulls/15`, { json: pull({ number: 15 }) }],
      ])
      const inside = yield* host.changeToReview(repository, 12)
      assert.deepInclude(inside, { number: 12, member: true, fork: null, baseSha: 'b45e', headSha: 'abc', additions: 10, deletions: 2 })
      assert.isFalse(fromOutside(inside))
      const outside = yield* host.changeToReview(repository, 13)
      assert.deepInclude(outside, { member: false, baseSha: 'b45e', headSha: 'd4c8ae4' })
      assert.deepStrictEqual(outside.fork, ['ninemate', 'api'])
      assert.strictEqual(outside.author?.login, 'ninemate')
      assert.isTrue(fromOutside(outside))
      const gone = yield* host.changeToReview(repository, 14)
      assert.deepStrictEqual([gone.member, gone.fork], [true, []])
      assert.isTrue(fromOutside(gone))
      const unsaid = yield* host.changeToReview(repository, 15)
      assert.deepStrictEqual([unsaid.member, unsaid.fork, unsaid.baseSha], [false, null, null])
    }),
  )

  it.effect('posts a review with its verdict, its summary and its comments on lines, of the commit it read', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'POST',
          `${REPO}/pulls/13/reviews`,
          { json: { id: 801, html_url: 'https://github.com/meridian/api/pull/13#pullrequestreview-801', state: 'CHANGES_REQUESTED' } },
        ],
        ['POST', `${REPO}/pulls/14/reviews`, { json: { id: 802 } }],
        [
          'POST',
          `${REPO}/pulls/15/reviews`,
          { status: 422, json: { message: 'Pull request review thread line must be part of the diff' } },
        ],
      ])
      const posted = yield* host.postReview(repository, 13, {
        event: 'request_changes',
        body: 'Needs a test.',
        commit: 'd4c8ae4',
        comments: [{ path: 'src/limit.ts', line: 7, body: 'Refunds skip this.' }],
      })
      assert.deepStrictEqual(posted, { id: '801', url: 'https://github.com/meridian/api/pull/13#pullrequestreview-801' })
      assert.deepStrictEqual(sent[0]?.body, {
        commit_id: 'd4c8ae4',
        body: 'Needs a test.',
        event: 'REQUEST_CHANGES',
        comments: [{ path: 'src/limit.ts', line: 7, side: 'RIGHT', body: 'Refunds skip this.' }],
      })
      // Of the head as GitHub has it, an approval with no comments; GitHub giving no link, none is made up.
      assert.deepStrictEqual(yield* host.postReview(repository, 14, { event: 'approve', body: 'Good.', commit: null, comments: [] }), {
        id: '802',
        url: null,
      })
      assert.deepStrictEqual(sent[1]?.body, { body: 'Good.', event: 'APPROVE', comments: [] })
      // A line the change doesn't touch is GitHub's to refuse, in its words.
      const refused = yield* Effect.flip(
        host.postReview(repository, 15, {
          event: 'comment',
          body: 'A thought.',
          commit: null,
          comments: [{ path: 'a', line: 1, body: 'b' }],
        }),
      )
      assert.deepInclude(refused, { reason: 'rejected', message: 'Pull request review thread line must be part of the diff' })
      assert.deepInclude(sent[2]?.body, { event: 'COMMENT' })
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

/*
 * GitHub's answers to the list's search, as its GraphQL API gives them: one
 * of Althar's own drafts with checks running, an outside contributor's from a
 * fork with changes asked for, an app's, and a merged one. Written out by
 * hand in the shape GitHub documents, not recorded from a live call.
 */
const listed = (overrides: Record<string, unknown> = {}) => ({
  id: 'PR_kwDO12',
  number: 12,
  title: 'Rate-limit refunds',
  url: 'https://github.com/meridian/api/pull/12',
  state: 'OPEN',
  isDraft: true,
  headRefName: 'althar/mer-231',
  baseRefName: 'main',
  headRefOid: 'abc',
  updatedAt: '2026-10-13T09:00:00Z',
  isCrossRepository: false,
  headRepositoryOwner: { login: 'meridian' },
  author: { __typename: 'User', login: 'you', databaseId: 5, name: 'You' },
  reviewDecision: null,
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
  ...overrides,
})

const SEARCHED = {
  data: {
    search: {
      issueCount: 41,
      nodes: [
        listed(),
        listed({
          id: 'PR_kwDO13',
          number: 13,
          title: 'Send back won’t restart a dead lead',
          url: 'https://github.com/meridian/api/pull/13',
          isDraft: false,
          headRefName: 'send-back',
          isCrossRepository: true,
          headRepositoryOwner: { login: 'ninemate' },
          author: { __typename: 'User', login: 'ninemate', databaseId: 10, name: null },
          reviewDecision: 'CHANGES_REQUESTED',
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
        }),
        listed({
          id: 'PR_kwDO14',
          number: 14,
          title: 'Bump effect',
          isDraft: false,
          author: { __typename: 'Bot', login: 'dependabot', databaseId: 49699333 },
          reviewDecision: 'APPROVED',
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        }),
        listed({
          id: 'PR_kwDO9',
          number: 9,
          state: 'MERGED',
          isDraft: false,
          reviewDecision: 'REVIEW_REQUIRED',
          author: null,
          commits: { nodes: [] },
        }),
        // An issue the search found: none of a pull request's fields, so it is left out.
        {},
      ],
    },
  },
}

describe('GitHub listing pull requests', () => {
  it('asks its search for the repository’s pull requests, narrowed as asked, each word quoted', () => {
    assert.strictEqual(searchOf(['meridian', 'api'], { state: 'open', limit: 30 }), 'repo:meridian/api is:pr is:open sort:updated-desc')
    assert.strictEqual(
      searchOf(['meridian', 'api'], {
        state: 'closed',
        author: '@ninemate',
        text: 'send "back',
        reviewRequested: true,
        draft: false,
        limit: 5,
      }),
      'repo:meridian/api is:pr is:closed is:unmerged author:ninemate review-requested:@me draft:false "send" "back" in:title sort:updated-desc',
    )
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'merged', author: 'dependabot[bot]', limit: 5 }),
      'repo:meridian/api is:pr is:merged author:app/dependabot sort:updated-desc',
    )
    // Reading on past a listing: those updated at or before the last it gave, to the second, as search reads times.
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'open', draft: false, updatedUntil: '2026-10-21T08:00:05.123Z', limit: 100 }),
      'repo:meridian/api is:pr is:open draft:false updated:<=2026-10-21T08:00:05Z sort:updated-desc',
    )
    // A qualifier in the words is only a word.
    assert.strictEqual(
      searchOf(['meridian', 'api'], { state: 'all', text: 'repo:other/x', limit: 5 }),
      'repo:meridian/api is:pr "repo:other/x" in:title sort:updated-desc',
    )
    // No login could be that: nothing is asked.
    assert.isUndefined(searchOf(['meridian', 'api'], { state: 'open', author: 'a b repo:x', limit: 5 }))
  })

  it.effect('lists them in one call, with their reviews, checks and forks, and says there are more', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${API}/graphql`, { json: SEARCHED }]])
      const list = yield* host.listChanges(repository, { state: 'all', author: 'ninemate', limit: 4 })
      assert.deepStrictEqual(variablesOf(sent[0]), { q: 'repo:meridian/api is:pr author:ninemate sort:updated-desc', n: 4 })
      assert.isTrue(list.more)
      assert.deepStrictEqual(
        list.changes.map((change) => [
          change.number,
          change.state,
          change.draft,
          change.author?.login,
          change.forkOwner,
          change.reviewDecision,
          change.checks,
        ]),
        [
          [12, 'open', true, 'you', null, null, 'running'],
          [13, 'open', false, 'ninemate', 'ninemate', 'changes_requested', 'failed'],
          [14, 'open', false, 'dependabot[bot]', null, 'approved', null],
          [9, 'merged', false, undefined, null, 'review_required', null],
        ],
      )
      assert.deepInclude(list.changes[1], {
        title: 'Send back won’t restart a dead lead',
        url: 'https://github.com/meridian/api/pull/13',
        source: 'send-back',
        target: 'main',
        body: '',
        updatedAt: '2026-10-13T09:00:00Z',
      })
      assert.isTrue(list.changes[2]?.author?.bot)
      // Asked for as many as it has, it says there are none more.
      const all = github([['POST', `${API}/graphql`, { json: { data: { search: { issueCount: 1, nodes: [listed()] } } } }]])
      assert.isFalse((yield* all.host.listChanges(repository, { state: 'open', limit: 500 })).more)
      assert.deepInclude(variablesOf(all.sent[0]), { n: 100 })
    }),
  )

  it.effect('answers the same search again within a minute from memory, and asks again after', () =>
    Effect.gen(function* () {
      const { host, sent } = github([['POST', `${API}/graphql`, { json: SEARCHED }]])
      const asked = { state: 'open', author: 'ninemate', limit: 30 } as const
      const first = yield* host.listChanges(repository, asked)
      yield* TestClock.adjust(Duration.millis(LISTING_KEPT_MS - 1))
      assert.deepStrictEqual(yield* host.listChanges(repository, asked), first)
      assert.lengthOf(sent, 1)
      // Narrowed otherwise, it is another search.
      yield* host.listChanges(repository, { ...asked, draft: true })
      assert.lengthOf(sent, 2)
      yield* TestClock.adjust(Duration.millis(1))
      yield* host.listChanges(repository, asked)
      assert.lengthOf(sent, 3)
    }),
  )

  it.effect('names the permission it lacks where GitHub refuses, and asks nothing for a login that can’t be one', () =>
    Effect.gen(function* () {
      const refusing = github([
        [
          'POST',
          `${API}/graphql`,
          {
            json: {
              data: null,
              errors: [
                { type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes to execute this query.' },
              ],
            },
          },
        ],
      ])
      const refused = yield* Effect.flip(refusing.host.listChanges(repository, { state: 'open', limit: 30 }))
      assert.deepInclude(refused, { reason: 'forbidden', scope: 'repo (a fine-grained token’s Pull requests: Read)' })
      const { host, sent } = github([])
      assert.deepInclude(yield* Effect.flip(host.listChanges(repository, { state: 'open', author: 'x y', limit: 30 })), {
        reason: 'rejected',
      })
      assert.lengthOf(sent, 0)
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

  describe('changing an issue', () => {
    const open: Issue = {
      id: '900',
      ref: 'meridian/api#12',
      key: '#12',
      title: 'Refunds ignore the rate limit',
      body: '',
      url: 'https://github.com/meridian/api/issues/12',
      status: { name: 'Open', category: 'todo' },
      priority: null,
      assignees: [],
      labels: ['bug'],
      container: 'meridian/api',
      updatedAt: '2026-10-01T08:00:00Z',
    }

    it('changes all but a priority, which GitHub’s issues haven’t', () => {
      assert.deepStrictEqual(github([]).host.capabilities.changes, ['status', 'close', 'assignee', 'labels', 'project', 'title'])
    })

    it.effect('offers open and closed, the repository’s labels, its people and its open milestones, page after page', () =>
      Effect.gen(function* () {
        const labels = Array.from({ length: 100 }, (_, index) => ({ name: `label-${index}` }))
        const { host } = github([
          ['GET', `${REPO}/labels?per_page=100&page=1`, { json: labels }],
          ['GET', `${REPO}/labels?per_page=100&page=2`, { json: [{ name: 'payments' }] }],
          [
            'GET',
            `${REPO}/assignees?per_page=100&page=1`,
            {
              json: [
                { id: 5, login: 'you', name: 'You Person' },
                { id: 6, login: 'sam' },
              ],
            },
          ],
          ['GET', `${REPO}/milestones?state=open&per_page=100&page=1`, { json: [{ number: 3, title: 'Q4 launch' }] }],
        ])
        assert.deepStrictEqual(
          (yield* host.choices(open, 'status')).map((one) => one.name),
          ['Open', 'Closed', 'Closed as not planned'],
        )
        assert.lengthOf(yield* host.choices(open, 'labels'), 101)
        assert.deepStrictEqual(yield* host.choices(open, 'assignee'), [
          { id: 'you', name: 'You Person', also: ['you'] },
          { id: 'sam', name: 'sam', also: ['sam'] },
        ])
        assert.deepStrictEqual(yield* host.choices(open, 'project'), [{ id: '3', name: 'Q4 launch' }])
      }),
    )

    it.effect('edits its title, state, assignee and milestone at once, adds and takes off labels, and reads it back', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['PATCH', `${REPO}/issues/12`, { json: issue() }],
          ['POST', `${REPO}/issues/12/labels`, { json: [] }],
          ['DELETE', `${REPO}/issues/12/labels/needs%20triage`, { status: 404, json: { message: 'Label does not exist' } }],
          ['GET', `${REPO}/issues/12`, { json: issue({ state: 'closed', state_reason: 'not_planned' }) }],
        ])
        const changed = yield* host.update(open, {
          title: 'Refunds, rate-limited',
          status: { id: 'not_planned', name: 'Closed as not planned' },
          assignee: { id: 'sam', name: 'sam' },
          project: { id: '3', name: 'Q4 launch' },
          labels: { add: [{ id: 'payments', name: 'payments' }], remove: [{ id: 'needs triage', name: 'needs triage' }] },
        })
        assert.strictEqual(changed.status.category, 'cancelled')
        assert.deepStrictEqual(sent[0]?.body, {
          title: 'Refunds, rate-limited',
          state: 'closed',
          state_reason: 'not_planned',
          assignees: ['sam'],
          milestone: 3,
        })
        assert.deepStrictEqual(sent[1]?.body, { labels: ['payments'] })
      }),
    )

    it.effect('closes it as done, takes its assignees and milestone off, and refuses a priority before asking anything', () =>
      Effect.gen(function* () {
        const { host, sent } = github([
          ['PATCH', `${REPO}/issues/12`, { json: issue() }],
          ['GET', `${REPO}/issues/12`, { json: issue({ state: 'closed', state_reason: 'completed' }) }],
        ])
        yield* host.update(open, { close: true, assignee: null, project: null })
        assert.deepStrictEqual(sent[0]?.body, { state: 'closed', state_reason: 'completed', assignees: [], milestone: null })
        const reopening = github([
          ['PATCH', `${REPO}/issues/12`, { json: issue() }],
          ['GET', `${REPO}/issues/12`, { json: issue() }],
        ])
        yield* reopening.host.update(open, { status: { id: 'open', name: 'Open' } })
        assert.deepStrictEqual(reopening.sent[0]?.body, { state: 'open' })
        const refusing = github([])
        assert.strictEqual((yield* Effect.flip(refusing.host.update(open, { priority: 'low' }))).reason, 'rejected')
        assert.lengthOf(refusing.sent, 0)
      }),
    )
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
      // An issue has no In Progress of its own: it is left open, as it is.
      assert.deepStrictEqual(yield* host.start(found), { moved: false, status: { name: 'Open', category: 'todo' } })
      assert.lengthOf(sent, 1)
      assert.isFalse(host.capabilities.links)
      assert.isFalse(host.capabilities.starts)
    }),
  )
  it.effect('lists the repositories it can file issues in, last pushed first, leaving out the archived and those without issues', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'GET',
          `${API}/user/repos?per_page=100&sort=pushed&page=1`,
          {
            json: [
              { id: 7, full_name: 'meridian/api', has_issues: true, archived: false },
              { id: 8, full_name: 'meridian/old', has_issues: true, archived: true },
              { id: 9, full_name: 'meridian/docs', has_issues: false, archived: false },
              { id: 10, full_name: 'you/dotfiles' },
            ],
          },
        ],
      ])
      assert.deepStrictEqual(yield* host.containers(), [
        { id: 'meridian/api', key: 'meridian/api', name: 'meridian/api' },
        { id: 'you/dotfiles', key: 'you/dotfiles', name: 'you/dotfiles' },
      ])
      assert.lengthOf(sent, 1)
    }),
  )

  it.effect('follows the repositories page after page until a page comes short, and stops at ten', () =>
    Effect.gen(function* () {
      const repositories = (page: number, count: number) =>
        Array.from({ length: count }, (_, at) => ({ id: page * 100 + at, full_name: `meridian/repo-${page}-${at}` }))
      const listed = `${API}/user/repos?per_page=100&sort=pushed&page=`
      const { host, sent } = github([
        ['GET', `${listed}1`, { json: repositories(1, 100) }],
        ['GET', `${listed}2`, { json: repositories(2, 3) }],
      ])
      const found = yield* host.containers()
      assert.lengthOf(found, 103)
      assert.strictEqual(found.at(-1)?.id, 'meridian/repo-2-2')
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [`${listed}1`, `${listed}2`],
      )
      // Every page full: ten are read, and no more.
      const endless = github([['GET', /\/user\/repos\?per_page=100&sort=pushed&page=\d+$/, { json: repositories(0, 100) }]])
      assert.lengthOf(yield* endless.host.containers(), 1000)
      assert.lengthOf(endless.sent, 10)
    }),
  )

  it.effect('files an issue in a repository, with its labels as they are, or none', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['POST', `${REPO}/issues`, { status: 201, json: issue({ assignees: [], labels: [{ name: 'payments' }] }) }],
      ])
      const filed = yield* host.create('meridian/api', {
        title: 'Refunds ignore the rate limit',
        body: 'They should not.',
        labels: ['payments'],
      })
      assert.deepStrictEqual([filed.ref, filed.labels, filed.container], ['meridian/api#12', ['payments'], 'meridian/api'])
      assert.deepStrictEqual(sent[0]?.body, { title: 'Refunds ignore the rate limit', body: 'They should not.', labels: ['payments'] })
      yield* host.create('meridian/api', { title: 'Refunds ignore the rate limit', body: '', labels: [] })
      assert.deepStrictEqual(sent[1]?.body, { title: 'Refunds ignore the rate limit', body: '' })
    }),
  )

  it.effect('says what it was given isn’t a repository, without asking', () =>
    Effect.gen(function* () {
      const { host, sent } = github([])
      for (const container of ['meridian', 'meridian/api/web', 'meridian/api#12', 'MER'])
        assert.deepStrictEqual(
          (yield* Effect.flip(host.create(container, { title: 't', body: '', labels: [] }))).message,
          `Not a GitHub repository: ${container}`,
        )
      assert.lengthOf(sent, 0)
    }),
  )
})
