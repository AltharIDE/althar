import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import {
  builtIn,
  EVIDENCE_TEXT_KEPT,
  evidenceFiles,
  evidenceForReview,
  evidenceOf,
  readEvidence,
  textKept,
  unverifiedIn,
} from '../src/evidence'
import { PICTURE_KEPT } from '../src/handed'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, task } from './support'

/*
 * The evidence a lead handed, in the words its reviewer reads: each picture
 * and output written where the reviewer can read it, and what wasn't kept
 * said so; and the evidence a step result kept, read back whatever it holds.
 */

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')

const started = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { project, task: made } = yield* task('Show a retry')
  const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: made.threadId, sessionId: 'none', taskId: made.taskId }
  const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
  return { lead, threadId: made.threadId, worktree: workspace?.path ?? '' }
})

/** Where the reviewer's copy of the evidence goes: a folder not made yet. */
const reviewFolder = () => join(mkdtempSync(join(tmpdir(), 'althar-review-')), 'evidence')

describe('the evidence a reviewer reads', () => {
  it.live('writes each picture and output where it can be read, says how each ran, and which picture wasn’t kept', () =>
    Effect.gen(function* () {
      const { lead, threadId, worktree } = yield* started
      writeFileSync(join(worktree, 'after shot.png'), PNG)
      // Larger than Althar keeps of a picture: its bytes are never read.
      writeFileSync(join(worktree, 'whole page.png'), '')
      truncateSync(join(worktree, 'whole page.png'), PICTURE_KEPT + 1)
      const output = Array.from({ length: 2000 }, (_, index) => `test ${index} passed`).join('\n')
      const answer = yield* callTool(lead, 'finish_step', {
        built: 'A retry.',
        summary: 'Did it.',
        evidence: [
          { kind: 'screenshot', caption: 'The retry', path: 'after shot.png' },
          { kind: 'test_run', caption: 'Tests', command: 'bun test', exit_code: 1, output },
          { kind: 'log', caption: 'The server started', command: 'tail server.log', text: 'Listening on 5173\n' },
          { kind: 'response', caption: 'The API answered', text: '{"ok":true}' },
          { kind: 'screenshot', caption: 'The whole page', path: 'whole page.png' },
          { kind: 'note', caption: 'Nothing else moved' },
        ],
        unverified: ['Not tried on Windows'],
      })
      assert.strictEqual(answer, 'Althar has your summary.')

      const folder = reviewFolder()
      // What an earlier review was given is gone: the folder is made again.
      mkdirSync(folder)
      writeFileSync(join(folder, 'stale.txt'), 'From before.')
      const words = yield* evidenceForReview(threadId, folder)
      assert.strictEqual(
        words,
        [
          "The lead's evidence, each picture and output where you can read it:",
          `- screenshot: The retry: ${join(folder, '1-after-shot.png')}`,
          `- test run: Tests (\`bun test\`, exit 1): ${join(folder, '2-test_run.txt')}`,
          `- log: The server started (\`tail server.log\`): ${join(folder, '3-log.txt')}`,
          `- response: The API answered: ${join(folder, '4-response.txt')}`,
          '- screenshot: The whole page (not kept)',
          '- note: Nothing else moved',
          '',
          "What it says it couldn't show:",
          '- Not tried on Windows',
        ].join('\n'),
      )
      assert.deepStrictEqual(readdirSync(folder).toSorted(), ['1-after-shot.png', '2-test_run.txt', '3-log.txt', '4-response.txt'])
      assert.deepStrictEqual(readFileSync(join(folder, '1-after-shot.png')), PNG)
      // The end of a long output, as it was kept, saying how much of it went first, and how it ended.
      const kept = textKept(output)
      assert.isAbove(kept.dropped, 0)
      assert.strictEqual(
        readFileSync(join(folder, '2-test_run.txt'), 'utf8'),
        `$ bun test\n(${kept.dropped} earlier lines weren't kept)\n${kept.text}\n(exit 1)`,
      )
      // What ran without an exit, and what was said with nothing run, as they are.
      assert.strictEqual(readFileSync(join(folder, '3-log.txt'), 'utf8'), '$ tail server.log\nListening on 5173\n')
      assert.strictEqual(readFileSync(join(folder, '4-response.txt'), 'utf8'), '{"ok":true}')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says there was none, and names a picture kept without a name by what it is', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { lead, threadId, worktree } = yield* started
      const nothing = reviewFolder()
      assert.strictEqual(yield* evidenceForReview(threadId, nothing), "The lead handed no evidence.\n\nIt lists nothing it couldn't show.")
      assert.isFalse(existsSync(nothing))

      writeFileSync(join(worktree, 'before.png'), PNG)
      writeFileSync(join(worktree, 'after.png'), PNG)
      yield* callTool(lead, 'finish_step', {
        built: 'A retry.',
        summary: 'Did it.',
        evidence: [
          { kind: 'screenshot', caption: 'Before', path: 'before.png' },
          { kind: 'screenshot', caption: 'After', path: 'after.png' },
        ],
      })
      // As a step result an older Althar kept may have them: one with no name, one with an empty one.
      yield* sql`
        UPDATE thread_items SET content = json_set(content, '$.evidence[0].picture.name', NULL, '$.evidence[1].picture.name', '')
        WHERE thread_id = ${threadId} AND kind = 'step_result'`
      const folder = reviewFolder()
      assert.strictEqual(
        yield* evidenceForReview(threadId, folder),
        [
          "The lead's evidence, each picture and output where you can read it:",
          `- screenshot: Before: ${join(folder, '1-screenshot.png')}`,
          `- screenshot: After: ${join(folder, '2-picture')}`,
          '',
          "It lists nothing it couldn't show.",
        ].join('\n'),
      )
      assert.deepStrictEqual(readFileSync(join(folder, '2-picture')), PNG)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the picture evidence names', () => {
  it.live('is found in whichever of the task’s worktrees it is in, and refused where there is none, or it isn’t a file', () =>
    Effect.gen(function* () {
      const first = mkdtempSync(join(tmpdir(), 'althar-first-'))
      const second = mkdtempSync(join(tmpdir(), 'althar-second-'))
      mkdirSync(join(second, 'shots'))
      writeFileSync(join(second, 'shots', 'after.png'), PNG)
      const shot = { kind: 'screenshot', caption: 'After', path: join(second, 'shots', 'after.png') } as const

      const none = yield* Effect.flip(readEvidence([shot], []))
      assert.strictEqual(none.message, 'Althar keeps a screenshot only from the task’s worktree, and this has none.')

      const read = yield* readEvidence([shot, { kind: 'note', caption: 'Nothing else moved' }], [first, second])
      // Where it is, from the worktree it is in, so it isn't counted as left uncommitted there.
      assert.deepStrictEqual(evidenceFiles(read), [{ worktree: second, file: 'shots/after.png' }])
      assert.strictEqual(read[0]?.found?.name, 'after.png')
      assert.strictEqual(read[0]?.found?.size, PNG.length)
      assert.deepStrictEqual(Buffer.from(read[0]?.found?.bytes ?? []), PNG)
      assert.isNull(read[1]?.found)

      // A folder named like a picture isn't one.
      mkdirSync(join(first, 'shots.png'))
      const folder = yield* Effect.flip(readEvidence([{ kind: 'screenshot', caption: 'Shots', path: 'shots.png' }], [first, second]))
      assert.strictEqual(folder.message, 'shots.png isn’t a file.')
    }),
  )
})

describe('the evidence a step result kept', () => {
  it('is read back whatever it holds, leaving out what isn’t evidence', () => {
    assert.deepStrictEqual(evidenceOf(undefined), [])
    assert.deepStrictEqual(evidenceOf({ kind: 'note', caption: 'Not in a list' }), [])
    assert.deepStrictEqual(
      evidenceOf([null, 'note', ['note'], { kind: 'video', caption: 'A clip' }, { kind: 'note', caption: '' }, { kind: 'note' }]),
      [],
    )
    // What isn't what it should be reads as nothing said.
    assert.deepStrictEqual(
      evidenceOf([{ kind: 'command', caption: 'Lint', command: '', exit: '0', text: 7, dropped: 'many', picture: null }]),
      [{ kind: 'command', caption: 'Lint', picture: null, command: null, exit: null, text: null, dropped: 0 }],
    )
    const digest = 'a'.repeat(64)
    assert.deepStrictEqual(
      evidenceOf([
        {
          kind: 'screenshot',
          caption: 'After',
          picture: { sha256: digest, mediaType: 'image/png', bytes: 120, width: 2, height: 1, name: 'after.png' },
        },
        { kind: 'recording', caption: 'Too large', picture: { sha256: null, why: 'too_large', bytes: PICTURE_KEPT + 1, name: 'clip.gif' } },
        { kind: 'test_run', caption: 'Tests', command: 'bun test', exit: 0, text: 'All passed.', dropped: 3 },
      ]),
      [
        {
          kind: 'screenshot',
          caption: 'After',
          picture: { digest, mediaType: 'image/png', bytes: 120, width: 2, height: 1, name: 'after.png', unkept: null },
          command: null,
          exit: null,
          text: null,
          dropped: 0,
        },
        {
          kind: 'recording',
          caption: 'Too large',
          picture: {
            digest: null,
            mediaType: '',
            bytes: PICTURE_KEPT + 1,
            width: null,
            height: null,
            name: 'clip.gif',
            unkept: 'too_large',
          },
          command: null,
          exit: null,
          text: null,
          dropped: 0,
        },
        { kind: 'test_run', caption: 'Tests', picture: null, command: 'bun test', exit: 0, text: 'All passed.', dropped: 3 },
      ],
    )
  })

  it('says what couldn’t be shown only where it said, and what was built only where it said something', () => {
    // Not said: what an earlier step said stands.
    assert.isNull(unverifiedIn(undefined))
    assert.isNull(unverifiedIn('Not tried on Windows'))
    // Said, even as none: it clears what came before.
    assert.deepStrictEqual(unverifiedIn([]), [])
    assert.deepStrictEqual(unverifiedIn(['Not tried on Windows', '', 3, null, 'Not tried offline']), [
      'Not tried on Windows',
      'Not tried offline',
    ])
    assert.strictEqual(builtIn(' A retry on the checkout screen.\n'), 'A retry on the checkout screen.')
    assert.isNull(builtIn('  \n'))
    assert.isNull(builtIn(undefined))
    assert.isNull(builtIn(42))
  })

  it('keeps the end of a text with no line to cut at, whole from where it starts', () => {
    const unbroken = 'x'.repeat(EVIDENCE_TEXT_KEPT + 10)
    assert.deepStrictEqual(textKept(unbroken), { text: 'x'.repeat(EVIDENCE_TEXT_KEPT), dropped: 0 })
    // Its only line break its last character: nothing after it to start from.
    assert.deepStrictEqual(textKept(`${unbroken}\n`), { text: `${'x'.repeat(EVIDENCE_TEXT_KEPT - 1)}\n`, dropped: 0 })
  })
})
