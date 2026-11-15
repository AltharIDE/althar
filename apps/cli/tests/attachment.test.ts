import { PassThrough, Readable, Writable } from 'node:stream'

import { ApiError, type ThreadSnapshot } from '@althar/contracts'
import { until } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Stream } from 'effect'

import { attachedSession, attachmentFailure, startCommand, type AttachedApi } from '../src/attachment'
import { parseAttachmentOptions } from '../src/attachmentOptions'
import { attachmentLines } from '../src/attachmentInput'
import { attachmentPrinter, terminalText } from '../src/attachmentPrinter'
import { terminalWrite } from '../src/terminalWrite'

const homeId = `home_${'1'.repeat(32)}`
const threadId = `thr_${'2'.repeat(32)}`
const projectId = `proj_${'3'.repeat(32)}`
const commandId = `cmd_${'4'.repeat(32)}`
const snapshot = (overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot =>
  ({
    threadId,
    cursor: 0,
    position: { homeId, cursor: 0, checkpoint: null },
    conversationVersion: 1,
    session: null,
    attention: [],
    items: [],
    ...overrides,
  }) as ThreadSnapshot
const textItem = (text: string) => ({ id: 'item', kind: 'agent_message' as const, content: { text } })
const fixture = (changes: Readonly<Record<string, unknown>> = {}) => {
  const calls: Array<{ method: string; payload: unknown }> = []
  const command = (method: string) => (payload: unknown) =>
    Effect.sync(() => {
      calls.push({ method, payload })
    })
  const api = {
    CreateTask: (payload: unknown) => Effect.as(command('CreateTask')(payload), { threadId }),
    StartSession: command('StartSession'),
    Send: command('Send'),
    SetModel: command('SetModel'),
    SwitchAgent: command('SwitchAgent'),
    StopSession: command('StopSession'),
    GetThread: () => Effect.succeed(snapshot()),
    WatchFrom: () => Stream.never,
    ...changes,
  } as unknown as AttachedApi
  const input = new PassThrough()
  let output = ''
  const io = {
    input,
    write: (text: string) =>
      Effect.sync(() => {
        output += text
      }),
  }
  return { api, calls, input, io, output: () => output }
}

describe('attached CLI', () => {
  it('requires an explicit target, pinned remote home and one task selection', () => {
    const remote = ['--ssh', 'fixture', '--home', homeId]
    assert.deepStrictEqual(parseAttachmentOptions(['attach', ...remote, '--thread', threadId]), {
      command: 'attach',
      target: { kind: 'ssh', ssh: { target: 'fixture' }, homeId },
      selection: { threadId },
    })
    const local = parseAttachmentOptions([
      'attach',
      '--profile',
      '/profile',
      '--project',
      projectId,
      '--task',
      ' Do it ',
      '--agent',
      'codex',
      '--model',
      'm',
      '--command-id',
      commandId,
    ])
    assert.deepStrictEqual(local, {
      command: 'attach',
      target: { kind: 'local', profile: '/profile' },
      selection: { projectId, title: 'Do it', agentId: 'codex', model: 'm', commandId },
    })
    assert.deepStrictEqual(
      parseAttachmentOptions([
        'inspect',
        ...remote,
        '--json',
        '--ssh-config',
        '/config',
        '--ssh-port',
        '2222',
        '--remote-launcher',
        '/launcher',
        '--remote-profile',
        '/p',
      ]).target,
      { kind: 'ssh', homeId, ssh: { target: 'fixture', configFile: '/config', port: 2222, launcher: '/launcher', profile: '/p' } },
    )
    assert.strictEqual(
      parseAttachmentOptions(['attach', '--profile', '/profile', '--home', homeId, '--project', projectId, '--task', 'x']).command,
      'attach',
    )
    for (const args of [
      [],
      ['wrong'],
      ['inspect'],
      ['inspect', '--profile', 'relative'],
      ['inspect', '--ssh', 'h', '--profile', '/p'],
      ['inspect', '--ssh', 'h', '--ssh', 'h'],
      ['inspect', '--ssh'],
      ['inspect', '--ssh', '--json'],
      ['inspect', '--ssh', 'h', '--json', '--json'],
      ['inspect', '--ssh', 'h', '--unknown', 'x'],
      ['inspect', 'oops'],
      ['inspect', '--profile', '/p', '--ssh-config', '/c'],
      ['inspect', '--ssh', 'h', '--home', 'wrong'],
      ['inspect', '--ssh', 'h', '--task', 'x'],
      ['attach', '--ssh', 'h', '--thread', threadId],
      ['attach', ...remote, '--json', '--thread', threadId],
      ['attach', ...remote, '--thread', 'wrong'],
      ['attach', ...remote, '--thread', threadId, '--model', 'x'],
      ['attach', ...remote, '--project', 'wrong', '--task', 'x'],
      ['attach', ...remote, '--project', projectId],
      ['attach', ...remote, '--project', projectId, '--task', 'x', '--command-id', 'bad'],
    ])
      assert.throws(() => parseAttachmentOptions(args))
  })
  it.live('creates with stable receipt ids, sends commands once, refuses approval and disconnects without stopping', () =>
    Effect.gen(function* () {
      const at = fixture()
      at.input.end('hello\n/interrupt now\n/model m\n/agent codex m\n/agent codex\n/allow\n/reject\n/help\n/wrong\n\n/quit\n/stop\n')
      yield* attachedSession(at.api, homeId, { projectId, title: 'Work', agentId: 'codex', model: 'm', commandId }, at.io)
      assert.deepStrictEqual(
        at.calls.map((call) => call.method),
        ['CreateTask', 'StartSession', 'Send', 'Send', 'SetModel', 'SwitchAgent', 'SwitchAgent'],
      )
      assert.deepStrictEqual(at.calls[0]?.payload, { commandId, projectId, title: 'Work' })
      assert.deepStrictEqual(at.calls[1]?.payload, { commandId: startCommand(commandId), threadId, agentId: 'codex', model: 'm' })
      assert.include(at.output(), 'cannot answer permissions')
      assert.include(at.output(), commandId)
      assert.isTrue(at.input.destroyed)
      const generated = fixture()
      generated.input.end('/quit\n')
      yield* attachedSession(generated.api, homeId, { projectId, title: 'Work', agentId: 'codex' }, generated.io)
      assert.match((generated.calls[0]!.payload as { commandId: string }).commandId, /^cmd_[a-f0-9]{32}$/)
    }),
  )
  it.live('joins without starting an agent; /stop alone stops it, EOF only disconnects and command failures stay visible', () =>
    Effect.gen(function* () {
      const at = fixture({ Send: () => Effect.fail(new ApiError({ reason: 'Rejected', message: 'Try again' })) })
      at.input.end('hello\n/stop\n')
      yield* attachedSession(at.api, homeId, { threadId }, at.io)
      assert.deepStrictEqual(
        at.calls.map((call) => call.method),
        ['StopSession'],
      )
      assert.include(at.output(), 'Rejected: Try again')
      assert.strictEqual(attachmentFailure(0), 'The attached client failed.')
      assert.strictEqual(attachmentFailure(new Error('x')), 'x')
    }),
  )
  it.live('resnapshots divergent history once and fails a disconnected feed without hanging on stdin', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let watches = 0
        const at = fixture({
          WatchFrom: () => {
            watches++
            return Stream.fail(new ApiError({ reason: 'SnapshotRequired', message: 'restored' }))
          },
        })
        const result = yield* Effect.flip(attachedSession(at.api, homeId, { threadId }, at.io))
        assert.strictEqual((result as ApiError).reason, 'SnapshotRequired')
        assert.strictEqual(watches, 2)
        const closed = fixture({ WatchFrom: () => Stream.empty })
        assert.strictEqual(
          ((yield* Effect.flip(attachedSession(closed.api, homeId, { threadId }, closed.io))) as ApiError).reason,
          'ConnectionClosed',
        )
        const wrong = fixture({
          GetThread: () => Effect.succeed(snapshot({ position: { homeId: `home_${'9'.repeat(32)}`, cursor: 0, checkpoint: null } })),
        })
        assert.strictEqual(
          ((yield* Effect.flip(attachedSession(wrong.api, homeId, { threadId }, wrong.io))) as ApiError).reason,
          'HomeMismatch',
        )
      }),
    ),
  )
  it.live('streams cumulative text, refreshes durable changes, and cancels cleanly while input is pending', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let read = 0
        const at = fixture({
          GetThread: () =>
            Effect.sync(() => {
              read++
              return snapshot()
            }),
          WatchFrom: () =>
            Stream.concat(
              Stream.fromIterable([
                {
                  _tag: 'Streaming' as const,
                  threadId,
                  itemId: 'item',
                  sequence: 1,
                  kind: 'agent_message' as const,
                  agentId: 'codex',
                  text: 'hello',
                },
                {
                  _tag: 'Streaming' as const,
                  threadId: 'other',
                  itemId: 'other',
                  sequence: 1,
                  kind: 'agent_message' as const,
                  agentId: 'codex',
                  text: 'hidden',
                },
                {
                  _tag: 'Changed' as const,
                  cursor: 1,
                  checkpoint: 'a'.repeat(32),
                  threadId,
                  projectId: null,
                  aggregateType: 'thread',
                  aggregateId: threadId,
                },
                {
                  _tag: 'Changed' as const,
                  cursor: 2,
                  checkpoint: 'b'.repeat(32),
                  threadId: null,
                  projectId: null,
                  aggregateType: 'other',
                  aggregateId: 'other',
                },
              ]),
              Stream.never,
            ),
        })
        const running = yield* Effect.forkScoped(attachedSession(at.api, homeId, { threadId }, at.io))
        yield* until(
          Effect.sync(() => read),
          (count) => count === 2,
        )
        yield* Fiber.interrupt(running)
        assert.include(at.output(), 'hello')
        assert.notInclude(at.output(), 'hidden')
        assert.isTrue(at.input.destroyed)
      }),
    ),
  )
  it('handles cumulative text, stale projections, revisions, conversation resets and terminal control bytes', () => {
    const out = attachmentPrinter()
    const stream = (text: string) =>
      out.streaming({ _tag: 'Streaming', threadId, itemId: 'item', sequence: 1, kind: 'agent_message', agentId: 'codex', text })
    assert.strictEqual(stream('hel'), '\nhel')
    assert.strictEqual(stream('hello'), 'lo')
    assert.strictEqual(stream('hel'), '')
    assert.strictEqual(stream('revised'), '\n[revised] revised')
    const item = textItem('revised') as ThreadSnapshot['items'][number]
    const snap = snapshot({ items: [item] })
    assert.include(out.snapshot(snap), 'No agent is running')
    assert.strictEqual(out.snapshot(snap), '')
    assert.include(out.snapshot({ ...snap, conversationVersion: 2 }), 'Conversation changed')
    assert.strictEqual(terminalText('a\x1b]52;c;secret\x07\r\nb\t\x9bc'), 'a]52;c;secret\nb\tc')
  })
  it('bounds input lines and handles split UTF-8 and output closure with backpressure', async () => {
    const bytes = Buffer.from('one\r\né\nlast')
    const lines: string[] = []
    for await (const line of attachmentLines(Readable.from([bytes.subarray(0, 6), bytes.subarray(6)]))) lines.push(line)
    assert.deepStrictEqual(lines, ['one', 'é', 'last'])
    for (const content of ['x'.repeat(1024 * 1024 + 1), `${'é'.repeat(1024 * 1024)}\n`]) {
      let rejected = false
      try {
        for await (const _line of attachmentLines(Readable.from([Buffer.from(content)]))) {
          /* Consume. */
        }
      } catch {
        rejected = true
      }
      assert.isTrue(rejected)
    }
    let text = ''
    const output = new Writable({
      write: (bytes, _encoding, done) => {
        text += String(bytes)
        done()
      },
    })
    await Effect.runPromise(terminalWrite(output, 'hello'))
    assert.strictEqual(text, 'hello')
    output.destroy()
    assert.include((await Effect.runPromise(Effect.flip(terminalWrite(output, 'ignored')))).message, 'closed')
  })
})
