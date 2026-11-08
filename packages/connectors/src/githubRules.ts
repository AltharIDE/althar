import { Schema } from 'effect'

import type { HostNeed, MergeMethod, MergeRules } from './model'

/*
 * What GitHub requires before a pull request merges (DEV-204), read in one
 * GraphQL call: how GitHub sums it up (`mergeStateStatus`, `reviewDecision`),
 * the branch protection anyone who can read the repository sees
 * (`refUpdateRule`), who is asked to review and who approved, its review
 * threads, its commits' signatures, and which of its head's checks are
 * required. The branch's rulesets come from REST (`/rules/branches/…`), asked
 * by ETag, so an unchanged answer costs nothing. Whether the branch must be up
 * to date is said by its rulesets, by GitHub's own BEHIND, or, for classic
 * protection, by its required checks' `strict`, which only an admin may read:
 * for anyone else it is unknown, until GitHub says BEHIND.
 */

/** The pull request's merge requirements; `refUpdateRule` left out where the server doesn't know it (an older Enterprise Server). */
export const mergeRulesQuery = (rule: boolean) => `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      isDraft mergeStateStatus reviewDecision isMergeQueueEnabled isInMergeQueue
      ${
        rule
          ? `baseRef { refUpdateRule { requiredApprovingReviewCount requiredStatusCheckContexts requiresCodeOwnerReviews
        requiresConversationResolution requiresLinearHistory requiresSignatures } }`
          : ''
      }
      reviewRequests(first: 50) {
        nodes { asCodeOwner requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { combinedSlug } } }
      }
      latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { state author { login } } }
      reviewThreads(first: 100) { totalCount nodes { isResolved } }
      commits(first: 100) { totalCount nodes { commit { signature { isValid } } } }
      head: commits(last: 1) {
        nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
        } } } } }
      }
    }
  }
}`

const Reviewer = Schema.Struct({
  __typename: Schema.optional(Schema.String),
  login: Schema.optional(Schema.String),
  combinedSlug: Schema.optional(Schema.String),
})

const RefUpdateRule = Schema.Struct({
  requiredApprovingReviewCount: Schema.optional(Schema.NullOr(Schema.Number)),
  requiredStatusCheckContexts: Schema.optional(Schema.NullOr(Schema.Array(Schema.NullOr(Schema.String)))),
  requiresCodeOwnerReviews: Schema.optional(Schema.Boolean),
  requiresConversationResolution: Schema.optional(Schema.Boolean),
  requiresLinearHistory: Schema.optional(Schema.Boolean),
  requiresSignatures: Schema.optional(Schema.Boolean),
})

const Context = Schema.Struct({
  __typename: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.String),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  isRequired: Schema.optional(Schema.Boolean),
})

const nodes = <A, I>(item: Schema.Codec<A, I>) => Schema.Struct({ nodes: Schema.Array(Schema.NullOr(item)) })

export const PullRules = Schema.Struct({
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  isMergeQueueEnabled: Schema.optional(Schema.Boolean),
  isInMergeQueue: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(Schema.NullOr(Schema.Struct({ refUpdateRule: Schema.optional(Schema.NullOr(RefUpdateRule)) }))),
  reviewRequests: Schema.optional(
    Schema.NullOr(nodes(Schema.Struct({ asCodeOwner: Schema.Boolean, requestedReviewer: Schema.NullOr(Reviewer) }))),
  ),
  latestOpinionatedReviews: Schema.optional(
    Schema.NullOr(nodes(Schema.Struct({ state: Schema.String, author: Schema.NullOr(Schema.Struct({ login: Schema.String })) }))),
  ),
  reviewThreads: Schema.Struct({
    totalCount: Schema.Number,
    nodes: Schema.Array(Schema.NullOr(Schema.Struct({ isResolved: Schema.Boolean }))),
  }),
  commits: Schema.Struct({
    totalCount: Schema.Number,
    nodes: Schema.Array(
      Schema.NullOr(Schema.Struct({ commit: Schema.Struct({ signature: Schema.NullOr(Schema.Struct({ isValid: Schema.Boolean })) }) })),
    ),
  }),
  head: nodes(
    Schema.Struct({
      commit: Schema.Struct({ statusCheckRollup: Schema.NullOr(Schema.Struct({ contexts: nodes(Context) })) }),
    }),
  ),
})
export type PullRules = typeof PullRules.Type

export const PullRulesAnswer = Schema.Struct({
  repository: Schema.NullOr(Schema.Struct({ pullRequest: Schema.NullOr(PullRules) })),
})

/** The rules of the rulesets that apply to a branch, as `/rules/branches/{branch}` lists them: each its type and parameters. */
export const RulesetsAnswer = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    parameters: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  }),
)
export type RulesetsAnswer = typeof RulesetsAnswer.Type

/** What a branch's rulesets require of a pull request into it. */
export interface Rulesets {
  readonly approvals: number
  readonly codeOwners: boolean
  readonly conversations: boolean
  readonly checks: ReadonlyArray<string>
  readonly strict: boolean
  readonly signatures: boolean
  readonly linear: boolean
  readonly queue: boolean
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** What the rules of a branch's rulesets require, together: the most approvals any asks, every check any names. */
export const rulesetsOf = (rules: RulesetsAnswer): Rulesets => {
  const of = (type: string) => rules.filter((rule) => rule.type === type)
  const pulls = of('pull_request').map((rule) => rule.parameters ?? {})
  const checks = of('required_status_checks').map((rule) => rule.parameters ?? {})
  return {
    approvals: Math.max(0, ...pulls.map((one) => count(one['required_approving_review_count']))),
    codeOwners: pulls.some((one) => one['require_code_owner_review'] === true),
    conversations: pulls.some((one) => one['required_review_thread_resolution'] === true),
    checks: checks.flatMap((one) => {
      const listed = one['required_status_checks']
      return Array.isArray(listed)
        ? listed.flatMap((check: unknown) =>
            typeof check === 'object' && check !== null && typeof (check as { context?: unknown }).context === 'string'
              ? [(check as { context: string }).context]
              : [],
          )
        : []
    }),
    strict: checks.some((one) => one['strict_required_status_checks_policy'] === true),
    signatures: of('required_signatures').length > 0,
    linear: of('required_linear_history').length > 0,
    queue: of('merge_queue').length > 0,
  }
}

export const NO_RULESETS: Rulesets = {
  approvals: 0,
  codeOwners: false,
  conversations: false,
  checks: [],
  strict: false,
  signatures: false,
  linear: false,
  queue: false,
}

/** Whether a check of the rollup passed, as GitHub counts it toward a merge: skipped and neutral do. */
const passed = (context: typeof Context.Type) =>
  context.__typename === 'StatusContext'
    ? context.state === 'SUCCESS'
    : context.status === 'COMPLETED' && ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(context.conclusion ?? '')

const nameOf = (context: typeof Context.Type) => context.name ?? context.context ?? ''

/** Who a review is asked of, by the name GitHub shows: a person's or app's login, a team as org/team. */
const reviewerOf = (reviewer: typeof Reviewer.Type | null) => reviewer?.combinedSlug ?? reviewer?.login ?? null

const unique = (names: ReadonlyArray<string>) => [...new Set(names)]

/**
 * What a pull request needs to merge on GitHub, from what GitHub said of it,
 * its branch's rulesets, how far it is behind its target where that was asked
 * (null where it wasn't, or couldn't be), whether its branch must be up to
 * date where GitHub's classic protection says (null where it doesn't say),
 * and how the repository lets it merge.
 */
export const mergeRulesOf = (input: {
  readonly pull: PullRules
  readonly rulesets: Rulesets
  readonly behind: number | null
  readonly strict: boolean | null
  readonly merges: ReadonlyArray<MergeMethod>
}): MergeRules => {
  const { pull, rulesets } = input
  const rule = pull.baseRef?.refUpdateRule ?? null
  const contexts = (pull.head.nodes.at(-1)?.commit.statusCheckRollup?.contexts.nodes ?? []).filter(
    (one): one is typeof Context.Type => one !== null,
  )
  const required = unique([
    ...contexts.filter((one) => one.isRequired === true).map(nameOf),
    ...(rule?.requiredStatusCheckContexts ?? []).filter((name): name is string => name !== null && name !== ''),
    ...rulesets.checks,
  ]).filter((name) => name !== '')
  const needs: Array<HostNeed> = []

  // Reviews: who approved and who asked for changes, by their latest say; who is asked still, a code owner or not.
  const reviews = (pull.latestOpinionatedReviews?.nodes ?? []).filter((one) => one !== null)
  const approvedBy = unique(reviews.filter((one) => one.state === 'APPROVED').flatMap((one) => (one.author ? [one.author.login] : [])))
  const changesBy = unique(
    reviews.filter((one) => one.state === 'CHANGES_REQUESTED').flatMap((one) => (one.author ? [one.author.login] : [])),
  )
  const requests = (pull.reviewRequests?.nodes ?? []).filter((one) => one !== null)
  const asked = unique(requests.flatMap((one) => reviewerOf(one.requestedReviewer) ?? []))
  const owners = unique(requests.filter((one) => one.asCodeOwner).flatMap((one) => reviewerOf(one.requestedReviewer) ?? []))
  const decision = pull.reviewDecision ?? null
  const counted = Math.max(rule?.requiredApprovingReviewCount ?? 0, rulesets.approvals)
  // GitHub sums the reviews up only where the branch requires them: then changes asked for hold it back.
  const reviewed = counted > 0 || decision !== null
  const enough = decision === 'APPROVED' || (counted > 0 ? approvedBy.length >= counted : decision !== 'REVIEW_REQUIRED')
  if (counted > 0 || decision === 'REVIEW_REQUIRED')
    needs.push({
      kind: 'approvals',
      state: enough ? 'met' : asked.length > 0 ? 'waiting' : 'unmet',
      have: approvedBy.length,
      ...(counted > 0 ? { need: counted } : {}),
      who: enough || asked.length === 0 ? approvedBy : asked,
    })
  if (rule?.requiresCodeOwnerReviews === true || rulesets.codeOwners)
    needs.push(
      owners.length > 0
        ? { kind: 'code_owners', state: 'waiting', who: owners }
        : // Approved by enough, and still a review short: the code owners' it is.
          decision === 'REVIEW_REQUIRED' && counted > 0 && approvedBy.length >= counted
          ? { kind: 'code_owners', state: 'unmet' }
          : { kind: 'code_owners', state: 'met' },
    )
  if (reviewed || changesBy.length > 0)
    needs.push(
      changesBy.length > 0 ? { kind: 'changes_requested', state: 'unmet', who: changesBy } : { kind: 'changes_requested', state: 'met' },
    )

  if (rule?.requiresConversationResolution === true || rulesets.conversations) {
    const threads = pull.reviewThreads.nodes.filter((one) => one !== null)
    const open = threads.filter((one) => !one.isResolved).length
    const total = pull.reviewThreads.totalCount
    needs.push({
      kind: 'conversations',
      // Past the threads read, one not read may be open.
      state: open > 0 ? 'unmet' : threads.length < total ? 'unknown' : 'met',
      have: threads.length - open,
      need: total,
    })
  }

  // Up to date: required where its rulesets say, or GitHub says BEHIND; unknown where only an admin may read it.
  const strict = rulesets.strict || pull.mergeStateStatus === 'BEHIND' ? true : input.strict
  if (strict !== false) {
    const behind = pull.mergeStateStatus === 'BEHIND' ? Math.max(input.behind ?? 1, 1) : input.behind
    if (behind === 0) needs.push({ kind: 'up_to_date', state: 'met' })
    else if (behind !== null && strict === true) needs.push({ kind: 'up_to_date', state: 'unmet', have: behind })
    else needs.push({ kind: 'up_to_date', state: 'unknown', ...(behind === null ? {} : { have: behind }) })
  }

  if (rule?.requiresSignatures === true || rulesets.signatures) {
    const commits = pull.commits.nodes.filter((one) => one !== null)
    const unsigned = commits.filter((one) => one.commit.signature?.isValid !== true).length
    needs.push({
      kind: 'signatures',
      state: unsigned > 0 ? 'unmet' : commits.length < pull.commits.totalCount ? 'unknown' : 'met',
      have: unsigned,
    })
  }
  if (rule?.requiresLinearHistory === true || rulesets.linear)
    needs.push({ kind: 'linear_history', state: input.merges.some((way) => way !== 'merge') ? 'met' : 'unmet' })
  const queue = pull.isMergeQueueEnabled === true || rulesets.queue
  if (queue) needs.push({ kind: 'merge_queue', state: pull.isInMergeQueue === true ? 'waiting' : 'met' })

  // GitHub blocks it, and nothing Althar read says why: a rule it can't read, such as one only an admin sees.
  const explained =
    queue ||
    pull.isDraft ||
    needs.some((one) => one.state !== 'met') ||
    required.some((name) => {
      const ran = contexts.find((one) => nameOf(one) === name)
      return ran === undefined || !passed(ran)
    })
  if (pull.mergeStateStatus === 'BLOCKED' && !explained) needs.push({ kind: 'other', state: 'unmet' })

  // Protected, or with checks GitHub calls required, it names the required ones; with neither, none is.
  return { requiredChecks: required, needs }
}
