import { randomBytes } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

import { MESSAGE_FILES, type SentFile } from '@althar/contracts'
import type { PromptFile } from '@althar/provider-adapters'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { attachmentsIn, copyName, copyTo, measure, mediaTypeOf, wordsOf } from './attachments'
import { RuntimeConfig } from './Config'
import { coordinatorFolderAt } from './coordinatorFolder'
import { FileRefused, NotFound } from './errors'
import { Folders } from './Folders'
import { Instance } from './Instance'

/*
 * The files and folders the person sends with a message (ADR-062): each by
 * the grant the app's main process gave for it as it was dropped, pasted or
 * picked, so the window never names a path; or one Althar copied before, as
 * when a message waiting its turn is taken back and sent again. Each is
 * measured (`MESSAGE_FILES`) and copied before the command that records the
 * message runs, so no file is copied inside its transaction, into the
 * folder its thread's agent starts from: a task's worktree, or the folder
 * holding its several, or the coordinator's folder, outside its copies of
 * the repositories, which are made fresh for each turn. There, under
 * `.althar/attachments`, every agent reads it as it reads the task's own
 * files, its sandbox unchanged; git ignores it, and it goes with the folder.
 */

/** A file or folder the person sent, copied, for its message to record. */
export interface InputFile {
  readonly name: string
  readonly kind: 'file' | 'folder'
  readonly mediaType: string | null
  readonly bytes: number
  readonly entries: number | null
  /** Where its copy is. */
  readonly path: string
}

/** A copy's id, as a message's item names it: its input's, and its place among the input's files. */
export const keptId = (inputId: string, position: number) => `${inputId}:${position}`

/**
 * The folder a thread's agent starts from, where the copies go: the
 * coordinator's, made where it isn't; a task's one worktree, or the folder
 * that holds its several, where they are ready on this computer; else null.
 */
const folderOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const config = yield* RuntimeConfig
    const [thread] = yield* sql<{ kind: string; projectId: string; slug: string }>`
      SELECT t.kind, t.project_id, p.slug FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ${threadId}`
    if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
    if (thread.kind === 'coordinator') return { projectId: thread.projectId, folder: coordinatorFolderAt(config.worktreeRoot, thread.slug) }
    const worktrees = yield* sql<{ path: string }>`
      SELECT w.path FROM threads t
      JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
      JOIN repository_bindings b ON b.id = w.binding_id
      WHERE t.id = ${threadId} ORDER BY b.created_at, b.rowid`
    const [first] = worktrees
    const folder = first === undefined || !existsSync(first.path) ? null : worktrees.length === 1 ? first.path : dirname(first.path)
    return { projectId: thread.projectId, folder }
  })

/** A name not yet taken in a message's folder: the file's own, or with a number before its extension. */
const freeName = (name: string, taken: Set<string>) => {
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  let candidate = name
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem} ${n}${extension}`
  taken.add(candidate.toLowerCase())
  return candidate
}

/** Reads, checks and copies the files sent with a message to a thread, in their order; refused whole where one can't be sent. */
export const keepFiles = (threadId: string, files: ReadonlyArray<SentFile>) =>
  Effect.gen(function* () {
    if (files.length === 0) return []
    if (files.length > MESSAGE_FILES.count) return yield* new FileRefused({ reason: 'too_many', name: null })
    const sql = yield* SqlClient.SqlClient
    const folders = yield* Folders
    const { projectId, folder } = yield* folderOf(threadId)
    if (folder === null) return yield* new FileRefused({ reason: 'nowhere', name: null })
    // What each is first, all of them, so nothing is copied for a message that is refused.
    const found = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        if ('kept' in file) {
          const [inputId, position] = file.kept.split(':')
          const [row] = yield* sql<Omit<InputFile, 'kind'> & { kind: string }>`
            SELECT name, kind, media_type, bytes, entries, path FROM user_input_files
            WHERE project_id = ${projectId} AND user_input_id = ${inputId ?? ''} AND position = ${Number(position)}`
          if (row === undefined || !existsSync(row.path)) return yield* new FileRefused({ reason: 'missing', name: row?.name ?? null })
          const kept: InputFile = { ...row, kind: row.kind === 'folder' ? 'folder' : 'file' }
          return { kept }
        }
        const source = yield* folders
          .path(file.grant)
          .pipe(Effect.catchTag('NotFound', () => new FileRefused({ reason: 'missing', name: null })))
        const name = copyName(source)
        const measured = measure(source)
        if (!measured.ok) return yield* new FileRefused({ reason: measured.why, name })
        return { source, name, measured }
      }),
    )
    const total = found.reduce((sum, one) => sum + ('kept' in one ? 0 : one.measured.bytes), 0)
    if (total > MESSAGE_FILES.total) return yield* new FileRefused({ reason: 'too_much', name: null })
    const fresh = found.some((one) => !('kept' in one))
    const own = fresh ? join(attachmentsIn(folder), randomBytes(6).toString('hex')) : null
    const taken = new Set<string>()
    // What is copied is counted again as it is, against the limits: what was measured may have grown since.
    let copiedBytes = 0
    return yield* Effect.forEach(found, (one) =>
      Effect.gen(function* () {
        if ('kept' in one) return one.kept
        const target = join(own ?? folder, freeName(one.name, taken))
        const room = MESSAGE_FILES.total - copiedBytes
        const copied = yield* Effect.tryPromise({
          try: () => copyTo(one.source, target, { bytes: Math.min(MESSAGE_FILES.bytes, room), entries: MESSAGE_FILES.entries }),
          catch: () => new FileRefused({ reason: 'unreadable', name: one.name }),
        })
        if (!copied.ok)
          return yield* copied.why === 'too_large' && room < MESSAGE_FILES.bytes
            ? new FileRefused({ reason: 'too_much', name: null })
            : new FileRefused({ reason: copied.why, name: one.name })
        copiedBytes += copied.bytes
        return {
          name: one.name,
          kind: copied.kind,
          mediaType: copied.kind === 'folder' ? null : mediaTypeOf(one.name),
          bytes: copied.bytes,
          entries: copied.entries,
          path: target,
        } satisfies InputFile
      }),
    ).pipe(
      // One that can't be copied refuses the message: what was copied for it goes.
      Effect.tapError(() => Effect.sync(() => own !== null && rmSync(own, { recursive: true, force: true }))),
    )
  })

/**
 * The files sent with each input, for a turn that delivers them, in order:
 * each by its copy's path, a small text file with its words, read now; and
 * how many of each input's copies aren't there any more, which the turn says.
 */
export const filesForTurn = (inputIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const files = new Map<string, Array<PromptFile>>()
    const gone = new Map<string, number>()
    if (inputIds.length === 0) return { files, gone }
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ userInputId: string; name: string; kind: string; mediaType: string | null; bytes: number; path: string }>`
      SELECT user_input_id, name, kind, media_type, bytes, path FROM user_input_files
      WHERE user_input_id IN ${sql.in(inputIds)} ORDER BY user_input_id, position`
    for (const row of rows) {
      if (!existsSync(row.path)) {
        gone.set(row.userInputId, (gone.get(row.userInputId) ?? 0) + 1)
        continue
      }
      const folder = row.kind === 'folder'
      const words = folder ? null : wordsOf(row.path, row.bytes)
      files.set(row.userInputId, [
        ...(files.get(row.userInputId) ?? []),
        { path: row.path, name: row.name, mimeType: row.mediaType, bytes: row.bytes, folder, ...(words === null ? {} : { text: words }) },
      ])
    }
    return { files, gone }
  })
