import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { removeTree } from '@althar/testing'
import { until } from '@althar/testing/effect'
import { Deferred, Effect, Fiber, Stream } from 'effect'

import { connect } from '../src/AgentConnection'
import { nativeAgent, type NativeProvider, type NativeRequest } from '../src/native/agent'

const provider = (complete: NativeProvider['complete']): NativeProvider => ({
  models: async () => [{ id: 'model', name: 'Test model', context: 128_000, output: 4096, images: true }],
  complete,
})

describe('Althar’s native agent loop', () => {
  it.live('closes a native session’s MCP process and its child when its scope closes', () =>
    Effect.gen(function* () {
      const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-idle-')))
      yield* Effect.addFinalizer(() => Effect.promise(() => removeTree(cwd)))
      const script = join(cwd, 'server.cjs')
      const pidsFile = join(cwd, 'pids')
      yield* Effect.promise(() =>
        writeFile(
          script,
          `const fs = require('node:fs'); const { spawn } = require('node:child_process');
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
          fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, child.pid]));
          let input = ''; process.stdin.on('data', chunk => { input += chunk; let at;
            while ((at = input.indexOf('\\n')) >= 0) { const line = input.slice(0, at); input = input.slice(at + 1);
              const value = JSON.parse(line); if (value.id === undefined) continue;
              const result = value.method === 'initialize'
                ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
                : { tools: [] };
              process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }) + '\\n');
            }
          });`,
        ),
      )
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0)
          // Linux can retain an already-exited child as a zombie until its new parent reaps it.
          if (process.platform === 'linux' && readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)?.startsWith('Z')) return false
          return true
        } catch {
          return false
        }
      }
      const stopped: Array<boolean | undefined> = []
      const pids = yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connect({
            transport: {
              _tag: 'InProcess',
              agent: nativeAgent(
                provider(async () => ({ text: 'Ready.', tools: [] })),
                {
                  processes: {
                    starting: async () => 'fixture',
                    started: async () => {},
                    stopped: async (_id, report) => {
                      stopped.push(report?.survivors)
                    },
                  },
                },
              ),
            },
            onPermission: () => Effect.succeed({ decision: 'allow' }),
          })
          yield* connection.newSession({
            cwd,
            mode: 'ask',
            mcpServers: [{ type: 'stdio', name: 'fixture', command: process.execPath, args: [script], env: {} }],
          })
          const found = JSON.parse(yield* Effect.promise(() => readFile(pidsFile, 'utf8'))) as number[]
          expect(found).toHaveLength(2)
          expect(found.every(alive)).toBe(true)
          return found
        }),
      )
      expect([...stopped]).toEqual([false])
      yield* until(
        Effect.sync(() => pids.filter(alive)),
        (remaining) => remaining.length === 0,
        'the native MCP fixture and its child to exit',
      )
    }).pipe(Effect.scoped),
  )

  it.live('asks Althar before writing, sends the actual tool result to the model, and carries history into the next turn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        const requests: Array<Pick<NativeRequest, 'messages'>> = []
        const asked: string[] = []
        const api = provider(async (request) => {
          requests.push({ messages: structuredClone(request.messages) })
          if (requests.length === 1)
            return { text: '', tools: [{ id: 'write-1', name: 'write_file', input: { path: 'hello.txt', content: 'Hello from Althar' } }] }
          request.onText('Done.')
          return { text: 'Done.', tools: [] }
        })
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: (request) => Effect.sync(() => (asked.push(request.kind), { decision: 'allow' as const })),
        })
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        const events = yield* Stream.runCollect(session.prompt('Create hello.txt'))
        expect(yield* Effect.promise(() => readFile(join(cwd, 'hello.txt'), 'utf8'))).toBe('Hello from Althar')
        expect(asked).toEqual(['edit'])
        expect(requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'write-1' })
        expect(events.some((event) => event._tag === 'AgentMessage' && event.text === 'Done.')).toBe(true)
        yield* Stream.runDrain(session.prompt('What did you create?'))
        expect(requests[2]?.messages.some((message) => message.role === 'user' && message.content === 'Create hello.txt')).toBe(true)
      }),
    ),
  )

  it.live('returns a refusal to the model without executing the tool', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        let seen = 0
        let result = ''
        const api = provider(async (request) => {
          seen += 1
          if (seen === 1) return { text: '', tools: [{ id: 'write-1', name: 'write_file', input: { path: 'no.txt', content: 'No' } }] }
          const content = request.messages.at(-1)?.content
          result = typeof content === 'string' ? content : ''
          return { text: 'I left the file unchanged.', tools: [] }
        })
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: () => Effect.succeed({ decision: 'reject', reason: 'This repository is read only.', decidedBy: 'rules' }),
          permissions: { rejectAndContinue: ['reject'], rejectAndStop: [], allowScopes: { allow: 'once' }, reasonInBand: true },
        })
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        yield* Stream.runDrain(session.prompt('Write no.txt'))
        expect(result).toContain('This repository is read only')
        expect(
          yield* Effect.promise(() =>
            readFile(join(cwd, 'no.txt')).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }),
    ),
  )

  it.live('keeps read-only sessions from exposing or executing file writes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        let calls = 0
        const api = provider(async (request) => {
          expect(request.tools.some((tool) => ['write_file', 'edit_file', 'run_command'].includes(tool.name))).toBe(false)
          calls += 1
          return calls === 1
            ? { text: '', tools: [{ id: 'write-1', name: 'write_file', input: { path: 'no.txt', content: 'No' } }] }
            : { text: 'The file is unchanged.', tools: [] }
        })
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: () => Effect.die('A write must not ask in read-only mode.'),
        })
        const session = yield* connection.newSession({ cwd, mode: 'read-only' })
        yield* Stream.runDrain(session.prompt('Write no.txt'))
        expect(
          yield* Effect.promise(() =>
            readFile(join(cwd, 'no.txt')).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }),
    ),
  )

  it.live('repairs an interrupted tool exchange before accepting the next turn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        const waiting = yield* Deferred.make<void>()
        let calls = 0
        let after: ReadonlyArray<NativeRequest['messages'][number]> = []
        const api = provider(async (request) => {
          calls += 1
          if (calls === 1) return { text: '', tools: [{ id: 'write-1', name: 'write_file', input: { path: 'no.txt', content: 'No' } }] }
          after = request.messages
          return { text: 'Continuing.', tools: [] }
        })
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: () => Effect.andThen(Deferred.succeed(waiting, undefined), Effect.never),
        })
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        const running = yield* Effect.forkChild(Stream.runCollect(session.prompt('Write no.txt')))
        yield* Deferred.await(waiting)
        yield* session.cancel
        const cancelled = yield* Fiber.join(running)
        expect(cancelled.at(-1)).toMatchObject({ _tag: 'TurnEnded', stopReason: 'cancelled' })
        yield* Stream.runDrain(session.prompt('Continue without writing.'))
        expect(after.some((message) => message.role === 'tool' && message.toolCallId === 'write-1')).toBe(true)
        expect(
          yield* Effect.promise(() =>
            readFile(join(cwd, 'no.txt')).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }),
    ),
  )

  it.live('compacts through the model with no tools and keeps the result for later turns', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        const requests: Array<Pick<NativeRequest, 'messages' | 'purpose' | 'tools' | 'initiator'>> = []
        const api = provider(async (request) => {
          requests.push({
            messages: structuredClone(request.messages),
            tools: request.tools,
            initiator: request.initiator,
            ...(request.purpose ? { purpose: request.purpose } : {}),
          })
          return { text: request.purpose === 'compaction' ? 'Summary: inspect the existing implementation next.' : 'Ready.', tools: [] }
        })
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: () => Effect.succeed({ decision: 'allow' }),
        })
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        yield* Stream.runDrain(session.prompt('Inspect the implementation.'))
        yield* Stream.runDrain(session.prompt('/compact'))
        yield* Stream.runDrain(session.prompt('Continue.'))
        expect(requests[1]).toMatchObject({ purpose: 'compaction', tools: [], initiator: 'agent' })
        expect(requests[2]?.messages).toHaveLength(3)
        expect(requests[2]?.messages[1]?.content).toContain('Summary: inspect the existing implementation')
      }),
    ),
  )

  it.live('can change models and sends prompt images as images', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-')))
        let request: NativeRequest | undefined
        const api: NativeProvider = {
          models: async () => [
            { id: 'one', name: 'One', context: 128_000, output: 4096, images: true },
            { id: 'two', name: 'Two', context: 128_000, output: 4096, images: true, efforts: ['low', 'high'] },
          ],
          complete: async (value) => {
            request = value
            return { text: 'I see the image.', tools: [] }
          },
        }
        const connection = yield* connect({
          transport: { _tag: 'InProcess', agent: nativeAgent(api) },
          onPermission: () => Effect.succeed({ decision: 'allow' }),
        })
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        yield* session.setOption('model', 'two')
        yield* session.setOption('effort', 'high')
        yield* Stream.runDrain(session.prompt('Describe this.', [{ data: 'aW1hZ2U=', mimeType: 'image/png' }]))
        expect(request?.model.id).toBe('two')
        expect(request?.effort).toBe('high')
        expect(request?.messages.at(-1)?.content).toEqual([
          { type: 'text', text: 'Describe this.' },
          { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
        ])
      }),
    ),
  )
})
