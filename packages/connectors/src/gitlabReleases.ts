import { Effect, Schema } from 'effect'

import type { ConnectorFailed } from './errors'
import type { Http } from './http'
import type { Repository } from './model'
import { type Gate, type HostReleases, notApprovable, type Release, type Run, tagTaken } from './releases'

/*
 * GitLab's releases (ADR-081, "A release"): a tag is made or deleted, never
 * moved, so moving one is deleting it and making it again; a release has no
 * draft, so making it is publishing it; a run is a pipeline, and what one
 * waits on is a deployment's approval or a manual job. Docs relied on:
 * - tags: https://docs.gitlab.com/api/tags/
 * - releases: https://docs.gitlab.com/api/releases/
 * - pipelines, retrying one: https://docs.gitlab.com/api/pipelines/
 * - jobs, playing a manual one: https://docs.gitlab.com/api/jobs/
 * - deployments, approving a blocked one (Premium):
 *   https://docs.gitlab.com/api/deployments/#approve-or-reject-a-blocked-deployment
 */

const TagAnswer = Schema.Struct({ name: Schema.String, commit: Schema.Struct({ id: Schema.String }) })
const CommitAnswer = Schema.Struct({ id: Schema.String })

const ReleaseAnswer = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  _links: Schema.optional(Schema.NullOr(Schema.Struct({ self: Schema.optional(Schema.NullOr(Schema.String)) }))),
  assets: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        links: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.optional(Schema.NullOr(Schema.String)) }))),
      }),
    ),
  ),
})
type ReleaseAnswer = typeof ReleaseAnswer.Type

const PipelineAnswer = Schema.Struct({
  id: Schema.Number,
  ref: Schema.optional(Schema.NullOr(Schema.String)),
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
})
type PipelineAnswer = typeof PipelineAnswer.Type

const ManualJob = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
})

const Blocked = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    environment: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
    deployable: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  }),
)

/** A pipeline's state, as a check's: `manual` and `waiting_for_resource` wait; `scheduled` waits for its time. */
const pipelineState = (status: string): Run['state'] => {
  switch (status) {
    case 'success':
      return 'passed'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'canceling':
      return 'cancelled'
    case 'skipped':
      return 'skipped'
    case 'running':
      return 'running'
    default:
      return 'queued'
  }
}

const releaseOf = (answer: ReleaseAnswer): Release => ({
  id: answer.tag_name,
  tag: answer.tag_name,
  name: answer.name ?? null,
  // A release GitLab has is out: it has no drafts.
  state: 'published',
  url: answer._links?.self ?? null,
  files: (answer.assets?.links ?? []).map((link) => ({ name: link.name, size: null, url: link.url ?? null })),
})

export const makeGitLabReleases = (input: {
  readonly http: Http
  readonly project: (repository: Repository) => string
  /** GitLab's 401 for an account that may not, said as `forbidden`. */
  readonly mayNot: <A>(effect: Effect.Effect<A, ConnectorFailed>) => Effect.Effect<A, ConnectorFailed>
}): HostReleases => {
  const { http, project, mayNot } = input
  const product = 'gitlab' as const
  const gone = (error: ConnectorFailed) => error.reason === 'not_found'
  const tagUrl = (repository: Repository, name: string) => `${repository.webUrl}/-/tags/${encodeURIComponent(name)}`

  const tag: HostReleases['tag'] = (repository, name) =>
    http.json(TagAnswer, 'GET', `${project(repository)}/repository/tags/${encodeURIComponent(name)}`).pipe(
      Effect.map((found) => ({ name: found.name, commit: found.commit.id, url: tagUrl(repository, name) })),
      Effect.catchIf(gone, () => Effect.succeed(null)),
    )

  const make = (repository: Repository, name: string, commit: string) =>
    mayNot(http.json(TagAnswer, 'POST', `${project(repository)}/repository/tags`, { tag_name: name, ref: commit })).pipe(
      Effect.map((made) => ({ name: made.name, commit: made.commit.id, url: tagUrl(repository, name) })),
    )
  const remove = (repository: Repository, name: string) =>
    mayNot(http.json(Schema.Unknown, 'DELETE', `${project(repository)}/repository/tags/${encodeURIComponent(name)}`)).pipe(
      Effect.asVoid,
      Effect.catchIf(gone, () => Effect.void),
    )

  /** What a pipeline waits on: each manual job, as a deployment to approve where GitLab blocks it for one. */
  const gatesOf = (repository: Repository, pipeline: PipelineAnswer) =>
    Effect.gen(function* () {
      if (pipelineState(pipeline.status) !== 'queued' && pipelineState(pipeline.status) !== 'running' && pipeline.status !== 'success')
        return []
      const manual = yield* http.json(Schema.Array(ManualJob), 'GET', `${project(repository)}/pipelines/${pipeline.id}/jobs?scope[]=manual`)
      if (manual.length === 0) return []
      // Deployment approvals are Premium's: without them, the listing refuses or is empty, and each manual job is played.
      const blocked = yield* http
        .json(Blocked, 'GET', `${project(repository)}/deployments?status=blocked&order_by=updated_at&sort=desc&per_page=50`)
        .pipe(Effect.orElseSucceed(() => []))
      return manual.map((job): Gate => {
        const deployment = blocked.find((one) => one.deployable?.id === job.id)
        return deployment === undefined
          ? { id: String(job.id), name: job.name, kind: 'manual_job', approvable: true, url: job.web_url ?? null }
          : {
              id: String(deployment.id),
              name: deployment.environment?.name ?? job.name,
              kind: 'deployment',
              // Whether the account is among the environment's approvers, GitLab says only by refusing it.
              approvable: true,
              url: job.web_url ?? null,
            }
      })
    })

  const runOf = (repository: Repository, pipeline: PipelineAnswer) =>
    Effect.map(gatesOf(repository, pipeline), (gates): Run => ({
      id: String(pipeline.id),
      name: `Pipeline ${pipeline.id}`,
      ref: pipeline.ref ?? '',
      sha: pipeline.sha ?? null,
      state: pipelineState(pipeline.status),
      url: pipeline.web_url ?? null,
      gates,
    }))

  return {
    releasing: 'made',
    commitOf: (repository, ref) =>
      Effect.map(
        http.json(CommitAnswer, 'GET', `${project(repository)}/repository/commits/${encodeURIComponent(ref)}`),
        (commit) => commit.id,
      ),
    tag,
    pushTag: (repository, wanted) =>
      Effect.gen(function* () {
        const now = yield* tag(repository, wanted.name)
        if (now !== null && now.commit === wanted.commit) return now
        if (now !== null && wanted.move !== true) return yield* tagTaken(product, wanted.name, now.commit)
        // GitLab can't move a tag: it is deleted, then made again where it is asked to be.
        if (now !== null) yield* remove(repository, wanted.name)
        return yield* make(repository, wanted.name, wanted.commit).pipe(
          Effect.catchIf(
            (error) => error.status === 400 && /already exists/i.test(error.message),
            (error) =>
              Effect.flatMap(tag(repository, wanted.name), (made) =>
                made === null
                  ? Effect.fail(error)
                  : made.commit === wanted.commit
                    ? Effect.succeed(made)
                    : Effect.fail(tagTaken(product, wanted.name, made.commit)),
              ),
          ),
        )
      }),
    deleteTag: remove,
    release: (repository, name) =>
      http.json(ReleaseAnswer, 'GET', `${project(repository)}/releases/${encodeURIComponent(name)}`).pipe(
        Effect.map(releaseOf),
        Effect.catchIf(gone, () => Effect.succeed(null)),
      ),
    publishRelease: (repository, name, release) =>
      Effect.gen(function* () {
        const now = yield* http
          .json(ReleaseAnswer, 'GET', `${project(repository)}/releases/${encodeURIComponent(name)}`)
          .pipe(Effect.catchIf(gone, () => Effect.succeed(null)))
        if (now !== null) return releaseOf(now)
        // Of the tag as it is: with no `ref`, GitLab makes no tag of its own.
        return releaseOf(
          yield* mayNot(
            http.json(ReleaseAnswer, 'POST', `${project(repository)}/releases`, {
              tag_name: name,
              name: release.name ?? name,
              ...(release.notes === undefined ? {} : { description: release.notes }),
            }),
          ),
        )
      }),
    runs: (repository, ref) =>
      Effect.gen(function* () {
        const pipelines = yield* http.json(
          Schema.Array(PipelineAnswer),
          'GET',
          `${project(repository)}/pipelines?ref=${encodeURIComponent(ref)}&order_by=id&sort=desc&per_page=20`,
        )
        return yield* Effect.forEach(pipelines, (pipeline) => runOf(repository, pipeline))
      }),
    approveRun: (repository, run, gate) =>
      Effect.gen(function* () {
        if (!gate.approvable) return yield* notApprovable(product, gate)
        const asked =
          gate.kind === 'deployment'
            ? http.json(Schema.Unknown, 'POST', `${project(repository)}/deployments/${gate.id}/approval`, {
                status: 'approved',
                comment: 'Approved through Althar, on the person’s word.',
              })
            : http.json(Schema.Unknown, 'POST', `${project(repository)}/jobs/${gate.id}/play`)
        // Not one of its approvers, or a protected environment's: GitLab refuses, and the person approves on GitLab.
        yield* mayNot(asked).pipe(
          Effect.catchIf(
            (error) => error.reason === 'forbidden' || (error.status === 400 && gate.kind === 'deployment'),
            () => Effect.fail(notApprovable(product, gate)),
          ),
        )
        return yield* runOf(repository, yield* http.json(PipelineAnswer, 'GET', `${project(repository)}/pipelines/${run.id}`))
      }),
    // Every failed or cancelled job of the pipeline, again, as new jobs on the same commit.
    rerunFailed: (repository, run) =>
      mayNot(http.json(Schema.Unknown, 'POST', `${project(repository)}/pipelines/${run.id}/retry`)).pipe(Effect.as(true)),
  }
}
