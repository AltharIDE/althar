import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from '../src/Artifacts'
import { evidenceGallery, galleryEditProblem } from '../src/evidenceGallery'
import { Queries } from '../src/Queries'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import type { ProjectId } from '@althar/domain'
import { RECORDING_GIF } from './recording'
import { callTool, runtime, task } from './support'

const picture = { sha256: 'a'.repeat(64), mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'panel.png' }
const shots = (names: ReadonlyArray<string>) => names.map((view) => ({ kind: 'screenshot', view, caption: view, picture }))

describe('the durable visual collection', () => {
  it.live('keeps an animated GIF’s original bytes as recording evidence', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, task: made } = yield* task('Show the panel opening')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId as ProjectId,
        threadId: made.threadId,
        sessionId: 'none',
        taskId: made.taskId,
      }
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
      const bytes = RECORDING_GIF
      writeFileSync(join(workspace?.path ?? '', 'opening.gif'), bytes)
      yield* callTool(lead, 'finish_step', {
        summary: 'The panel opens.',
        built: 'A panel.',
        evidence: [{ kind: 'recording', path: 'opening.gif', caption: 'Panel opening', view: 'Panel opening' }],
      })
      const collection = yield* evidenceGallery(made.threadId)
      assert.strictEqual(collection.shots[0]?.picture.mediaType, 'image/gif')
      const kept = yield* (yield* Artifacts).read(collection.shots[0]?.picture.digest ?? '')
      assert.deepStrictEqual(kept, new Uint8Array(bytes))
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: made.threadId }, 'step_result', { step: 'publish' })
      // A review or publication is not a new visual amendment.
      assert.isFalse((yield* evidenceGallery(made.threadId)).shots[0]?.earlier)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('keeps the whole feature in a fresh thread read after its evidence leaves the last 200 reports', () =>
    Effect.gen(function* () {
      const { project, task: made } = yield* task('Show the whole feature')
      const place = { projectId: project.projectId as ProjectId, threadId: made.threadId }
      yield* addItem(place, 'step_result', {
        step: 'implement',
        gallery: { mode: 'patch' },
        evidence: shots(Array.from({ length: 12 }, (_, i) => `Screen ${i}`)),
      })
      assert.lengthOf((yield* evidenceGallery(made.threadId)).shots, 12)
      yield* addItem(place, 'step_result', { step: 'settle', gallery: { mode: 'patch' }, evidence: shots(['Hover', 'Focus', 'Pressed']) })
      for (let i = 0; i < 201; i++) yield* addItem(place, 'step_result', { step: 'settle', summary: 'Checked', gallery: { mode: 'patch' } })
      const snapshot = yield* (yield* Queries).thread(made.threadId)
      assert.lengthOf(snapshot.reports, 200)
      assert.lengthOf(snapshot.gallery?.shots ?? [], 15)
      assert.isTrue(snapshot.gallery?.shots.every((shot) => shot.earlier))
      const sql = yield* SqlClient.SqlClient
      // Discarding the derived checkpoint (as on rebuild) produces the same collection from its immutable history.
      yield* sql`DELETE FROM evidence_galleries WHERE thread_id = ${made.threadId}`
      assert.deepStrictEqual(yield* evidenceGallery(made.threadId), snapshot.gallery)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('migrates only the legacy selection, then persists additions and explicit retirement', () =>
    Effect.gen(function* () {
      const { project, task: made } = yield* task('A feature and its amendment')
      const place = { projectId: project.projectId as ProjectId, threadId: made.threadId }
      yield* addItem(place, 'step_result', { step: 'implement', evidence: shots(['Rejected direction']) })
      yield* addItem(place, 'step_result', { step: 'implement', evidence: shots(['Built panel', 'Other screen']) })
      yield* addItem(place, 'step_result', { step: 'settle', gallery: { mode: 'patch' }, evidence: shots(['Button detail']) })
      const collection = yield* evidenceGallery(made.threadId)
      assert.deepStrictEqual(
        collection.shots.map((shot) => shot.key),
        ['Built panel', 'Other screen', 'Button detail'],
      )
      yield* addItem(place, 'step_result', {
        step: 'settle',
        gallery: { mode: 'patch', remove: ['Other screen'], invalidate: ['Built panel'] },
      })
      const now = yield* evidenceGallery(made.threadId)
      assert.deepStrictEqual(
        now.shots.map((shot) => shot.key),
        ['Built panel', 'Button detail'],
      )
      assert.isTrue(now.shots[0]?.needsRefresh)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it('refuses edits made from an old collection, unknown IDs, and ambiguous removal', () => {
    const collection = {
      revision: 12,
      shots: [
        {
          key: 'Panel',
          id: 'r1:0',
          caption: 'Panel',
          picture: { digest: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: null, unkept: null },
        },
      ],
    }
    assert.match(galleryEditProblem(collection, { mode: 'replace' }, undefined) ?? '', /read_gallery/)
    assert.match(galleryEditProblem(collection, { mode: 'patch' }, 11) ?? '', /changed since/)
    assert.match(galleryEditProblem(collection, { mode: 'patch', remove: ['Unknown'] }, 12) ?? '', /no view/)
    assert.match(galleryEditProblem(collection, { mode: 'patch', remove: ['Panel'], invalidate: ['Panel'] }, 12) ?? '', /same handoff/)
    assert.isNull(galleryEditProblem(collection, { mode: 'patch', remove: ['Panel'] }, 12))
  })

  it.live('exposes view IDs to the lead and refuses a stale removal without accepting the report', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, task: made } = yield* task('Amend a panel')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId as ProjectId,
        threadId: made.threadId,
        sessionId: 'none',
        taskId: made.taskId,
      }
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: made.threadId }, 'step_result', {
        step: 'implement',
        gallery: { mode: 'patch' },
        evidence: shots(['Panel']),
      })
      const read = JSON.parse(yield* callTool(lead, 'read_gallery', {})) as { revision: number; shots: ReadonlyArray<{ key: string }> }
      assert.strictEqual(read.shots[0]?.key, 'Panel')
      yield* callTool(lead, 'finish_step', { summary: 'Checked it', built: 'A panel.' })
      const before = yield* evidenceGallery(made.threadId)
      const refused = yield* callTool(lead, 'finish_step', {
        summary: 'Remove it',
        built: 'A panel.',
        gallery: { mode: 'patch', remove: ['Panel'] },
        expected_gallery_revision: read.revision,
      })
      assert.match(refused, /changed since/)
      assert.deepStrictEqual(yield* evidenceGallery(made.threadId), before)
      const [row] = yield* sql<{
        count: number
      }>`SELECT count(*) AS count FROM thread_items WHERE thread_id = ${made.threadId} AND kind = 'step_result'`
      assert.strictEqual(row?.count, 2)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
