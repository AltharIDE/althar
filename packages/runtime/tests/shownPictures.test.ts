import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from '../src/Artifacts'
import { PICTURE_KEPT } from '../src/handed'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, task, until } from './support'

/*
 * Pictures a lead shows the person in its thread at any time (show_pictures):
 * with no step open, as on a quick task or after its plan, and with one
 * open, each kept with its caption as a step's screenshots are, so it stays
 * once the file is gone; and what can't be shown, refused with why.
 */

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')

/** A quick task, with no plan and so no step, and its lead's access to Althar's tools. */
const quick = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { project, task: made } = yield* task('Show the retry')
  const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: made.threadId, sessionId: 'none', taskId: made.taskId }
  const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
  return { lead, threadId: made.threadId, taskId: made.taskId, worktree: workspace?.path ?? '' }
})

/** The pictures items of a thread, as a screen reads them. */
const shown = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* (yield* Queries).thread(threadId)
    return snapshot.items.flatMap((item) => (item.kind === 'pictures' ? [item] : []))
  })

describe('pictures a lead shows in its thread', () => {
  it.live('show with no step open, in order with their captions, and stay once the files are gone', () =>
    Effect.gen(function* () {
      const { lead, threadId, worktree } = yield* quick
      mkdirSync(join(worktree, 'test-results'), { recursive: true })
      writeFileSync(join(worktree, 'test-results', 'light.png'), PNG)
      mkdirSync(join(worktree, '.althar', 'scratch'), { recursive: true })
      writeFileSync(join(worktree, '.althar', 'scratch', 'dark.png'), PNG)
      // With no step open, finish_step has nothing to keep them in.
      const answer = yield* callTool(lead, 'show_pictures', {
        pictures: [
          { path: 'test-results/light.png', caption: ' Settings, light ' },
          { path: join(worktree, '.althar', 'scratch', 'dark.png'), caption: 'Settings, dark' },
        ],
      })
      assert.match(answer, /^Althar shows the 2 in the thread now/)
      const [item] = yield* shown(threadId)
      assert.deepStrictEqual(
        item?.content.pictures.map((piece) => piece.caption),
        ['Settings, light', 'Settings, dark'],
      )
      const digest = item?.content.pictures[0]?.picture.digest ?? null
      assert.match(digest ?? '', /^[0-9a-f]{64}$/)
      assert.strictEqual(item?.content.pictures[0]?.picture.mediaType, 'image/png')
      // Its copy is Althar's: the worktree's folders going doesn't take it.
      rmSync(join(worktree, 'test-results'), { recursive: true })
      rmSync(join(worktree, '.althar', 'scratch'), { recursive: true })
      const bytes = digest === null ? null : yield* (yield* Artifacts).read(digest)
      assert.deepStrictEqual(bytes === null ? null : Buffer.from(bytes), PNG)
      assert.strictEqual((yield* shown(threadId))[0]?.content.pictures.length, 2)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('show with a step open, in the lead’s turn, and needn’t be committed for the step to finish', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Show the retry',
        description: 'Work on it. [lead:wait]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: opened.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: 'draft',
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const [session] = yield* until(
        sql<{ id: string }>`
          SELECT s.id FROM provider_sessions s JOIN node_attempts a ON a.provider_session_id = s.id
          WHERE s.thread_id = ${created.threadId} AND a.state = 'running'`,
        (rows) => rows.length === 1,
      )
      const lead: ToolAccess = {
        role: 'lead',
        projectId: opened.projectId,
        threadId: created.threadId,
        sessionId: session?.id ?? '',
        taskId: created.taskId,
      }
      const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      const worktree = workspace?.path ?? ''
      // Not in the scratch folder, nor ignored: a picture shown is no work to commit.
      writeFileSync(join(worktree, 'retry.png'), PNG)
      assert.match(
        yield* callTool(lead, 'show_pictures', { pictures: [{ path: 'retry.png', caption: 'The retry button' }] }),
        /^Althar shows it in the thread now/,
      )
      const [item] = yield* shown(created.threadId)
      assert.strictEqual(item?.agentId, 'codex')
      const finished = yield* callTool(lead, 'finish_step', {
        summary: 'Showed it.',
        built: 'Nothing yet.',
        descriptions: [{ text: 'Nothing yet.' }],
      })
      assert.notMatch(finished, /aren't committed/)
      assert.match(finished, /^Althar has your summary/)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('are refused, saying why, where one can’t be shown', () =>
    Effect.gen(function* () {
      const { lead, threadId, worktree } = yield* quick
      const show = (pictures: ReadonlyArray<Record<string, unknown>>) => callTool(lead, 'show_pictures', { pictures })
      writeFileSync(join(worktree, 'after.png'), PNG)
      assert.match(yield* show([]), /^Name the pictures to show/)
      assert.match(yield* show([{ path: 'after.png', caption: '  ' }]), /^Picture 1 needs a caption/)
      assert.match(yield* show([{ path: ' ', caption: 'After' }]), /^Picture 1 needs its path in the worktree/)
      assert.match(yield* show([{ path: 'nowhere.png', caption: 'After' }]), /couldn’t find nowhere\.png in the task’s worktree/)
      // Nothing from outside the worktree, even through a link inside it.
      symlinkSync('/etc/hosts', join(worktree, 'hosts.png'))
      assert.match(yield* show([{ path: 'hosts.png', caption: 'Hosts' }]), /couldn’t find hosts\.png/)
      assert.match(yield* show([{ path: '/etc/hosts', caption: 'Hosts' }]), /couldn’t find \/etc\/hosts/)
      // Not a kind of picture the window draws, or not what its name says.
      writeFileSync(join(worktree, 'notes.txt'), 'words')
      assert.match(yield* show([{ path: 'notes.txt', caption: 'Notes' }]), /isn’t a picture Althar shows: a PNG, JPEG, GIF or WebP/)
      writeFileSync(join(worktree, 'fake.png'), 'not a picture')
      assert.match(
        yield* show([{ path: 'fake.png', caption: 'Fake' }]),
        /^fake\.png isn’t the picture its name says: its contents aren’t a PNG\.$/,
      )
      writeFileSync(join(worktree, 'named.jpg'), PNG)
      assert.match(yield* show([{ path: 'named.jpg', caption: 'Named' }]), /its contents aren’t a JPEG/)
      // Too large to keep.
      writeFileSync(join(worktree, 'huge.png'), PNG)
      truncateSync(join(worktree, 'huge.png'), PICTURE_KEPT * 1.1)
      assert.match(
        yield* show([{ path: 'huge.png', caption: 'Huge' }]),
        /^huge\.png is 22\.0 MB; Althar shows pictures up to 20 MB\. Take it smaller/,
      )
      assert.match(yield* show(Array.from({ length: 25 }, () => ({ path: 'after.png', caption: 'x' }))), /shows up to 24 at once/)
      // One refused refuses the show: none of it is in the thread.
      assert.match(
        yield* show([
          { path: 'after.png', caption: 'After' },
          { path: 'fake.png', caption: 'Fake' },
        ]),
        /^fake\.png isn’t the picture/,
      )
      assert.isEmpty(yield* shown(threadId))
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
