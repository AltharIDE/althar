import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeGitLab } from '../src/gitlab'
import { gitlabRulesOf } from '../src/gitlabRules'
import type { ChangeRequest, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

const API = 'https://gitlab.com/api/v4'
const PROJECT = `${API}/projects/34675721`
const MR = `${PROJECT}/merge_requests/12`
const repository: Repository = {
  id: '34675721',
  path: ['meridian', 'payments', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://gitlab.com/meridian/payments/api',
  canPush: true,
  merges: ['squash', 'merge'],
}

const change: ChangeRequest = {
  id: '544266512',
  number: 12,
  title: 'Rate-limit refunds',
  body: '',
  url: 'https://gitlab.com/meridian/payments/api/-/merge_requests/12',
  state: 'open',
  draft: false,
  source: 'althar/mer-231',
  target: 'main',
  headSha: 'a4f0330',
  author: null,
  additions: null,
  deletions: null,
  changedFiles: 3,
  updatedAt: '2026-10-07T16:41:00.548Z',
}

const gitlab = (routes: ReadonlyArray<Route>) => {
  const { fetch, sent } = stubFetch(routes)
  return {
    host: makeGitLab({
      fetch,
      apiUrl: `${API}/`,
      webUrl: 'https://gitlab.com/',
      credential: Effect.succeed({ kind: 'bearer', token: 't' }),
    }),
    sent,
  }
}

const reviewer = (username: string, state: string) => ({ user: { id: 1, username }, state })

describe('What GitLab needs before a merge request merges', () => {
  it.effect('a pipeline that must pass, approvals short, threads open and a fast-forward branch behind its target', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        [
          'GET',
          PROJECT,
          {
            json: {
              id: 34675721,
              only_allow_merge_if_pipeline_succeeds: true,
              only_allow_merge_if_all_discussions_are_resolved: true,
              merge_method: 'ff',
            },
          },
        ],
        [
          'GET',
          `${MR}?include_diverged_commits_count=true`,
          { json: { detailed_merge_status: 'not_approved', blocking_discussions_resolved: false, diverged_commits_count: 4 } },
        ],
        ['GET', `${MR}/approvals`, { json: { approvals_required: 2, approvals_left: 1, approved_by: [{ user: { username: 'ben' } }] } }],
        ['GET', `${MR}/approval_state`, { status: 403, json: { message: '403 Forbidden' } }],
        ['GET', `${MR}/reviewers`, { json: [reviewer('ben', 'approved'), reviewer('ana', 'unreviewed')] }],
      ])
      assert.deepStrictEqual(yield* host.mergeRules!(repository, change), {
        requiredChecks: 'all',
        needs: [
          { kind: 'approvals', state: 'waiting', have: 1, need: 2, who: ['ana'] },
          { kind: 'changes_requested', state: 'met' },
          { kind: 'conversations', state: 'unmet' },
          { kind: 'up_to_date', state: 'unmet', have: 4 },
        ],
      })
    }),
  )

  it.effect('a code owner’s rule waits on its approvers, changes asked for are crossed, a merge train is met', () =>
    Effect.gen(function* () {
      const { host } = gitlab([
        ['GET', PROJECT, { json: { id: 34675721, only_allow_merge_if_pipeline_succeeds: false, merge_trains_enabled: true } }],
        ['GET', `${MR}?include_diverged_commits_count=true`, { json: { detailed_merge_status: 'requested_changes' } }],
        ['GET', `${MR}/approvals`, { json: { approvals_required: 0, approvals_left: 0, approved_by: [] } }],
        [
          'GET',
          `${MR}/approval_state`,
          {
            json: {
              rules: [
                {
                  rule_type: 'code_owner',
                  name: 'docs',
                  approved: false,
                  approvals_required: 1,
                  eligible_approvers: [{ username: 'dee' }],
                },
                { rule_type: 'regular', approved: true, approvals_required: 1, eligible_approvers: [] },
              ],
            },
          },
        ],
        ['GET', `${MR}/reviewers`, { json: [reviewer('cy', 'requested_changes')] }],
      ])
      assert.deepStrictEqual(yield* host.mergeRules!(repository, change), {
        requiredChecks: [],
        needs: [
          { kind: 'code_owners', state: 'waiting', who: ['dee'] },
          { kind: 'changes_requested', state: 'unmet', who: ['cy'] },
          { kind: 'merge_queue', state: 'met' },
        ],
      })
    }),
  )

  it('what its status names that no line says is said in GitLab’s words; settings it can’t read leave its checks unknown', () => {
    assert.deepStrictEqual(
      gitlabRulesOf({
        project: {},
        request: { detailed_merge_status: 'merge_request_blocked' },
        approvals: null,
        state: null,
        reviewers: null,
      }),
      { requiredChecks: null, needs: [{ kind: 'other', state: 'unmet', said: 'Blocked by another merge request' }] },
    )
    assert.deepStrictEqual(
      gitlabRulesOf({
        project: { merge_method: 'rebase_merge', only_allow_merge_if_all_discussions_are_resolved: true },
        request: { detailed_merge_status: 'not_approved', diverged_commits_count: 0 },
        approvals: null,
        state: null,
        reviewers: null,
      }).needs,
      [
        { kind: 'approvals', state: 'unmet' },
        { kind: 'conversations', state: 'unknown' },
        { kind: 'up_to_date', state: 'met' },
      ],
    )
    assert.deepStrictEqual(
      gitlabRulesOf({
        project: { merge_method: 'ff', merge_trains_enabled: true },
        request: { detailed_merge_status: 'need_rebase', merge_when_pipeline_succeeds: true },
        approvals: { approvals_required: 1, approvals_left: 0, approved_by: [{ user: { username: 'ben' } }] },
        state: { rules: [{ rule_type: 'code_owner', approved: true, approvals_required: 1 }] },
        reviewers: [],
      }).needs,
      [
        { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ben'] },
        { kind: 'code_owners', state: 'met' },
        { kind: 'changes_requested', state: 'met' },
        { kind: 'up_to_date', state: 'unmet' },
        { kind: 'merge_queue', state: 'waiting' },
      ],
    )
    assert.deepStrictEqual(
      gitlabRulesOf({ project: {}, request: { detailed_merge_status: 'weird_new_status' }, approvals: null, state: null, reviewers: null })
        .needs,
      [{ kind: 'other', state: 'unmet', said: 'weird_new_status' }],
    )
  })
})
