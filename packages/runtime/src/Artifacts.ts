import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { type ArtifactKind, Ids, newId, type ProjectId, type Sensitivity } from '@althar/domain'
import { Context, type Crypto, Effect, Layer } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { artifactPath, isDigest } from './artifactFiles'
import { RuntimeConfig } from './Config'
import { timestamp } from './records'

/*
 * The artifact store (docs/architecture/07): bytes kept by their SHA-256 in
 * files under the profile, and in the database only what they are, how big,
 * and what refers to them. A picture an agent handed back or a command's
 * output is one, and so is an image the person sends with a message, never
 * a blob in a row, so neither the database nor its backups grow with them,
 * and the same picture twice is kept once. A file is
 * written aside, flushed, and renamed into place before its row is
 * committed, so a row never names a file that isn't there; a file without a
 * row is only space, for a later sweep. Without a folder for it, as in a
 * test that doesn't give one, nothing is kept.
 */

/** Where an artifact is referred to from: a thread's item, as a picture or as a command's output; or what the person said, as an image they sent with it. */
export type ArtifactSubject =
  | { readonly type: 'thread_item'; readonly id: string; readonly role: 'image' | 'output' }
  | { readonly type: 'user_input'; readonly id: string; readonly role: 'image' }

export interface KeepInput {
  readonly projectId: ProjectId
  readonly bytes: Uint8Array
  readonly mediaType: string
  readonly kind: ArtifactKind
  readonly sensitivity: Sensitivity
  readonly subject: ArtifactSubject
}

/** Bytes in the store already (`put`), to record: what they are, and what refers to them. */
export interface RecordInput extends Omit<KeepInput, 'bytes'> {
  readonly sha256: string
  readonly size: number
}

/** Bytes in the store, by their digest, with no row yet. */
export interface Put {
  readonly sha256: string
  readonly size: number
}

/** What is kept: the artifact, by its id and its digest, and how many bytes. */
export interface Kept {
  readonly id: string
  readonly sha256: string
  readonly size: number
}

export { artifactPath, isDigest } from './artifactFiles'

export class Artifacts extends Context.Service<
  Artifacts,
  {
    /** Where the bytes are, or null where nothing is kept. */
    readonly root: string | null
    /** Keeps bytes, and that the subject refers to them; null where there is no store or the file couldn't be written. */
    keep(input: KeepInput): Effect.Effect<Kept | null, never, SqlClient.SqlClient | Crypto.Crypto>
    /**
     * Writes bytes to the store, before any transaction, with no row: `record`
     * names them later, inside one. Null where there is no store or the file
     * couldn't be written.
     */
    put(bytes: Uint8Array): Effect.Effect<Put | null>
    /** Records bytes `put` before, and that the subject refers to them, in the caller's transaction; the artifact's id. */
    record(input: RecordInput): Effect.Effect<string, SqlError.SqlError, SqlClient.SqlClient | Crypto.Crypto>
    /** The bytes kept under a digest, or null where they aren't. */
    read(sha256: string): Effect.Effect<Uint8Array | null>
  }
>()('@althar/runtime/Artifacts') {
  static readonly layer: Layer.Layer<Artifacts, never, RuntimeConfig> = Layer.effect(
    Artifacts,
    Effect.gen(function* () {
      const root = (yield* RuntimeConfig).artifactsRoot ?? null

      /** Writes the bytes to their file, unless it is there already: aside first, flushed, then renamed into place. */
      const write = (folder: string, sha256: string, bytes: Uint8Array) =>
        Effect.tryPromise(async () => {
          const target = artifactPath(folder, sha256)
          const there = await stat(target).catch(() => undefined)
          if (there?.size === bytes.length) return
          const incoming = join(folder, '.incoming')
          await mkdir(incoming, { recursive: true })
          const aside = join(incoming, randomUUID())
          try {
            await writeFile(aside, bytes, { flush: true })
            await mkdir(dirname(target), { recursive: true })
            await rename(aside, target)
          } finally {
            await rm(aside, { force: true })
          }
        })

      const record = (input: RecordInput) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          // The same bytes in the same project are one artifact, referred to again.
          const [known] = yield* sql<{ id: string }>`
            SELECT id FROM artifacts WHERE project_id = ${input.projectId} AND sha256 = ${input.sha256} LIMIT 1`
          const id = known?.id ?? (yield* newId(Ids.artifact))
          if (known === undefined)
            yield* sql`
              INSERT INTO artifacts (id, project_id, sha256, size, media_type, kind, sensitivity, created_at)
              VALUES (${id}, ${input.projectId}, ${input.sha256}, ${input.size}, ${input.mediaType}, ${input.kind}, ${input.sensitivity}, ${at})`
          yield* sql`
            INSERT OR IGNORE INTO artifact_links (project_id, artifact_id, subject_type, subject_id, role, created_at)
            VALUES (${input.projectId}, ${id}, ${input.subject.type}, ${input.subject.id}, ${input.subject.role}, ${at})`
          return id
        })

      const put = (bytes: Uint8Array) =>
        Effect.gen(function* () {
          if (root === null) return null
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          yield* write(root, sha256, bytes)
          return { sha256, size: bytes.length } satisfies Put
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not write an artifact', cause), null)))

      const keep = (input: KeepInput) =>
        Effect.gen(function* () {
          if (root === null) return null
          const sha256 = createHash('sha256').update(input.bytes).digest('hex')
          // The file is in place before any row names it: no I/O inside the transaction.
          yield* write(root, sha256, input.bytes)
          const sql = yield* SqlClient.SqlClient
          const { bytes, ...rest } = input
          const id = yield* sql.withTransaction(record({ ...rest, sha256, size: bytes.length }))
          return { id, sha256, size: bytes.length } satisfies Kept
        }).pipe(
          // Keeping it is never worth losing the rest of the turn over: the item says it wasn't kept.
          Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not keep an artifact', cause), null)),
        )

      const read = (sha256: string) =>
        root === null || !isDigest(sha256)
          ? Effect.succeed(null)
          : Effect.promise(() =>
              readFile(artifactPath(root, sha256)).then(
                (bytes) => new Uint8Array(bytes),
                () => null,
              ),
            )

      return Artifacts.of({ root, keep, put, record, read })
    }),
  )
}
