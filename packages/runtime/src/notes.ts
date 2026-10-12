import { type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import { Commands } from '@althar/persistence-sqlite'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { NotFound } from './errors'
import { change, fact, timestamp } from './records'

/*
 * A project's notes (ADR-029): short decisions the person made in
 * conversation with the coordinator that the code doesn't show, such as
 * "issue drafts need an approval card, on every tracker". The coordinator
 * keeps them as the person makes them, and every session of it starts with
 * them, so a decision outlives the session it was made in. The person sees
 * them in the project's settings, and drops what no longer holds. A dropped
 * note keeps its row, so what it said stays on the record.
 */

/** How long a note may be: a decision, in a sentence or two. */
export const NOTE_LENGTH = 300

/** How many notes a project keeps at once, so every brief that holds them stays short. */
export const NOTES_KEPT = 40

export interface Note {
  readonly id: string
  readonly body: string
  readonly createdAt: string
  /** Who kept it: the coordinator, or the person. */
  readonly keptBy: 'coordinator' | 'person'
}

/** The project's notes, oldest first. */
export const notesOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; body: string; createdAt: string; kind: string }>`
      SELECT n.id, n.body, n.created_at, a.kind FROM project_notes n JOIN actors a ON a.id = n.created_by_actor_id
      WHERE n.project_id = ${projectId} AND n.dropped_at IS NULL ORDER BY n.created_at, n.rowid`
    return rows.map((row): Note => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      keptBy: row.kind === 'person' ? 'person' : 'coordinator',
    }))
  })

/** The notes as a brief or a tool lists them, one a line, by their ids; empty with none. */
export const sayNotes = (notes: ReadonlyArray<Note>) => notes.map((note) => `- ${note.id}: ${note.body}`).join('\n')

/** A note that can't be kept: too long, empty, or one too many. */
export class NoteRefused extends Schema.TaggedError<NoteRefused>()('NoteRefused', {
  why: Schema.Literals(['empty', 'long', 'full']),
}) {}

/** Keeps a note in the project, or finds the same words kept already. */
export const keepNote = (input: { readonly envelope: CommandEnvelope; readonly projectId: ProjectId; readonly body: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const body = input.body.trim().replace(/\s+/g, ' ')
    if (body === '') return yield* new NoteRefused({ why: 'empty' })
    if (body.length > NOTE_LENGTH) return yield* new NoteRefused({ why: 'long' })
    return yield* commands.execute({
      envelope: input.envelope,
      projectId: input.projectId,
      result: Schema.Struct({ noteId: Schema.String, kept: Schema.Boolean }),
      handle: Effect.gen(function* () {
        const kept = yield* sql<{ id: string; body: string }>`
          SELECT id, body FROM project_notes WHERE project_id = ${input.projectId} AND dropped_at IS NULL`
        // The same decision, kept twice, is one note.
        const same = kept.find((note) => note.body.toLowerCase() === body.toLowerCase())
        if (same !== undefined) return { noteId: same.id, kept: false }
        if (kept.length >= NOTES_KEPT) return yield* new NoteRefused({ why: 'full' })
        const noteId = yield* newId(Ids.projectNote)
        yield* sql`INSERT INTO project_notes ${sql.insert({
          id: noteId,
          projectId: input.projectId,
          body,
          createdByActorId: input.envelope.actorId,
          createdAt: yield* timestamp,
        })}`
        yield* fact({
          projectId: input.projectId,
          aggregateType: 'project_note',
          aggregateId: noteId,
          revision: 1,
          type: 'project_note.kept',
          payload: { body },
          actorId: input.envelope.actorId,
          commandId: input.envelope.commandId,
        })
        return { noteId, kept: true }
      }),
    })
  })

/** Drops one of a project's notes: it no longer holds. One dropped already stays dropped. */
export const dropNote = (input: { readonly envelope: CommandEnvelope; readonly projectId: string; readonly noteId: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands
    const [note] = yield* sql<{ projectId: ProjectId; droppedAt: string | null }>`
      SELECT project_id, dropped_at FROM project_notes WHERE id = ${input.noteId} AND project_id = ${input.projectId}`
    if (note === undefined) return yield* new NotFound({ kind: 'note', id: input.noteId })
    if (note.droppedAt !== null) return
    yield* commands.execute({
      envelope: input.envelope,
      projectId: note.projectId,
      result: Schema.Void,
      handle: Effect.gen(function* () {
        const revision = yield* change('project_notes', input.noteId, {
          droppedAt: yield* timestamp,
          droppedByActorId: input.envelope.actorId,
        })
        yield* fact({
          projectId: note.projectId,
          aggregateType: 'project_note',
          aggregateId: input.noteId,
          revision,
          type: 'project_note.dropped',
          actorId: input.envelope.actorId,
          commandId: input.envelope.commandId,
        })
      }),
    })
  })
