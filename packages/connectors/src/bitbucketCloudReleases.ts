import { createHash } from 'node:crypto'

import { Effect, Schema } from 'effect'

import type { ConnectorFailed } from './errors'
import type { Http } from './http'
import type { Repository } from './model'
import { type Gate, type HostReleases, noFiles, onlyOnTheHost, type Release, type ReleaseUpload, type Run, tagTaken } from './releases'

/*
 * Bitbucket Cloud's releases (ADR-081, "A release"): it has none. A tag is
 * made or deleted, never moved, and publishing puts the release's files in
 * the repository's Downloads. A run is a pipeline, and what one waits on is
 * a manual step, which no API runs: the person runs it from the pipeline's
 * page. A pipeline runs again only whole, on the same commit. Docs relied
 * on:
 * - tags: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/
 * - Downloads: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-downloads/
 * - pipelines and their steps: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/
 */

const TagAnswer = Schema.Struct({
  name: Schema.String,
  target: Schema.Struct({ hash: Schema.String }),
  links: Schema.optional(Schema.Struct({ html: Schema.optional(Schema.Struct({ href: Schema.String })) })),
})
type TagAnswer = typeof TagAnswer.Type

const Downloads = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.optional(Schema.NullOr(Schema.Number)),
      links: Schema.optional(Schema.Struct({ self: Schema.optional(Schema.Struct({ href: Schema.String })) })),
    }),
  ),
})

const State = Schema.Struct({
  name: Schema.String,
  result: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  stage: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
})

const PipelineAnswer = Schema.Struct({
  uuid: Schema.String,
  build_number: Schema.Number,
  state: Schema.optional(Schema.NullOr(State)),
  target: Schema.Record(Schema.String, Schema.Unknown),
})
type PipelineAnswer = typeof PipelineAnswer.Type

const Steps = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      uuid: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      state: Schema.optional(Schema.NullOr(State)),
      trigger: Schema.optional(Schema.NullOr(Schema.Struct({ type: Schema.String }))),
    }),
  ),
})

/** A pipeline's state, as a check's. One paused or halted waits on a manual step. */
const pipelineState = (state: typeof State.Type | null | undefined): Run['state'] => {
  if (state == null || state.name === 'PENDING' || state.name === 'PAUSED' || state.name === 'HALTED') return 'queued'
  if (state.name === 'IN_PROGRESS' || state.name === 'RUNNING') return state.stage?.name === 'PAUSED' ? 'queued' : 'running'
  switch (state.result?.name) {
    case 'SUCCESSFUL':
      return 'passed'
    case 'STOPPED':
      return 'cancelled'
    default:
      return 'failed'
  }
}

/** The commit and the branch or tag a pipeline ran on, from its target. */
const targetOf = (pipeline: PipelineAnswer) => {
  const target = pipeline.target as { ref_name?: unknown; commit?: { hash?: unknown } }
  return {
    ref: typeof target.ref_name === 'string' ? target.ref_name : '',
    sha: typeof target.commit?.hash === 'string' ? target.commit.hash : null,
  }
}

/** A Downloads upload, as Bitbucket takes it: a multipart form whose `files` are the file. */
const formWith = (file: ReleaseUpload, boundary: string) => {
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name.replace(/["\r\n]/g, '_')}"\r\nContent-Type: ${file.mediaType}\r\n\r\n`,
  )
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.byteLength + file.bytes.byteLength + tail.byteLength)
  body.set(head, 0)
  body.set(file.bytes, head.byteLength)
  body.set(tail, head.byteLength + file.bytes.byteLength)
  return body
}

export const makeBitbucketCloudReleases = (input: {
  readonly http: Http
  readonly repo: (path: ReadonlyArray<string>) => string
}): HostReleases => {
  const { http, repo } = input
  const product = 'bitbucket_cloud' as const
  const gone = (error: ConnectorFailed) => error.reason === 'not_found'
  const tagOf = (repository: Repository, answer: TagAnswer) => ({
    name: answer.name,
    commit: answer.target.hash,
    url: answer.links?.html?.href ?? `${repository.webUrl}/src/${encodeURIComponent(answer.name)}`,
  })

  const tag: HostReleases['tag'] = (repository, name) =>
    http.json(TagAnswer, 'GET', `${repo(repository.path)}/refs/tags/${encodeURIComponent(name)}`).pipe(
      Effect.map((answer) => tagOf(repository, answer)),
      Effect.catchIf(gone, () => Effect.succeed(null)),
    )
  const make = (repository: Repository, name: string, commit: string) =>
    Effect.map(http.json(TagAnswer, 'POST', `${repo(repository.path)}/refs/tags`, { name, target: { hash: commit } }), (answer) =>
      tagOf(repository, answer),
    )
  const remove = (repository: Repository, name: string) =>
    http.json(Schema.Unknown, 'DELETE', `${repo(repository.path)}/refs/tags/${encodeURIComponent(name)}`).pipe(
      Effect.asVoid,
      Effect.catchIf(gone, () => Effect.void),
    )

  const downloads = (repository: Repository) =>
    Effect.map(http.json(Downloads, 'GET', `${repo(repository.path)}/downloads?pagelen=100`), (answer) =>
      answer.values.map((file) => ({ name: file.name, size: file.size ?? null, url: file.links?.self?.href ?? null })),
    )
  /** The tag as the release, with what Downloads holds: Bitbucket ties no file to a tag. */
  const release: HostReleases['release'] = (repository, name) =>
    Effect.gen(function* () {
      const found = yield* tag(repository, name)
      if (found === null) return null
      return {
        id: name,
        tag: name,
        name: null,
        state: 'tagged',
        url: `${repository.webUrl}/downloads/`,
        files: yield* downloads(repository),
      } satisfies Release
    })

  const gatesOf = (repository: Repository, pipeline: PipelineAnswer) =>
    Effect.gen(function* () {
      if (pipelineState(pipeline.state) !== 'queued') return []
      const steps = yield* http.json(Steps, 'GET', `${repo(repository.path)}/pipelines/${pipeline.build_number}/steps?pagelen=100`)
      return steps.values
        .filter((step) => /manual/i.test(step.trigger?.type ?? '') && (step.state == null || step.state.name === 'PENDING'))
        .map((step): Gate => ({
          id: step.uuid,
          name: step.name ?? 'a manual step',
          kind: 'manual_step',
          approvable: false,
          url: `${repository.webUrl}/pipelines/results/${pipeline.build_number}`,
        }))
    })
  const runOf = (repository: Repository, pipeline: PipelineAnswer) =>
    Effect.map(gatesOf(repository, pipeline), (gates): Run => ({
      id: String(pipeline.build_number),
      name: `Pipeline #${pipeline.build_number}`,
      ...targetOf(pipeline),
      state: pipelineState(pipeline.state),
      url: `${repository.webUrl}/pipelines/results/${pipeline.build_number}`,
      gates,
    }))

  return {
    releasing: 'downloads',
    commitOf: (repository, ref) =>
      Effect.map(
        http.json(Schema.Struct({ hash: Schema.String }), 'GET', `${repo(repository.path)}/commit/${encodeURIComponent(ref)}`),
        (commit) => commit.hash,
      ),
    tag,
    pushTag: (repository, wanted) =>
      Effect.gen(function* () {
        const now = yield* tag(repository, wanted.name)
        if (now !== null && now.commit === wanted.commit) return now
        if (now !== null && wanted.move !== true) return yield* tagTaken(product, wanted.name, now.commit)
        // Bitbucket can't move a tag: it is deleted, then made again where it is asked to be.
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
    release,
    publishRelease: (repository, name, wanted) =>
      Effect.gen(function* () {
        const files = wanted.files ?? []
        if (files.length === 0) return yield* noFiles(product)
        const there = new Set((yield* downloads(repository)).map((file) => file.name))
        // Each file once: one there already, by its name, isn't put there again.
        for (const file of files) {
          if (there.has(file.name)) continue
          const boundary = `althar-${createHash('sha256').update(file.bytes).digest('hex').slice(0, 24)}`
          yield* http.upload(
            Schema.Unknown,
            `${repo(repository.path)}/downloads`,
            formWith(file, boundary),
            `multipart/form-data; boundary=${boundary}`,
          )
        }
        const after = yield* release(repository, name)
        return after ?? { id: name, tag: name, name: null, state: 'tagged', url: `${repository.webUrl}/downloads/`, files: [] }
      }),
    runs: (repository, ref) =>
      Effect.gen(function* () {
        const { values } = yield* http.json(
          Schema.Struct({ values: Schema.Array(PipelineAnswer) }),
          'GET',
          `${repo(repository.path)}/pipelines?target.ref_name=${encodeURIComponent(ref)}&sort=-created_on&pagelen=20`,
        )
        return yield* Effect.forEach(
          values.filter((pipeline) => targetOf(pipeline).ref === ref),
          (pipeline) => runOf(repository, pipeline),
        )
      }),
    approveRun: (_repository, _run, gate) => Effect.fail(onlyOnTheHost(product, gate)),
    // A pipeline runs again only whole, as a new one on the same commit and ref: not its failed steps alone.
    rerunFailed: (repository, run) =>
      Effect.gen(function* () {
        const pipeline = yield* http.json(PipelineAnswer, 'GET', `${repo(repository.path)}/pipelines/${run.id}`)
        yield* http.json(Schema.Unknown, 'POST', `${repo(repository.path)}/pipelines`, { target: pipeline.target })
        return true
      }),
  }
}
