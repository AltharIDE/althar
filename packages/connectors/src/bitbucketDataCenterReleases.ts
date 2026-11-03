import { Effect, Schema } from 'effect'

import type { ConnectorFailed } from './errors'
import type { Http } from './http'
import { type CheckState, notOurBuild, type Repository } from './model'
import { anotherServices, type HostReleases, noReleases, type Release, type Run, tagTaken } from './releases'

/*
 * Bitbucket Data Center's releases (ADR-081, "A release"): it has neither
 * releases nor CI of its own. A tag is made or deleted through its git REST
 * API, never moved, and the tag is the release: the repository's own CI (on
 * Jenkins, Bamboo or the like) does the rest. A run is a build that service
 * reported on the tag's commit, which only it can run again or approve.
 * Docs relied on:
 * - tags (read): https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-repository/#api-api-latest-projects-projectkey-repos-repositoryslug-tags-name-get
 * - tags (made, deleted): https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-git/
 * - build statuses: https://developer.atlassian.com/server/bitbucket/rest/v906/api-group-builds-and-deployments/
 */

const TagAnswer = Schema.Struct({ displayId: Schema.String, latestCommit: Schema.String })

export interface DataCenterBuild {
  readonly key: string
  readonly name?: string | null | undefined
  readonly state: string
  readonly url?: string | null | undefined
}

export const makeBitbucketDataCenterReleases = (input: {
  readonly http: Pick<Http, 'json'>
  /** The repository's REST address, `…/rest/api/latest/projects/P/repos/r`. */
  readonly base: (repository: Repository) => string
  /** The server's REST root, `…/rest`, where its git API is. */
  readonly rest: string
  /** The builds another service reported on a commit. */
  readonly builds: (sha: string) => Effect.Effect<ReadonlyArray<DataCenterBuild>, ConnectorFailed>
  readonly buildState: (state: string) => CheckState
}): HostReleases => {
  const { http, base, rest } = input
  const product = 'bitbucket_dc' as const
  const gone = (error: ConnectorFailed) => error.reason === 'not_found'
  const git = (repository: Repository) =>
    `${rest}/git/latest/projects/${encodeURIComponent(repository.path[0] ?? '')}/repos/${encodeURIComponent(repository.path[1] ?? '')}`
  const tagUrl = (repository: Repository, name: string) => `${repository.webUrl}/browse?at=${encodeURIComponent(`refs/tags/${name}`)}`

  const tag: HostReleases['tag'] = (repository, name) =>
    http.json(TagAnswer, 'GET', `${base(repository)}/tags/${encodeURIComponent(name)}`).pipe(
      Effect.map((found) => ({ name: found.displayId, commit: found.latestCommit, url: tagUrl(repository, name) })),
      Effect.catchIf(gone, () => Effect.succeed(null)),
    )
  const remove = (repository: Repository, name: string) =>
    http.json(Schema.Unknown, 'DELETE', `${git(repository)}/tags/${encodeURIComponent(name)}`).pipe(
      Effect.asVoid,
      Effect.catchIf(gone, () => Effect.void),
    )
  const release: HostReleases['release'] = (repository, name) =>
    Effect.map(tag(repository, name), (found) =>
      found === null ? null : ({ id: name, tag: name, name: null, state: 'tagged', url: found.url, files: [] } satisfies Release),
    )

  return {
    releasing: 'tag',
    commitOf: (repository, ref) =>
      Effect.map(
        http.json(Schema.Struct({ id: Schema.String }), 'GET', `${base(repository)}/commits/${encodeURIComponent(ref)}`),
        (commit) => commit.id,
      ),
    tag,
    pushTag: (repository, wanted) =>
      Effect.gen(function* () {
        const now = yield* tag(repository, wanted.name)
        if (now !== null && now.commit === wanted.commit) return now
        if (now !== null && wanted.move !== true) return yield* tagTaken(product, wanted.name, now.commit)
        // Deleted, then made again where it is asked to be: Data Center moves no tag.
        if (now !== null) yield* remove(repository, wanted.name)
        yield* http.json(Schema.Unknown, 'POST', `${git(repository)}/tags`, {
          name: wanted.name,
          startPoint: wanted.commit,
          message: '',
        })
        return { name: wanted.name, commit: wanted.commit, url: tagUrl(repository, wanted.name) }
      }),
    deleteTag: remove,
    release,
    publishRelease: () => Effect.fail(noReleases(product)),
    // The builds on the commit the ref is at, each a run with nothing to approve here: they are another service's.
    runs: (repository, ref) =>
      Effect.gen(function* () {
        const sha = yield* http
          .json(Schema.Struct({ id: Schema.String }), 'GET', `${base(repository)}/commits/${encodeURIComponent(ref)}`)
          .pipe(Effect.map((commit) => commit.id))
        return (yield* input.builds(sha)).map((build): Run => ({
          id: build.key,
          name: build.name ?? build.key,
          ref,
          sha,
          state: input.buildState(build.state),
          url: build.url ?? null,
          gates: [],
        }))
      }),
    approveRun: (_repository, run) => Effect.fail(anotherServices(product, run)),
    rerunFailed: (_repository, run) => Effect.fail(notOurBuild(product, { name: run.name, url: run.url })),
  }
}
