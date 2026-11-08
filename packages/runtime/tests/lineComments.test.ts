import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort, type LineComment, type ThreadSnapshot } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { keptIn, lineCommentsSaid, placeSaid, quoted, sentOf, touches, touchesAt, withLineComments, worktreeOf } from '../src/lineComments'
import { Secrets } from '../src/Secrets'
import { hunksOf } from '../src/taskFindings'

import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * Comments on lines of a task's diff (ADR-105): what the lead reads of them,
 * each with its file, its lines and the code quoted; how the thread keeps
 * them; and, once a commit changes their lines, that they are addressed.
 */

const ON_ROUTER: LineComment = {
  path: 'src/refunds/router.ts',
  side: 'new',
  start: 12,
  end: 13,
  code: [
    { kind: 'added', text: 'const limit = limiter(5)' },
    { kind: 'context', text: 'return limit.wrap(handler)' },
  ],
  note: 'Use the shared limiter here.',
}

const TAKEN_OUT: LineComment = {
  path: 'src/legacy/backoff.ts',
  side: 'old',
  start: 3,
  end: 3,
  under: 2,
  code: [{ kind: 'removed', text: 'const wait = 100' }],
  note: 'Keep this one.',
}

describe('what the lead reads of comments on the diff', () => {
  it('names each one’s file and lines, quotes its code in the file’s language, and gives what the person said', () => {
    assert.strictEqual(
      lineCommentsSaid([ON_ROUTER]),
      [
        'A comment on the diff:',
        'Comment 1, on `src/refunds/router.ts`, lines 12–13:',
        '```ts\nconst limit = limiter(5)\nreturn limit.wrap(handler)\n```',
        'Use the shared limiter here.',
      ].join('\n\n'),
    )
  })

  it('quotes lines taken out as a diff, says they were, and numbers several', () => {
    const said = lineCommentsSaid([ON_ROUTER, TAKEN_OUT])
    assert.isTrue(said.startsWith('2 comments on the diff:'))
    assert.include(said, 'Comment 2, on `src/legacy/backoff.ts`, line 3 as the file was before the change (taken out by it):')
    assert.include(said, '```diff\n- const wait = 100\n```')
    assert.strictEqual(placeSaid({ ...ON_ROUTER, end: 12 }), '`src/refunds/router.ts`, line 12')
  })

  it('fences code longer than the backticks in it, and leaves the language off a name without one', () => {
    assert.strictEqual(quoted({ path: 'Makefile', code: [{ kind: 'added', text: 'echo ```done```' }] }), '````\necho ```done```\n````')
  })

  it('goes after the person’s words, or alone without them; a message with none is as it was', () => {
    assert.strictEqual(withLineComments('Look at these.', []), 'Look at these.')
    assert.isTrue(withLineComments('  Look at these.\n', [ON_ROUTER]).startsWith('Look at these.\n\nA comment on the diff:'))
    assert.isTrue(withLineComments('', [ON_ROUTER]).startsWith('A comment on the diff:'))
    // A comment with nothing said of it still names its lines.
    assert.isTrue(lineCommentsSaid([{ ...ON_ROUTER, note: ' ' }]).endsWith('```'))
  })
})

describe('whether a change touches a comment’s lines', () => {
  it('touches what replaces, takes out or goes between them, never what is above or below', () => {
    // Line 12 replaced; lines 20–21 taken out; two put in after line 12; one put in after 13.
    assert.isTrue(touches(hunksOf('@@ -12 +12 @@'), 12, 13))
    assert.isTrue(touches(hunksOf('@@ -13,2 +13,0 @@'), 12, 13))
    assert.isTrue(touches(hunksOf('@@ -12,0 +13,2 @@'), 12, 13))
    assert.isFalse(touches(hunksOf('@@ -13,0 +14 @@'), 12, 13))
    assert.isFalse(touches(hunksOf('@@ -2,3 +2,5 @@\n@@ -20,2 +22,0 @@'), 12, 13))
  })

  it('touches where lines were taken out: something put back there, or a line beside it changed', () => {
    assert.isTrue(touchesAt(hunksOf('@@ -2,0 +3 @@'), 2))
    assert.isTrue(touchesAt(hunksOf('@@ -3 +3 @@'), 2))
    assert.isTrue(touchesAt(hunksOf('@@ -1 +1 @@'), 0))
    assert.isFalse(touchesAt(hunksOf('@@ -8 +8 @@'), 2))
  })
})

describe('a comment’s place and keeping', () => {
  it('is in the one worktree, or in the one its slug names for a task of several', () => {
    const one = [{ slug: 'web', path: '/w' }]
    const two = [...one, { slug: 'api', path: '/a' }]
    assert.deepStrictEqual(worktreeOf(one, 'src/a.ts'), { worktree: { slug: 'web', path: '/w' }, inside: 'src/a.ts' })
    assert.deepStrictEqual(worktreeOf(two, 'api/src/a.ts'), { worktree: { slug: 'api', path: '/a' }, inside: 'src/a.ts' })
    assert.isNull(worktreeOf(two, 'src/a.ts'))
    assert.isNull(worktreeOf([], 'src/a.ts'))
  })

  it('reads back what the message kept, leaving out what can’t be read, and shows each by its id without its tree', () => {
    const kept = keptIn([
      { ...TAKEN_OUT, tree: 'abc', code: [...TAKEN_OUT.code, { kind: 'moved', text: 'x' }] },
      { ...ON_ROUTER, tree: 7 },
      { path: 'a.ts', side: 'sideways', start: 1, end: 1, code: [], note: '' },
      { path: 'a.ts', side: 'new', start: 1, end: 1, code: 'x', note: '' },
      null,
    ])
    assert.deepStrictEqual(kept, [
      { ...TAKEN_OUT, tree: 'abc', head: null },
      { ...ON_ROUTER, tree: null, head: null },
    ])
    assert.deepStrictEqual(keptIn('nothing'), [])
    assert.deepStrictEqual(sentOf('item_1', kept), [
      { id: 'item_1:1', ...TAKEN_OUT },
      { id: 'item_1:2', ...ON_ROUTER },
    ])
  })
})

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a client on the other, as the window has it; a project open, with a task. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'althar-worktrees-'))
  yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(worktreeRoot, { recursive: true, force: true })))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot,
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(
    Layer.launch(
      connection(
        emitterPort(channel.port1, (data) => data),
        { kind: 'window' },
      ),
    ).pipe(Effect.provideContext(context)),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  const grant = Context.get(context, Folders).allow(repository())
  const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant })
  const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Retry checkout' })
  return { client, task }
})

const idle = (thread: ThreadSnapshot) => thread.session !== null && !thread.session.turnRunning
const replies = (thread: ThreadSnapshot) => thread.items.flatMap((item) => (item.kind === 'agent_message' ? [item.content.text] : []))

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@althar.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@althar.test',
    },
  }).toString()

describe('comments on the diff, from the window', () => {
  it.live(
    'reach the lead in its next turn with their file, lines and code, show on the message, and are addressed once a commit changes their lines',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, task } = yield* connected
          const { threadId } = task
          yield* client.StartSession({ commandId: commandId(), threadId, agentId: 'codex' })
          const started = yield* until(client.GetThread({ threadId }), (thread) => idle(thread) && thread.task.worktree !== null)
          const worktree = started.task.worktree ?? ''
          // What the lead wrote so far, not committed yet: the person comments on its second and third lines, and on the first.
          writeFileSync(join(worktree, 'notes.md'), 'one\ntwo\nthree\nfour\n')
          const onTwo: LineComment = {
            path: 'notes.md',
            side: 'new',
            start: 2,
            end: 3,
            code: [
              { kind: 'added', text: 'two' },
              { kind: 'added', text: 'three' },
            ],
            note: 'Say why these two.',
          }
          const onOne: LineComment = {
            path: 'notes.md',
            side: 'new',
            start: 1,
            end: 1,
            code: [{ kind: 'added', text: 'one' }],
            note: 'Fine.',
          }
          const before = replies(started).length
          yield* client.Send({
            commandId: commandId(),
            threadId,
            body: 'Two things.',
            disposition: 'after_current',
            comments: [onTwo, onOne],
          })
          const answered = yield* until(client.GetThread({ threadId }), (thread) => idle(thread) && replies(thread).length > before)

          // The lead's next turn read them after the person's words: each with its file, its lines and its code (the fake agent echoes what it reads).
          assert.strictEqual(replies(answered).at(-1), `echo: ${withLineComments('Two things.', [onTwo, onOne])}`)
          assert.include(replies(answered).at(-1), 'Comment 1, on `notes.md`, lines 2–3:\n\n```md\ntwo\nthree\n```\n\nSay why these two.')

          // The thread shows the person's words as they wrote them, and the comments beside them, each by its id.
          const message = answered.items.findLast((item) => item.kind === 'user_message')
          assert.strictEqual(message?.kind === 'user_message' ? message.content.text : undefined, 'Two things.')
          const itemId = message?.id ?? ''
          assert.deepStrictEqual(message?.kind === 'user_message' ? message.content.comments : undefined, [
            { id: `${itemId}:1`, ...onTwo },
            { id: `${itemId}:2`, ...onOne },
          ])

          const standing = () =>
            Effect.map(client.GetLineComments({ taskId: task.id }), (read) => read.comments.map((one) => [one.id, one.at, one.addressed]))
          assert.deepStrictEqual(yield* standing(), [
            [`${itemId}:1`, { path: 'notes.md', line: 2 }, false],
            [`${itemId}:2`, { path: 'notes.md', line: 1 }, false],
          ])
          const [first] = (yield* client.GetLineComments({ taskId: task.id })).comments
          assert.strictEqual(first?.itemId, itemId)
          assert.strictEqual(first?.sentAt, message?.createdAt)

          // Another part of the file committed alone, their lines still not committed as they were: not addressed.
          writeFileSync(join(worktree, 'notes.md'), 'four\n')
          git(worktree, 'add', '-A')
          git(worktree, 'commit', '-q', '-m', 'Four first')
          writeFileSync(join(worktree, 'notes.md'), 'one\ntwo\nthree\nfour\n')
          assert.deepStrictEqual(
            (yield* standing()).map(([, , addressed]) => addressed),
            [false, false],
          )

          // What it wrote committed as it was: nothing of them changed.
          git(worktree, 'add', '-A')
          git(worktree, 'commit', '-q', '-m', 'Notes')
          assert.deepStrictEqual(
            (yield* standing()).map(([, , addressed]) => addressed),
            [false, false],
          )

          // A heading put in above, and its third line changed, not committed yet: they move with their lines, still not addressed.
          writeFileSync(join(worktree, 'notes.md'), '# Notes\none\ntwo\nthree, because\nfour\n')
          assert.deepStrictEqual(yield* standing(), [
            [`${itemId}:1`, { path: 'notes.md', line: 3 }, false],
            [`${itemId}:2`, { path: 'notes.md', line: 2 }, false],
          ])

          // Committed, the comment on the line it changed is addressed; the one on a line it left alone isn't.
          git(worktree, 'commit', '-q', '-am', 'Say why')
          assert.deepStrictEqual(yield* standing(), [
            [`${itemId}:1`, { path: 'notes.md', line: 3 }, true],
            [`${itemId}:2`, { path: 'notes.md', line: 2 }, false],
          ])
        }),
      ),
  )
})
