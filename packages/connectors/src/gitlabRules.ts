import { Schema } from 'effect'

import type { HostNeed, MergeRules } from './model'

/*
 * What GitLab requires before a merge request merges (DEV-204): the
 * project's settings (a pipeline that must succeed, threads that must be
 * resolved, a merge method that needs the branch up to date, merge trains),
 * the merge request's approvals and, on Premium, its approval rules (a code
 * owner's among them), its reviewers' states, and its own merge status, which
 * names only the first thing in its way: whatever else it names is said in
 * GitLab's words.
 */

export const ProjectRules = Schema.Struct({
  only_allow_merge_if_pipeline_succeeds: Schema.optional(Schema.NullOr(Schema.Boolean)),
  only_allow_merge_if_all_discussions_are_resolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  merge_method: Schema.optional(Schema.NullOr(Schema.String)),
  merge_trains_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
})
export type ProjectRules = typeof ProjectRules.Type

export const RequestRules = Schema.Struct({
  detailed_merge_status: Schema.optional(Schema.String),
  blocking_discussions_resolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  // Asked for with `include_diverged_commits_count`.
  diverged_commits_count: Schema.optional(Schema.NullOr(Schema.Number)),
  merge_when_pipeline_succeeds: Schema.optional(Schema.NullOr(Schema.Boolean)),
})
export type RequestRules = typeof RequestRules.Type

const Username = Schema.Struct({ username: Schema.String })

export const ApprovalsAnswer = Schema.Struct({
  approvals_required: Schema.optional(Schema.NullOr(Schema.Number)),
  approvals_left: Schema.optional(Schema.NullOr(Schema.Number)),
  approved_by: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ user: Username })))),
})
export type ApprovalsAnswer = typeof ApprovalsAnswer.Type

/** Premium's approval rules; a code owner's among them, by its type. */
export const ApprovalStateAnswer = Schema.Struct({
  rules: Schema.Array(
    Schema.Struct({
      rule_type: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      approved: Schema.optional(Schema.Boolean),
      approvals_required: Schema.optional(Schema.NullOr(Schema.Number)),
      eligible_approvers: Schema.optional(Schema.NullOr(Schema.Array(Username))),
    }),
  ),
})
export type ApprovalStateAnswer = typeof ApprovalStateAnswer.Type

export const ReviewersAnswer = Schema.Array(Schema.Struct({ user: Username, state: Schema.optional(Schema.String) }))
export type ReviewersAnswer = typeof ReviewersAnswer.Type

/** Merge statuses another line says, or that hold nothing back: whatever else a status names is said in GitLab's words. */
const SAID_ELSEWHERE = new Set([
  'mergeable',
  'checking',
  'unchecked',
  'preparing',
  'approvals_syncing',
  'ci_must_pass',
  'ci_still_running',
  'conflict',
  'draft_status',
  'not_open',
  'not_approved',
  'requested_changes',
  'discussions_not_resolved',
  'need_rebase',
])

/** What GitLab says of a merge status no line says, in its own words where its documentation has them. */
const OTHER: Readonly<Record<string, string>> = {
  merge_request_blocked: 'Blocked by another merge request',
  jira_association_missing: 'The title or description must name a Jira issue',
  external_status_checks: 'External status checks must pass',
  locked_paths: 'Paths locked by others must be unlocked',
  locked_lfs_files: 'LFS files locked by others must be unlocked',
  security_policy_violations: 'Security policies must be satisfied',
  merge_time: 'Can’t merge before its set time',
  commits_status: 'Its source branch must exist and have commits',
  broken_status: 'Can’t merge because of a potential conflict',
}

/**
 * What a merge request needs to merge on GitLab, from its project's settings,
 * itself, its approvals, its approval rules (null where the tier has none, or
 * they couldn't be read) and its reviewers (null where they couldn't be read).
 */
export const gitlabRulesOf = (input: {
  readonly project: ProjectRules
  readonly request: RequestRules
  readonly approvals: ApprovalsAnswer | null
  readonly state: ApprovalStateAnswer | null
  readonly reviewers: ReviewersAnswer | null
}): MergeRules => {
  const { project, request, approvals } = input
  const status = request.detailed_merge_status ?? ''
  const needs: Array<HostNeed> = []
  const reviewers = input.reviewers ?? []
  const pending = reviewers.filter((one) => one.state === undefined || one.state === 'unreviewed').map((one) => one.user.username)
  const approvedBy = (approvals?.approved_by ?? []).map((one) => one.user.username)

  const required = approvals?.approvals_required ?? 0
  if (approvals === null && status === 'not_approved') needs.push({ kind: 'approvals', state: 'unmet' })
  else if (approvals !== null && (required > 0 || (approvals.approvals_left ?? 0) > 0 || status === 'not_approved')) {
    const met = (approvals.approvals_left ?? 0) === 0 && status !== 'not_approved'
    needs.push({
      kind: 'approvals',
      state: met ? 'met' : pending.length > 0 ? 'waiting' : 'unmet',
      have: approvedBy.length,
      ...(required > 0 ? { need: required } : {}),
      who: met || pending.length === 0 ? approvedBy : pending,
    })
  }

  const owners = (input.state?.rules ?? []).filter((rule) => rule.rule_type === 'code_owner' && (rule.approvals_required ?? 0) > 0)
  if (owners.length > 0) {
    const waiting = owners.filter((rule) => rule.approved !== true)
    needs.push(
      waiting.length === 0
        ? { kind: 'code_owners', state: 'met' }
        : {
            kind: 'code_owners',
            state: 'waiting',
            who: [...new Set(waiting.flatMap((rule) => (rule.eligible_approvers ?? []).map((one) => one.username)))],
          },
    )
  }

  const changesBy = reviewers.filter((one) => one.state === 'requested_changes').map((one) => one.user.username)
  // Changes asked for hold it back where GitLab says so; mergeable, they don't; held back for another reason, GitLab, which
  // says one at a time, doesn't say whether they do too.
  if (status === 'requested_changes')
    needs.push({ kind: 'changes_requested', state: 'unmet', ...(changesBy.length > 0 ? { who: changesBy } : {}) })
  else if (changesBy.length > 0) {
    if (status !== 'mergeable') needs.push({ kind: 'changes_requested', state: 'unknown', who: changesBy })
  } else if (input.reviewers !== null && (reviewers.length > 0 || needs.length > 0)) needs.push({ kind: 'changes_requested', state: 'met' })

  if (project.only_allow_merge_if_all_discussions_are_resolved === true || status === 'discussions_not_resolved') {
    const resolved = request.blocking_discussions_resolved
    needs.push({
      kind: 'conversations',
      state: status === 'discussions_not_resolved' || resolved === false ? 'unmet' : resolved === true ? 'met' : 'unknown',
    })
  }

  // Fast-forward and semi-linear merges need the branch on its target's head: GitLab says how far it has gone apart.
  if (project.merge_method === 'ff' || project.merge_method === 'rebase_merge' || status === 'need_rebase') {
    const diverged = request.diverged_commits_count
    needs.push(
      status === 'need_rebase' || (diverged ?? 0) > 0
        ? { kind: 'up_to_date', state: 'unmet', ...(diverged == null || diverged === 0 ? {} : { have: diverged }) }
        : { kind: 'up_to_date', state: diverged === 0 ? 'met' : 'unknown' },
    )
  }

  if (project.merge_trains_enabled === true)
    needs.push({ kind: 'merge_queue', state: request.merge_when_pipeline_succeeds === true ? 'waiting' : 'met' })

  if (status !== '' && !SAID_ELSEWHERE.has(status)) needs.push({ kind: 'other', state: 'unmet', said: OTHER[status] ?? status })

  return {
    // A pipeline that must succeed holds every job to it, less those allowed to fail; without, none is required.
    requiredChecks:
      project.only_allow_merge_if_pipeline_succeeds === true ? 'all' : project.only_allow_merge_if_pipeline_succeeds === false ? [] : null,
    needs,
  }
}
