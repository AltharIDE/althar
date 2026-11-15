import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeGitHub } from '../src/github'
import { mergeRulesOf, NO_RULESETS, type PullRules, rulesetsOf } from '../src/githubRules'
import type { ChangeRequest, Repository } from '../src/model'
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

const change: ChangeRequest = {
  id: 'PR_1',
  number: 12,
  title: 'Rate-limit refunds',
  body: '',
  url: 'https://github.com/meridian/api/pull/12',
  state: 'open',
  draft: false,
  source: 'althar/mer-231',
  target: 'main',
  headSha: 'abc',
  author: null,
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  updatedAt: '2026-10-01T09:00:00Z',
}

const github = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitHub({ fetch, apiUrl: API, webUrl: 'https://github.com', credential: Effect.succeed({ kind: 'bearer', token: 'ghu_t' }) }),
    sent,
  }
}

/** A pull request as the merge rules query answers it: nothing required, nothing asked, by default. */
const rules = (overrides: Partial<Record<keyof PullRules, unknown>> = {}) => ({
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  reviewDecision: null,
  isMergeQueueEnabled: false,
  isInMergeQueue: false,
  baseRef: { refUpdateRule: null },
  reviewRequests: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  reviewThreads: { totalCount: 0, nodes: [] },
  commits: { totalCount: 1, nodes: [{ commit: { signature: null } }] },
  head: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] },
  ...overrides,
})

const answered = (pull: unknown) => ({ json: { data: { repository: { pullRequest: pull } } } })

const protection = (overrides: Record<string, unknown> = {}) => ({
  refUpdateRule: {
    requiredApprovingReviewCount: 1,
    requiredStatusCheckContexts: ['test'],
    requiresCodeOwnerReviews: false,
    requiresConversationResolution: false,
    requiresLinearHistory: false,
    requiresSignatures: false,
    ...overrides,
  },
})

const contexts = (...nodes: ReadonlyArray<Record<string, unknown>>) => ({
  nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }],
})

describe('What GitHub needs before a pull request merges', () => {
  it.effect('offers queue bypass only when GitHub explicitly allows it for this viewer', () =>
    Effect.gen(function* () {
      for (const allowed of [true, false, undefined]) {
        const { host, sent } = github([
          [
            'POST',
            `${API}/graphql`,
            answered(rules({ isMergeQueueEnabled: true, ...(allowed === undefined ? {} : { viewerCanMergeAsAdmin: allowed }) })),
          ],
          ['GET', `${REPO}/rules/branches/main`, { json: [] }],
        ])
        assert.strictEqual((yield* host.mergeRules!(repository, change)).canBypassQueue, allowed)
        assert.include(JSON.stringify(sent[0]?.body), 'viewerCanMergeAsAdmin')
      }
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ viewerCanMergeAsAdmin: true }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
      ])
      assert.isUndefined((yield* host.mergeRules!(repository, change)).canBypassQueue)
    }),
  )
  it.effect('a missing approval, a required check still running and a branch behind its target, each said', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'POST',
          `${API}/graphql`,
          answered(
            rules({
              mergeStateStatus: 'BLOCKED',
              reviewDecision: 'REVIEW_REQUIRED',
              baseRef: protection(),
              head: contexts(
                { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null, isRequired: true },
                { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', isRequired: false },
              ),
            }),
          ),
        ],
        [
          'GET',
          `${REPO}/rules/branches/main`,
          {
            json: [
              { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [] } },
            ],
          },
        ],
        ['GET', `${REPO}/compare/main...abc`, { json: { behind_by: 3 } }],
      ])
      const read = yield* host.mergeRules!(repository, change)
      assert.deepStrictEqual(read, {
        requiredChecks: ['test'],
        needs: [
          { kind: 'approvals', state: 'unmet', have: 0, need: 1, who: [] },
          { kind: 'changes_requested', state: 'met' },
          { kind: 'up_to_date', state: 'unmet', have: 3 },
        ],
      })
      assert.deepStrictEqual(variablesOf(sent[0]), { owner: 'meridian', name: 'api', number: 12 })
      // Its rulesets said it must be up to date: the admin-only protection isn't asked.
      assert.isFalse(sent.some((one) => one.url.includes('/protection/')))
    }),
  )

  it.effect('a review asked of someone is waited on; their approval meets it, a code owner’s still waited on', () =>
    Effect.gen(function* () {
      const asked = github([
        [
          'POST',
          `${API}/graphql`,
          answered(
            rules({
              mergeStateStatus: 'BLOCKED',
              reviewDecision: 'REVIEW_REQUIRED',
              baseRef: protection({ requiredApprovingReviewCount: 2, requiresCodeOwnerReviews: true, requiredStatusCheckContexts: [] }),
              reviewRequests: {
                nodes: [
                  { asCodeOwner: false, requestedReviewer: { __typename: 'User', login: 'ana' } },
                  { asCodeOwner: true, requestedReviewer: { __typename: 'Team', combinedSlug: 'meridian/payments' } },
                ],
              },
              latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'ben' } }] },
            }),
          ),
        ],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
      ])
      assert.deepStrictEqual((yield* asked.host.mergeRules!(repository, change)).needs, [
        { kind: 'approvals', state: 'waiting', have: 1, need: 2, who: ['ana', 'meridian/payments'] },
        { kind: 'code_owners', state: 'waiting', who: ['meridian/payments'] },
        { kind: 'changes_requested', state: 'met' },
      ])
      // No required checks under classic protection: whether it must be up to date doesn't come into it.
      assert.isFalse(asked.sent.some((one) => one.url.includes('/compare/') || one.url.includes('/protection/')))
    }),
  )

  it.effect('changes asked for, unresolved conversations and unsigned commits are crossed', () =>
    Effect.gen(function* () {
      const { host } = github([
        [
          'POST',
          `${API}/graphql`,
          answered(
            rules({
              mergeStateStatus: 'BLOCKED',
              reviewDecision: 'CHANGES_REQUESTED',
              baseRef: protection({
                requiredStatusCheckContexts: [],
                requiresConversationResolution: true,
                requiresSignatures: true,
                requiresLinearHistory: true,
              }),
              latestOpinionatedReviews: {
                nodes: [
                  { state: 'APPROVED', author: { login: 'ben' } },
                  { state: 'CHANGES_REQUESTED', author: { login: 'cy' } },
                ],
              },
              reviewThreads: { totalCount: 3, nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
              commits: {
                totalCount: 2,
                nodes: [{ commit: { signature: { isValid: true } } }, { commit: { signature: null } }],
              },
            }),
          ),
        ],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
      ])
      assert.deepStrictEqual((yield* host.mergeRules!(repository, change)).needs, [
        { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ben'] },
        { kind: 'changes_requested', state: 'unmet', who: ['cy'] },
        { kind: 'conversations', state: 'unmet', have: 1, need: 3 },
        { kind: 'signatures', state: 'unmet', have: 1 },
        { kind: 'linear_history', state: 'met' },
      ])
    }),
  )

  it.effect('whether it must be up to date, which only an admin may read, is unknown to anyone else; never met', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        ['POST', `${API}/graphql`, answered(rules({ mergeStateStatus: 'BLOCKED', reviewDecision: 'APPROVED', baseRef: protection() }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
        ['GET', `${REPO}/branches/main/protection/required_status_checks`, { status: 404, json: { message: 'Not Found' } }],
        ['GET', `${REPO}/compare/main...abc`, { json: { behind_by: 2 } }],
      ])
      const read = yield* host.mergeRules!(repository, change)
      assert.deepStrictEqual(
        read.needs.find((one) => one.kind === 'up_to_date'),
        { kind: 'up_to_date', state: 'unknown', have: 2 },
      )
      // Read once an hour: asked again, the protection isn't.
      yield* host.mergeRules!(repository, change)
      assert.strictEqual(sent.filter((one) => one.url.endsWith('/protection/required_status_checks')).length, 1)
    }),
  )

  it.effect('an admin hears the branch must be up to date: up to date, it is met', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ reviewDecision: 'APPROVED', baseRef: protection() }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
        ['GET', `${REPO}/branches/main/protection/required_status_checks`, { json: { strict: true, contexts: ['test'] } }],
        ['GET', `${REPO}/compare/main...abc`, { json: { behind_by: 0 } }],
      ])
      const read = yield* host.mergeRules!(repository, change)
      assert.deepStrictEqual(
        read.needs.find((one) => one.kind === 'up_to_date'),
        { kind: 'up_to_date', state: 'met' },
      )
    }),
  )

  it.effect('a branch nothing protects requires no check, and only what GitHub calls required counts', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ mergeStateStatus: 'UNSTABLE' }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
      ])
      assert.deepStrictEqual(yield* host.mergeRules!(repository, change), { requiredChecks: [], needs: [] })
    }),
  )

  it.effect('blocked for a rule Althar can’t read, it says something else holds it back', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ mergeStateStatus: 'BLOCKED' }))],
        ['GET', `${REPO}/rules/branches/main`, { status: 403, json: { message: 'Forbidden' } }],
      ])
      assert.deepStrictEqual((yield* host.mergeRules!(repository, change)).needs, [{ kind: 'other', state: 'unmet' }])
    }),
  )

  it.effect('through a merge queue: met, and waiting once in it', () =>
    Effect.gen(function* () {
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ mergeStateStatus: 'BLOCKED', isMergeQueueEnabled: true, isInMergeQueue: true }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }] }],
      ])
      assert.deepStrictEqual((yield* host.mergeRules!(repository, change)).needs, [{ kind: 'merge_queue', state: 'waiting' }])
    }),
  )

  it.effect('an Enterprise Server that doesn’t know refUpdateRule is asked without it, from then on', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'POST',
          `${API}/graphql`,
          (request) =>
            String((request.body as { query: string }).query).includes('refUpdateRule')
              ? { json: { errors: [{ message: "Field 'refUpdateRule' doesn't exist on type 'Ref'" }] } }
              : answered(rules({ baseRef: undefined })),
        ],
        ['GET', `${REPO}/rules/branches/main`, { status: 404, json: { message: 'Not Found' } }],
        ['GET', `${REPO}/branches/main/protection/required_status_checks`, { status: 404, json: { message: 'Branch not protected' } }],
      ])
      assert.deepStrictEqual(yield* host.mergeRules!(repository, change), { requiredChecks: [], needs: [] })
      yield* host.mergeRules!(repository, change)
      assert.strictEqual(sent.filter((one) => one.method === 'POST').length, 3)
    }),
  )

  it.effect('a passing failure reading whether it must be up to date is asked again next time, not kept an hour', () =>
    Effect.gen(function* () {
      let tries = 0
      const { host } = github([
        ['POST', `${API}/graphql`, answered(rules({ baseRef: protection({ requiredStatusCheckContexts: ['test'] }) }))],
        ['GET', `${REPO}/rules/branches/main`, { json: [] }],
        [
          'GET',
          `${REPO}/branches/main/protection/required_status_checks`,
          () => (++tries === 1 ? { status: 502, json: { message: 'Bad Gateway' } } : { json: { strict: true } }),
        ],
        ['GET', `${REPO}/compare/main...abc`, { json: { behind_by: 2 } }],
      ])
      yield* host.mergeRules!(repository, change)
      const again = yield* host.mergeRules!(repository, change)
      assert.strictEqual(tries, 2)
      assert.deepInclude(again.needs, { kind: 'up_to_date', state: 'unmet', have: 2 })
    }),
  )

  it.effect('one that doesn’t know the merge queue or required checks is asked without them too', () =>
    Effect.gen(function* () {
      const { host, sent } = github([
        [
          'POST',
          `${API}/graphql`,
          (request) =>
            String((request.body as { query: string }).query).includes('isMergeQueueEnabled')
              ? { json: { errors: [{ message: "Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest'" }] } }
              : answered(rules({ baseRef: undefined })),
        ],
        ['GET', `${REPO}/rules/branches/main`, { status: 404, json: { message: 'Not Found' } }],
        ['GET', `${REPO}/branches/main/protection/required_status_checks`, { status: 404, json: { message: 'Branch not protected' } }],
      ])
      assert.deepStrictEqual(yield* host.mergeRules!(repository, change), { requiredChecks: [], needs: [] })
      const queries = sent.filter((one) => one.method === 'POST').map((one) => String((one.body as { query: string }).query))
      assert.isFalse(/isRequired|refUpdateRule|isMergeQueueEnabled/.test(queries.at(-1) ?? ''))
    }),
  )

  it.effect('a pull request GitHub doesn’t have is not found', () =>
    Effect.gen(function* () {
      const { host } = github([['POST', `${API}/graphql`, { json: { data: { repository: { pullRequest: null } } } }]])
      const failed = yield* Effect.flip(host.mergeRules!(repository, change))
      assert.strictEqual(failed.reason, 'not_found')
    }),
  )
})

describe('What a branch’s rulesets require', () => {
  it('together: the most approvals any asks, every check any names, and the rest any requires', () => {
    assert.deepStrictEqual(
      rulesetsOf([
        { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true } },
        { type: 'pull_request', parameters: { required_approving_review_count: 2, required_review_thread_resolution: true } },
        {
          type: 'required_status_checks',
          parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'test' }, { nope: 1 }] },
        },
        { type: 'required_signatures' },
        { type: 'required_linear_history', parameters: null },
        { type: 'merge_queue', parameters: {} },
        { type: 'deletion' },
      ]),
      {
        approvals: 2,
        codeOwners: true,
        conversations: true,
        checks: ['test'],
        strict: false,
        signatures: true,
        linear: true,
        queue: true,
      },
    )
    assert.deepStrictEqual(rulesetsOf([]), NO_RULESETS)
  })

  it('past the threads and commits read, one not read may be open or unsigned: unknown, not met', () => {
    const pull = rules({
      baseRef: protection({ requiredApprovingReviewCount: 0, requiresConversationResolution: true, requiresSignatures: true }),
      reviewThreads: { totalCount: 120, nodes: [{ isResolved: true }] },
      commits: { totalCount: 150, nodes: [{ commit: { signature: { isValid: true } } }] },
    }) as unknown as PullRules
    assert.deepStrictEqual(mergeRulesOf({ pull, rulesets: NO_RULESETS, behind: null, strict: false, merges: ['merge'] }).needs, [
      { kind: 'conversations', state: 'unknown', have: 1, need: 120 },
      { kind: 'signatures', state: 'unknown', have: 0 },
    ])
  })

  it('changes asked for where no review is required don’t hold it back, and a rule unknown doesn’t explain a block', () => {
    const pull = rules({
      mergeStateStatus: 'BLOCKED',
      reviewDecision: null,
      baseRef: protection({ requiredApprovingReviewCount: 0, requiredStatusCheckContexts: [] }),
      latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'cy' } }] },
    }) as unknown as PullRules
    assert.deepStrictEqual(mergeRulesOf({ pull, rulesets: NO_RULESETS, behind: null, strict: null, merges: ['squash'] }).needs, [
      { kind: 'up_to_date', state: 'unknown' },
      { kind: 'other', state: 'unmet' },
    ])
  })

  it('linear history where Althar sees only merge commits allowed is not known; approved by enough and still a review short, a code owner’s is', () => {
    const pull = rules({
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      baseRef: protection({ requiresLinearHistory: true, requiresCodeOwnerReviews: true, requiredStatusCheckContexts: [] }),
      latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'ben' } }, null] },
    }) as unknown as PullRules
    assert.deepStrictEqual(mergeRulesOf({ pull, rulesets: NO_RULESETS, behind: null, strict: false, merges: ['merge'] }).needs, [
      { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ben'] },
      { kind: 'code_owners', state: 'unmet' },
      { kind: 'changes_requested', state: 'met' },
      { kind: 'linear_history', state: 'unknown' },
    ])
  })
})
