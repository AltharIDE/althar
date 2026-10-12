import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { EVIDENCE_TEXT_KEPT, textKept } from '../src/evidence'
import { evidenceText } from '../src/pullRequestWords'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, task } from './support'

/*
 * What a lead shows of its work as it finishes (finish_step's evidence): a
 * screenshot from its worktree, kept as a picture an agent hands back is; a
 * command with its exit and the end of what it printed; text; and what it
 * couldn't show. What can't be kept is refused with what to do about it.
 */

const started = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { project, task: made } = yield* task('Show a retry')
  const lead: ToolAccess = { role: 'lead', projectId: project.projectId, threadId: made.threadId, sessionId: 'none', taskId: made.taskId }
  const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${made.taskId}`
  return { lead, threadId: made.threadId, worktree: workspace?.path ?? '' }
})

const kept = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [item] = yield* sql<{ content: string }>`
      SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence DESC LIMIT 1`
    return JSON.parse(item?.content ?? '{}') as { evidence?: ReadonlyArray<Record<string, unknown>>; unverified?: ReadonlyArray<string> }
  })

describe('the evidence a lead hands', () => {
  it.live('keeps a screenshot from the worktree, a command, a note and what it couldn’t show', () =>
    Effect.gen(function* () {
      const { lead, threadId, worktree } = yield* started
      mkdirSync(join(worktree, 'shots'), { recursive: true })
      writeFileSync(join(worktree, 'shots', 'after.png'), Buffer.from(SCREENSHOT_PNG, 'base64'))
      const answer = yield* callTool(lead, 'finish_step', {
        summary: 'Did it.',
        evidence: [
          { kind: 'screenshot', caption: ' The retry, after ', path: 'shots/after.png' },
          { kind: 'command', caption: 'Lint', command: 'bun run check', exit_code: 0, output: 'No issues.\n' },
          { kind: 'note', caption: 'Nothing else changed on screen' },
        ],
        unverified: ['Not tried on Windows', ' ', 'Not tried on Windows'],
      })
      assert.strictEqual(answer, 'Althar has your summary.')
      const { evidence, unverified } = yield* kept(threadId)
      const [shot, lint, note] = evidence ?? []
      assert.strictEqual(shot?.caption, 'The retry, after')
      assert.strictEqual(shot?.path, 'shots/after.png')
      assert.match((shot?.picture as { sha256?: string } | undefined)?.sha256 ?? '', /^[0-9a-f]{64}$/)
      assert.deepStrictEqual(lint, {
        kind: 'command',
        caption: 'Lint',
        picture: null,
        path: null,
        command: 'bun run check',
        exit: 0,
        text: 'No issues.\n',
        dropped: 0,
      })
      assert.deepStrictEqual(note, {
        kind: 'note',
        caption: 'Nothing else changed on screen',
        picture: null,
        path: null,
        command: null,
        exit: null,
        text: null,
        dropped: 0,
      })
      assert.deepStrictEqual(unverified, ['Not tried on Windows'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('refuses what it can’t keep, saying what to do', () =>
    Effect.gen(function* () {
      const { lead, worktree } = yield* started
      const finish = (evidence: ReadonlyArray<Record<string, unknown>>) => callTool(lead, 'finish_step', { summary: 'Did it.', evidence })
      assert.match(yield* finish([{ kind: 'note', caption: '  ' }]), /^Evidence 1 needs a caption/)
      assert.match(yield* finish([{ kind: 'screenshot', caption: 'After' }]), /give the picture’s path in the worktree/)
      assert.match(
        yield* finish([{ kind: 'screenshot', caption: 'After', path: 'nowhere.png' }]),
        /couldn’t find nowhere\.png in the task’s worktree/,
      )
      assert.match(yield* finish([{ kind: 'command', caption: 'Tests' }]), /say what you ran/)
      // Not a picture the window draws.
      writeFileSync(join(worktree, 'clip.mp4'), 'not a picture')
      assert.match(yield* finish([{ kind: 'recording', caption: 'Clip', path: 'clip.mp4' }]), /isn’t a picture Althar shows/)
      // Nothing from outside the worktree, even through a link inside it.
      symlinkSync('/etc/hosts', join(worktree, 'hosts.png'))
      assert.match(yield* finish([{ kind: 'screenshot', caption: 'Hosts', path: 'hosts.png' }]), /couldn’t find hosts\.png/)
      assert.match(yield* finish([{ kind: 'screenshot', caption: 'Hosts', path: '/etc/hosts' }]), /couldn’t find \/etc\/hosts/)
      assert.match(yield* finish(Array.from({ length: 25 }, () => ({ kind: 'note', caption: 'x' }))), /keeps up to 24/)
    }).pipe(Effect.provide(runtime())),
  )

  it('keeps the end of a long output, from a line', () => {
    const lines = Array.from({ length: 4000 }, (_, index) => `line ${index}`)
    const { text, dropped } = textKept(lines.join('\n'))
    assert.isAtMost(text.length, EVIDENCE_TEXT_KEPT)
    assert.isTrue(text.startsWith('line '))
    assert.isTrue(text.endsWith('line 3999'))
    assert.strictEqual(dropped + text.split('\n').length, 4000)
    assert.deepStrictEqual(textKept('short'), { text: 'short', dropped: 0 })
  })
})

describe('evidence in the pull request', () => {
  const piece = { picture: null, command: null, exit: null, text: null }

  it('names pictures, quotes the end of what a command printed, and lists what wasn’t shown', () => {
    const output = Array.from({ length: 20 }, (_, index) => `ok ${index}`).join('\n')
    assert.strictEqual(
      evidenceText(
        [
          { ...piece, kind: 'screenshot', caption: 'After', picture: { digest: 'a' } },
          { ...piece, kind: 'test_run', caption: 'Tests', command: 'bun `test`', exit: 1, text: `${output}\n` },
          { ...piece, kind: 'note', caption: 'A typo: nothing to show' },
        ],
        ['Not tried on Windows'],
      ),
      [
        '### Evidence',
        '',
        '- Screenshot: After',
        "- Test run: Tests: `bun 'test'`, exit 1",
        '  …',
        '  ~~~~',
        ...Array.from({ length: 12 }, (_, index) => `  ok ${index + 8}`),
        '  ~~~~',
        '- Note: A typo: nothing to show',
        '',
        'Screenshots are in Althar, on the task.',
        '',
        '### Unverified',
        '',
        '- Not tried on Windows',
      ].join('\n'),
    )
  })

  it('fences a text its own fence can’t close, and says nothing with nothing shown', () => {
    assert.include(
      evidenceText([{ ...piece, kind: 'log', caption: 'Log', text: '~~~~\nin a fence' }], []),
      '  ~~~~~\n  ~~~~\n  in a fence\n  ~~~~~',
    )
    assert.strictEqual(evidenceText([], []), '')
  })
})
