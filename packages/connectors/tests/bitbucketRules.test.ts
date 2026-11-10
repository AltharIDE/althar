import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeBitbucketCloud } from '../src/bitbucketCloud'
import { makeBitbucketDataCenter } from '../src/bitbucketDataCenter'
import { cloudRulesOf, dataCenterRulesOf, globTakes } from '../src/bitbucketRules'
import type { ChangeRequest, Repository } from '../src/model'
import { type Route, stubFetch } from './stub'

const CLOUD = 'https://api.bitbucket.org/2.0'
const ACE = `${CLOUD}/repositories/atlassian/ace`
const ace: Repository = {
  id: '{47b1}',
  path: ['atlassian', 'ace'],
  defaultBranch: 'master',
  webUrl: 'https://bitbucket.org/atlassian/ace',
  canPush: true,
  merges: ['merge', 'squash'],
}

const SERVER = 'https://git.meridian.dev'
const DC = `${SERVER}/rest/api/latest`
const PULL = `${DC}/projects/PRJ/repos/my-repo/pull-requests/101`
const prj: Repository = { ...ace, id: '1', path: ['PRJ', 'my-repo'], webUrl: `${SERVER}/projects/PRJ/repos/my-repo` }

const change = (number: number): ChangeRequest => ({
  id: String(number),
  number,
  title: 'Add settings',
  body: '',
  url: `https://bitbucket.org/atlassian/ace/pull-requests/${number}`,
  state: 'open',
  draft: false,
  source: 'feature/settings',
  target: 'master',
  headSha: '7f9d4e6279c8',
  author: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  updatedAt: '2025-08-22T07:42:42Z',
})

const fetching = (routes: ReadonlyArray<Route>) => stubFetch(routes).fetch

const participant = (nickname: string, role: string, approved: boolean, state: string | null = null) => ({
  user: { nickname, display_name: nickname },
  role,
  approved,
  state,
})

describe('What Bitbucket Cloud needs before a pull request merges', () => {
  it.effect('its branch restrictions read: two approvals, one given and one asked, passing builds, no changes asked for', () =>
    Effect.gen(function* () {
      const host = makeBitbucketCloud({
        fetch: fetching([
          [
            'GET',
            `${ACE}/pullrequests/552`,
            { json: { participants: [participant('ana', 'REVIEWER', true), participant('ben', 'REVIEWER', false)] } },
          ],
          [
            'GET',
            `${ACE}/branch-restrictions?pagelen=100`,
            {
              json: {
                values: [
                  { kind: 'require_approvals_to_merge', pattern: 'master', branch_match_kind: 'glob', value: 2 },
                  { kind: 'require_passing_builds_to_merge', pattern: 'mas*', branch_match_kind: 'glob', value: 1 },
                  { kind: 'require_no_changes_requested', pattern: 'release/*', branch_match_kind: 'glob' },
                  { kind: 'require_approvals_to_merge', branch_match_kind: 'branching_model', value: 5 },
                ],
              },
            },
          ],
        ]),
        apiUrl: CLOUD,
        webUrl: 'https://bitbucket.org',
        credential: Effect.succeed({ kind: 'bearer', token: 'ATCTT3x' }),
      })
      assert.deepStrictEqual(yield* host.mergeRules!(ace, change(552)), {
        requiredChecks: 'all',
        needs: [
          { kind: 'approvals', state: 'waiting', have: 1, need: 2, who: ['ben'] },
          { kind: 'changes_requested', state: 'met' },
        ],
      })
    }),
  )

  it.effect('restrictions only an admin may list leave how many approvals and which builds it needs unknown, never met', () =>
    Effect.gen(function* () {
      const host = makeBitbucketCloud({
        fetch: fetching([
          [
            'GET',
            `${ACE}/pullrequests/552`,
            {
              json: { participants: [participant('ana', 'REVIEWER', true), participant('cy', 'PARTICIPANT', false, 'changes_requested')] },
            },
          ],
          ['GET', `${ACE}/branch-restrictions?pagelen=100`, { status: 403, json: { type: 'error', error: { message: 'Forbidden' } } }],
        ]),
        apiUrl: CLOUD,
        webUrl: 'https://bitbucket.org',
        credential: Effect.succeed({ kind: 'bearer', token: 'ATCTT3x' }),
      })
      assert.deepStrictEqual(yield* host.mergeRules!(ace, change(552)), {
        requiredChecks: null,
        needs: [
          { kind: 'approvals', state: 'unknown', have: 1, who: ['ana'] },
          { kind: 'changes_requested', state: 'unknown', who: ['cy'] },
        ],
      })
    }),
  )

  it('approvals met, and how far behind it may be, which Bitbucket says only as it refuses, unknown', () => {
    assert.deepStrictEqual(
      cloudRulesOf({
        target: 'master',
        pull: { participants: [participant('ana', 'REVIEWER', true)] },
        restrictions: {
          values: [
            { kind: 'require_approvals_to_merge', pattern: '*', value: 1 },
            { kind: 'require_commits_behind', pattern: 'master', value: 0 },
          ],
        },
      }),
      {
        requiredChecks: [],
        needs: [
          { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ana'] },
          { kind: 'changes_requested', state: 'met' },
          { kind: 'up_to_date', state: 'unknown' },
        ],
      },
    )
    assert.isTrue(globTakes('release/*', 'release/1.2'))
    assert.isFalse(globTakes('release/*', 'main'))
    assert.isTrue(globTakes('v1.0+', 'v1.0+'))
  })
})

describe('What Bitbucket Data Center needs before a pull request merges', () => {
  it.effect('its merge checks’ vetoes: approvals and builds are their lines, the rest said in its words', () =>
    Effect.gen(function* () {
      const host = makeBitbucketDataCenter({
        fetch: fetching([
          [
            'GET',
            PULL,
            {
              json: {
                id: 101,
                version: 3,
                title: 'Add settings',
                state: 'OPEN',
                fromRef: { id: 'refs/heads/f', displayId: 'f', repository: { slug: 'my-repo', project: { key: 'PRJ' } } },
                toRef: { id: 'refs/heads/master', displayId: 'master', repository: { slug: 'my-repo', project: { key: 'PRJ' } } },
                reviewers: [
                  { user: { id: 1, name: 'jcitizen' }, status: 'APPROVED' },
                  { user: { id: 2, name: 'tom' }, status: 'UNAPPROVED' },
                ],
                updatedDate: 1_700_000_000_000,
              },
            },
          ],
          [
            'GET',
            `${PULL}/merge`,
            {
              json: {
                canMerge: false,
                vetoes: [
                  { summaryMessage: 'Requires approvals', detailedMessage: 'You need 2 approvals' },
                  { summaryMessage: 'Not all required builds are successful yet' },
                  { summaryMessage: 'Has open tasks' },
                ],
              },
            },
          ],
        ]),
        apiUrl: `${DC}/`,
        webUrl: `${SERVER}/`,
        credential: Effect.succeed({ kind: 'bearer', token: 'BBDC-t' }),
      })
      assert.deepStrictEqual(yield* host.mergeRules!(prj, change(101)), {
        requiredChecks: 'all',
        needs: [
          { kind: 'approvals', state: 'waiting', have: 1, who: ['tom'] },
          { kind: 'changes_requested', state: 'met' },
          { kind: 'other', state: 'unmet', said: 'Has open tasks' },
        ],
      })
    }),
  )

  it('work asked for is crossed; with nothing vetoed, approvals are met and whether builds are required unknown', () => {
    assert.deepStrictEqual(
      dataCenterRulesOf({
        reviewers: [{ user: { name: 'tom' }, status: 'NEEDS_WORK' }],
        merge: { canMerge: false, vetoes: [{ detailedMessage: 'A reviewer says it needs work' }] },
      }).needs,
      [
        { kind: 'approvals', state: 'unknown', have: 0, who: [] },
        { kind: 'changes_requested', state: 'unmet', who: ['tom'] },
      ],
    )
    assert.deepStrictEqual(
      dataCenterRulesOf({ reviewers: [{ user: { name: 'jcitizen' }, status: 'APPROVED' }], merge: { canMerge: true } }),
      {
        requiredChecks: null,
        needs: [
          { kind: 'approvals', state: 'met', have: 1, who: ['jcitizen'] },
          { kind: 'changes_requested', state: 'met' },
        ],
      },
    )
    assert.deepStrictEqual(
      dataCenterRulesOf({ reviewers: [], merge: { canMerge: false, vetoes: [{ summaryMessage: 'Requires approvals' }] } }).needs,
      [{ kind: 'approvals', state: 'unmet', have: 0, who: [] }],
    )
    // Work asked for that no merge check vetoes doesn't hold it back: no line, and never "no changes requested".
    assert.deepStrictEqual(
      dataCenterRulesOf({ reviewers: [{ user: { name: 'tom' }, status: 'NEEDS_WORK' }], merge: { canMerge: true } }).needs,
      [{ kind: 'approvals', state: 'met', have: 0, who: [] }],
    )
  })
})
