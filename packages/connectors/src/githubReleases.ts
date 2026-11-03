import { Effect, Schema } from 'effect'

import type { Http } from './http'
import type { Repository } from './model'
import { type Gate, type HostReleases, noDraft, notApprovable, type Release, type Run, tagTaken } from './releases'

/*
 * GitHub's releases (ADR-081, "A release"): a tag is a ref made through the
 * Git database, a release is drafted (here, by release.yml) and published by
 * turning its draft off, a run is an Actions workflow run, and what one
 * waits on is an environment's required reviewers. Docs relied on:
 * - refs: https://docs.github.com/en/rest/git/refs
 * - releases: https://docs.github.com/en/rest/releases/releases
 * - runs: https://docs.github.com/en/rest/actions/workflow-runs
 *   (pending deployments, reviewing them, re-running failed jobs)
 */

const RefAnswer = Schema.Struct({ object: Schema.Struct({ sha: Schema.String, type: Schema.String }) })
const TagObject = Schema.Struct({ object: Schema.Struct({ sha: Schema.String, type: Schema.String }) })
const CommitAnswer = Schema.Struct({ sha: Schema.String })

const ReleaseAnswer = Schema.Struct({
  id: Schema.Number,
  tag_name: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  draft: Schema.Boolean,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  assets: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        size: Schema.optional(Schema.NullOr(Schema.Number)),
        browser_download_url: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
})
type ReleaseAnswer = typeof ReleaseAnswer.Type

const RunAnswer = Schema.Struct({
  id: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  head_branch: Schema.optional(Schema.NullOr(Schema.String)),
  head_sha: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
})
type RunAnswer = typeof RunAnswer.Type

const Pending = Schema.Array(
  Schema.Struct({
    environment: Schema.Struct({ id: Schema.Number, name: Schema.String }),
    current_user_can_approve: Schema.optional(Schema.Boolean),
  }),
)

/** A workflow run's state, as a check's: `waiting` (for an environment's reviewers) and `requested` are still to run. */
const runState = (run: RunAnswer): Run['state'] => {
  const status = run.status ?? 'queued'
  if (status !== 'completed') return status === 'in_progress' ? 'running' : 'queued'
  switch (run.conclusion) {
    case 'success':
      return 'passed'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    case 'neutral':
      return 'neutral'
    default:
      return 'failed'
  }
}

const releaseOf = (answer: ReleaseAnswer): Release => ({
  id: String(answer.id),
  tag: answer.tag_name,
  name: answer.name ?? null,
  state: answer.draft ? 'draft' : 'published',
  url: answer.html_url ?? null,
  files: (answer.assets ?? []).map((asset) => ({ name: asset.name, size: asset.size ?? null, url: asset.browser_download_url ?? null })),
})

export const makeGitHubReleases = (input: { readonly http: Http; readonly repo: (repository: Repository) => string }): HostReleases => {
  const { http, repo } = input
  const product = 'github' as const
  const tagUrl = (repository: Repository, name: string) => `${repository.webUrl}/releases/tag/${encodeURIComponent(name)}`

  const tag: HostReleases['tag'] = (repository, name) =>
    Effect.gen(function* () {
      const ref = yield* http.json(RefAnswer, 'GET', `${repo(repository)}/git/ref/tags/${encodeURIComponent(name)}`).pipe(
        Effect.catchIf(
          (error) => error.reason === 'not_found',
          () => Effect.succeed(null),
        ),
      )
      if (ref === null) return null
      // An annotated tag points at its tag object: the commit is under it.
      let { sha, type } = ref.object
      for (let depth = 0; type === 'tag' && depth < 4; depth++) {
        const object = yield* http.json(TagObject, 'GET', `${repo(repository)}/git/tags/${sha}`)
        sha = object.object.sha
        type = object.object.type
      }
      return { name, commit: sha, url: tagUrl(repository, name) }
    })

  /** Every release, drafts included (only the list has drafts, to an account that can push): the tag's, newest first. */
  const releaseAnswer = (repository: Repository, name: string) =>
    Effect.map(
      http.json(Schema.Array(ReleaseAnswer), 'GET', `${repo(repository)}/releases?per_page=100`),
      (releases) => releases.find((release) => release.tag_name === name) ?? null,
    )

  const gatesOf = (repository: Repository, run: RunAnswer) =>
    run.status !== 'waiting'
      ? Effect.succeed<ReadonlyArray<Gate>>([])
      : Effect.map(http.json(Pending, 'GET', `${repo(repository)}/actions/runs/${run.id}/pending_deployments`), (pending) =>
          pending.map((deployment): Gate => ({
            id: String(deployment.environment.id),
            name: deployment.environment.name,
            kind: 'environment',
            // GitHub says whether the account is among its reviewers, and isn't stopped by "Prevent self-review".
            approvable: deployment.current_user_can_approve === true,
            url: run.html_url ?? null,
          })),
        )

  const runOf = (repository: Repository, run: RunAnswer) =>
    Effect.map(gatesOf(repository, run), (gates): Run => ({
      id: String(run.id),
      name: run.name ?? `Run ${run.id}`,
      ref: run.head_branch ?? '',
      sha: run.head_sha ?? null,
      state: runState(run),
      url: run.html_url ?? null,
      gates,
    }))

  return {
    releasing: 'draft',
    commitOf: (repository, ref) =>
      Effect.map(http.json(CommitAnswer, 'GET', `${repo(repository)}/commits/${encodeURIComponent(ref)}`), (commit) => commit.sha),
    tag,
    pushTag: (repository, wanted) =>
      Effect.gen(function* () {
        const now = yield* tag(repository, wanted.name)
        if (now !== null && now.commit === wanted.commit) return now
        if (now !== null && wanted.move !== true) return yield* tagTaken(product, wanted.name, now.commit)
        if (now !== null)
          yield* http.json(Schema.Unknown, 'PATCH', `${repo(repository)}/git/refs/tags/${encodeURIComponent(wanted.name)}`, {
            sha: wanted.commit,
            force: true,
          })
        else
          yield* http
            .json(Schema.Unknown, 'POST', `${repo(repository)}/git/refs`, { ref: `refs/tags/${wanted.name}`, sha: wanted.commit })
            .pipe(
              // Made meanwhile by someone else: as it now stands, it is this one, or taken.
              Effect.catchIf(
                (error) => error.status === 422 && /already exists/i.test(error.message),
                (error) =>
                  Effect.flatMap(tag(repository, wanted.name), (made) =>
                    made === null
                      ? Effect.fail(error)
                      : made.commit === wanted.commit
                        ? Effect.void
                        : Effect.fail(tagTaken(product, wanted.name, made.commit)),
                  ),
              ),
            )
        return { name: wanted.name, commit: wanted.commit, url: tagUrl(repository, wanted.name) }
      }),
    deleteTag: (repository, name) =>
      http.json(Schema.Unknown, 'DELETE', `${repo(repository)}/git/refs/tags/${encodeURIComponent(name)}`).pipe(
        Effect.asVoid,
        // GitHub answers 422 for a ref already gone: only one that then isn't there is gone.
        Effect.catchIf(
          (error) => error.reason === 'not_found' || error.status === 422,
          (error) => Effect.flatMap(tag(repository, name), (still) => (still === null ? Effect.void : Effect.fail(error))),
        ),
      ),
    release: (repository, name) => Effect.map(releaseAnswer(repository, name), (answer) => (answer === null ? null : releaseOf(answer))),
    publishRelease: (repository, name, release) =>
      Effect.gen(function* () {
        const now = yield* releaseAnswer(repository, name)
        if (now === null) return yield* noDraft(product, name)
        if (!now.draft) return releaseOf(now)
        return releaseOf(
          yield* http.json(ReleaseAnswer, 'PATCH', `${repo(repository)}/releases/${now.id}`, {
            draft: false,
            ...(release.name === undefined ? {} : { name: release.name }),
            ...(release.notes === undefined ? {} : { body: release.notes }),
          }),
        )
      }),
    runs: (repository, ref) =>
      Effect.gen(function* () {
        // A tag's push runs with the tag as its "branch", which the filter takes too.
        const { workflow_runs } = yield* http.json(
          Schema.Struct({ workflow_runs: Schema.Array(RunAnswer) }),
          'GET',
          `${repo(repository)}/actions/runs?branch=${encodeURIComponent(ref)}&per_page=20`,
        )
        return yield* Effect.forEach(
          workflow_runs.filter((run) => run.head_branch === ref),
          (run) => runOf(repository, run),
        )
      }),
    approveRun: (repository, run, gate) =>
      Effect.gen(function* () {
        if (!gate.approvable) return yield* notApprovable(product, gate)
        yield* http
          .json(Schema.Unknown, 'POST', `${repo(repository)}/actions/runs/${run.id}/pending_deployments`, {
            environment_ids: [Number(gate.id)],
            state: 'approved',
            comment: 'Approved through Althar, on the person’s word.',
          })
          .pipe(
            Effect.catchIf(
              (error) => error.reason === 'forbidden' || error.status === 422,
              () => Effect.fail(notApprovable(product, gate)),
            ),
          )
        return yield* runOf(repository, yield* http.json(RunAnswer, 'GET', `${repo(repository)}/actions/runs/${run.id}`))
      }),
    rerunFailed: (repository, run) =>
      http.json(Schema.Unknown, 'POST', `${repo(repository)}/actions/runs/${run.id}/rerun-failed-jobs`).pipe(Effect.as(true)),
  }
}
