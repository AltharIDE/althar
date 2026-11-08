import { Schema } from 'effect'

import type { HostNeed, MergeRules } from './model'

/*
 * What Bitbucket requires before a pull request merges (DEV-204), as far as
 * each says. Cloud: its participants, who approved and who asked for
 * changes, and its branch restrictions, which only an admin may list: for
 * anyone else, how many approvals it needs and which builds are required
 * stay unknown. Data Center: its reviewers, and its merge checks' vetoes,
 * read from whether it can merge; a veto no line says is said in its own
 * words.
 */

export const CloudParticipants = Schema.Struct({
  participants: Schema.optional(
    Schema.Array(
      Schema.Struct({
        user: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              nickname: Schema.optional(Schema.NullOr(Schema.String)),
              display_name: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
        role: Schema.optional(Schema.String),
        approved: Schema.optional(Schema.Boolean),
        state: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
})
export type CloudParticipants = typeof CloudParticipants.Type

export const CloudRestrictions = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      pattern: Schema.optional(Schema.NullOr(Schema.String)),
      branch_match_kind: Schema.optional(Schema.NullOr(Schema.String)),
      value: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
})
export type CloudRestrictions = typeof CloudRestrictions.Type

/** Whether a glob of a branch restriction takes a branch: `*` for any run of characters. */
export const globTakes = (pattern: string, branch: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`).test(branch)

const named = (
  user: { readonly nickname?: string | null | undefined; readonly display_name?: string | null | undefined } | null | undefined,
) => user?.nickname ?? user?.display_name ?? null

/**
 * What a pull request needs to merge on Bitbucket Cloud: from its
 * participants, and its target's branch restrictions, null where they
 * couldn't be read. Those of a branching model's branch type aren't matched:
 * only a glob says which branches it takes.
 */
export const cloudRulesOf = (input: {
  readonly target: string
  readonly pull: CloudParticipants
  readonly restrictions: CloudRestrictions | null
}): MergeRules => {
  const people = input.pull.participants ?? []
  const approvedBy = people.flatMap((one) => (one.approved === true ? (named(one.user) ?? []) : []))
  const changesBy = people.flatMap((one) => (one.state === 'changes_requested' ? (named(one.user) ?? []) : []))
  const pending = people.flatMap((one) =>
    one.role === 'REVIEWER' && one.approved !== true && one.state !== 'changes_requested' ? (named(one.user) ?? []) : [],
  )
  const applying = (input.restrictions?.values ?? []).filter(
    (one) => one.branch_match_kind !== 'branching_model' && one.pattern != null && globTakes(one.pattern, input.target),
  )
  const valueOf = (kind: string) => Math.max(0, ...applying.filter((one) => one.kind === kind).map((one) => one.value ?? 0))
  const has = (kind: string) => applying.some((one) => one.kind === kind)
  const needs: Array<HostNeed> = []
  const need = valueOf('require_approvals_to_merge')
  if (input.restrictions === null) needs.push({ kind: 'approvals', state: 'unknown', have: approvedBy.length, who: approvedBy })
  else if (need > 0) {
    const met = approvedBy.length >= need
    needs.push({
      kind: 'approvals',
      state: met ? 'met' : pending.length > 0 ? 'waiting' : 'unmet',
      have: approvedBy.length,
      need,
      who: met || pending.length === 0 ? approvedBy : pending,
    })
  }
  if (changesBy.length > 0) needs.push({ kind: 'changes_requested', state: 'unmet', who: changesBy })
  else if (input.restrictions === null || has('require_no_changes_requested') || need > 0)
    needs.push({ kind: 'changes_requested', state: 'met' })
  // How far behind it may be, Bitbucket says only as it refuses the merge.
  if (has('require_commits_behind')) needs.push({ kind: 'up_to_date', state: 'unknown' })
  return {
    requiredChecks: input.restrictions === null ? null : has('require_passing_builds_to_merge') ? 'all' : [],
    needs,
  }
}

export const DataCenterMerge = Schema.Struct({
  canMerge: Schema.Boolean,
  vetoes: Schema.optional(
    Schema.Array(Schema.Struct({ summaryMessage: Schema.optional(Schema.String), detailedMessage: Schema.optional(Schema.String) })),
  ),
})
export type DataCenterMerge = typeof DataCenterMerge.Type

/** Each reviewer, and how they left it: APPROVED, NEEDS_WORK, or UNAPPROVED. */
export interface DataCenterReviewer {
  readonly user: { readonly name: string; readonly displayName?: string | null | undefined }
  readonly status?: string | undefined
}

/**
 * What a pull request needs to merge on Bitbucket Data Center: from its
 * reviewers and its merge checks' vetoes. Its approvals' count it doesn't say
 * but in a veto's words, so a veto of approvals, builds or work needed is the
 * line it is; any other veto is said as it is.
 */
export const dataCenterRulesOf = (input: {
  readonly reviewers: ReadonlyArray<DataCenterReviewer>
  readonly merge: DataCenterMerge
}): MergeRules => {
  const vetoes = (input.merge.vetoes ?? []).map((veto) => veto.summaryMessage ?? veto.detailedMessage ?? '').filter((said) => said !== '')
  const approvedBy = input.reviewers.filter((one) => one.status === 'APPROVED').map((one) => one.user.name)
  const changesBy = input.reviewers.filter((one) => one.status === 'NEEDS_WORK').map((one) => one.user.name)
  const pending = input.reviewers.filter((one) => one.status !== 'APPROVED' && one.status !== 'NEEDS_WORK').map((one) => one.user.name)
  const approvals = vetoes.filter((said) => /approv/i.test(said))
  const builds = vetoes.filter((said) => /build/i.test(said))
  const work = vetoes.filter((said) => /needs? work/i.test(said))
  const needs: Array<HostNeed> = []
  if (approvals.length > 0)
    needs.push({
      kind: 'approvals',
      state: pending.length > 0 ? 'waiting' : 'unmet',
      have: approvedBy.length,
      who: pending.length > 0 ? pending : approvedBy,
    })
  else if (input.reviewers.length > 0)
    needs.push({ kind: 'approvals', state: input.merge.canMerge ? 'met' : 'unknown', have: approvedBy.length, who: approvedBy })
  if (changesBy.length > 0 || work.length > 0)
    needs.push({ kind: 'changes_requested', state: 'unmet', ...(changesBy.length > 0 ? { who: changesBy } : {}) })
  else if (input.reviewers.length > 0) needs.push({ kind: 'changes_requested', state: 'met' })
  for (const said of vetoes)
    if (!approvals.includes(said) && !builds.includes(said) && !work.includes(said)) needs.push({ kind: 'other', state: 'unmet', said })
  // Its builds are held to what its merge checks say: by a veto, all of them; with none, whether any are required it doesn't say.
  return { requiredChecks: builds.length > 0 ? 'all' : null, needs }
}
