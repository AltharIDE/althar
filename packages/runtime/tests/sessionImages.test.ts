import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { artifactPath } from '../src/artifactFiles'
import { COMPACT, errorClassOf, Sessions } from '../src/Sessions'
import { keepSent } from '../src/sentImages'
import * as Runtime from '../src/Runtime'
import { notices, runtime, task, turns, until } from './support'

/*
 * What a turn gives its agent of what waited for it, where images.test.ts
 * and compact.test.ts don't go: images the person sent that aren't kept any
 * more by the time the agent reads them, or that an agent which doesn't take
 * images never gets, and what was said before a compaction.
 */

/** A JPEG's start and its frame's header: enough for its kind and size. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0x90, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64')

/** Says something to a thread with no agent on it yet, with these images, kept as the window keeps them: what it kept. */
const sendWith = (projectId: string, threadId: string, body: string, images: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const kept = yield* keepSent(
      projectId as ProjectId,
      images.map((data, index) => ({ data, name: `shot-${index}.png` })),
    )
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, images: kept })
    return kept
  })

/** The thread's notices, once one is there that the check passes. */
const noticed = (threadId: string, check: (title: string) => boolean) =>
  Effect.map(
    until(
      Effect.map(notices(threadId), (said) => said.filter((notice) => check(notice.title ?? ''))),
      (said) => said.length > 0,
    ),
    (said) => said[0]?.title ?? '',
  )

describe('images the person sent that the agent never gets', () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-artifacts-'))

  it.live('says one is kept no more, and tells the agent it was there', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('Look at it')
      const [kept] = yield* sendWith(project.projectId, created.threadId, 'Look at this.', [SCREENSHOT_PNG])
      rmSync(artifactPath(root, kept?.sha256 ?? ''))
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
      assert.strictEqual(
        yield* noticed(created.threadId, (title) => title.includes('kept any more')),
        "An image you sent isn't kept any more. Fake codex didn't get it.",
      )
      const [first] = yield* until(turns(created.threadId), (rows) => rows[0]?.prompt != null)
      assert.include(first?.prompt ?? '', "Look at this.\n\n(The person sent an image with this, which Althar couldn't pass on to you.)")
    }).pipe(Effect.provide(runtime(':memory:', {}, { artifactsRoot: root }))),
  )

  it.live('says several are kept no more', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('Look at them')
      const kept = yield* sendWith(project.projectId, created.threadId, 'Compare these.', [SCREENSHOT_PNG, JPEG])
      for (const image of kept) rmSync(artifactPath(root, image.sha256))
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
      assert.strictEqual(
        yield* noticed(created.threadId, (title) => title.includes('kept any more')),
        "2 images you sent aren't kept any more. Fake codex didn't get them.",
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { artifactsRoot: root }))),
  )

  it.live("says one wasn't passed on to an agent that doesn't take images", () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('No pictures')
      yield* sendWith(project.projectId, created.threadId, 'Look at this.', [SCREENSHOT_PNG])
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'codex' })
      assert.strictEqual(
        yield* noticed(created.threadId, (title) => title.includes("doesn't take images")),
        "Fake codex doesn't take images. The image you sent wasn't passed on.",
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { each: { codex: { images: false } } }))),
  )
})

describe('what was said before a compaction', () => {
  it.live('goes to the agent in a turn of its own, before the compaction', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Compact later')
      for (const body of ['Hello.', COMPACT])
        yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: created.threadId, body })
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      const [first, second] = yield* until(turns(created.threadId), (rows) => rows.length === 2 && rows.every((row) => row.prompt != null))
      assert.isTrue(first?.prompt?.endsWith('Hello.'))
      assert.strictEqual(first?.inputs, 1)
      assert.deepStrictEqual([second?.prompt, second?.inputs], [COMPACT, 1])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('why a turn failed, as a class for the record', () => {
  it('is unknown where an agent’s request failed without saying how', () => {
    assert.strictEqual(errorClassOf(Option.some({ _tag: 'AgentRequestFailed' }), true), 'unknown')
  })
})
