import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'

import { connect } from '../src/AgentConnection'
import { nativeAgent, type NativeAgentOptions, type NativeProvider, type NativeRequest } from '../src/native/agent'

const model = { id: 'model', name: 'Test model', context: 128_000, output: 4096, images: true }
const provider = (
  complete: NativeProvider['complete'],
  models: Awaited<ReturnType<NativeProvider['models']>> = [model],
): NativeProvider => ({
  models: async () => models,
  complete,
})
const allow = () => Effect.succeed({ decision: 'allow' as const })
const folder = () => Effect.promise(() => mkdtemp(join(tmpdir(), 'althar-native-edges-')))

const open = (api: NativeProvider, cwd: string, options?: NativeAgentOptions) =>
  connect({ transport: { _tag: 'InProcess', agent: nativeAgent(api, options) }, onPermission: allow })

describe('the native agent loop at its edges', () => {
  it.live('says so when the account offers no models, and when a session is asked for more than it offers', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* folder()
        const none = yield* open(
          provider(async () => ({ text: '', tools: [] }), []),
          cwd,
        )
        const failed = yield* Effect.flip(none.newSession({ cwd, mode: 'ask' }))
        expect(JSON.stringify(failed)).toContain('no usable models')

        const connection = yield* open(
          provider(async () => ({ text: 'Hi.', tools: [] })),
          cwd,
        )
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        expect(yield* Effect.flip(session.setOption('model', 'missing'))).toMatchObject({ _tag: 'OptionUnavailable' })
        expect(yield* Effect.flip(session.setOption('nothing', 'x'))).toMatchObject({ _tag: 'OptionUnavailable' })
        yield* session.setOption('mode', 'read-only')
      }),
    ),
  )

  it.live('tells the model a tool it asked for is unavailable, and carries on', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* folder()
        const seen: Array<NativeRequest['messages'][number]> = []
        let calls = 0
        const api = provider(async (request) => {
          calls += 1
          if (calls === 1) return { text: 'Trying.', tools: [{ id: 'x-1', name: 'no_such_tool', input: {} }] }
          seen.push(...request.messages)
          return { text: 'Done.', tools: [], stopped: 'max_tokens', usage: { input: 3, output: 4 } }
        })
        const connection = yield* open(api, cwd)
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        const events = yield* Stream.runCollect(session.prompt('Go'))
        expect(JSON.stringify(seen.at(-1))).toContain('This tool is unavailable in ask mode: no_such_tool')
        expect(events.at(-1)).toMatchObject({ _tag: 'TurnEnded' })
      }),
    ),
  )

  it.live('reports a tool that fails to run, and one that runs a command, to the model', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* folder()
        const results: string[] = []
        let calls = 0
        const api = provider(async (request) => {
          calls += 1
          if (calls === 1)
            return {
              text: '',
              tools: [
                { id: 'r-1', name: 'read_file', input: { path: 'missing.txt' } },
                { id: 'c-1', name: 'run_command', input: { command: 'exit 3' } },
              ],
            }
          for (const message of request.messages) if (message.role === 'tool') results.push(JSON.stringify(message.content))
          return { text: 'Noted.', tools: [] }
        })
        const connection = yield* open(api, cwd)
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        yield* Stream.runDrain(session.prompt('Go'))
        expect(results).toHaveLength(2)
        expect(results[0]).toMatch(/ENOENT|no such file|missing\.txt/i)
      }),
    ),
  )

  it.live('refuses images for a model that cannot read them, and hides earlier ones from it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* folder()
        const api: NativeProvider = {
          models: async () => [{ ...model, images: false }],
          complete: async () => ({ text: 'Ok.', tools: [] }),
        }
        const connection = yield* open(api, cwd)
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        const events = yield* Stream.runCollect(session.prompt('Look', [{ data: 'aW1hZ2U=', mimeType: 'image/png' }])).pipe(Effect.flip)
        expect(JSON.stringify(events)).toContain('cannot read images')
      }),
    ),
  )

  it.live('says why a context that cannot shrink, or shrinks to nothing, ends the turn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* folder()
        const connection = yield* open(
          provider(async () => ({ text: '   ', tools: [] })),
          cwd,
        )
        const session = yield* connection.newSession({ cwd, mode: 'ask' })
        // Nothing to compact yet: only the system message.
        yield* Stream.runDrain(session.prompt('/compact'))
        yield* Stream.runDrain(session.prompt('One'))
        const failed = yield* Effect.flip(Stream.runDrain(session.prompt('/compact')))
        expect(JSON.stringify(failed)).toContain('returned no summary')
      }),
    ),
  )

  it.live(
    'reads the work file, repository instructions and skills into the instructions, unless untrusted, and drops commands offline',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* folder()
          const cwd = join(root, 'sub')
          yield* Effect.promise(async () => {
            await mkdir(join(root, '.git'), { recursive: true })
            await mkdir(cwd, { recursive: true })
            await writeFile(join(root, 'AGENTS.md'), 'ROOT RULES')
            await writeFile(join(cwd, 'AGENTS.md'), 'SUB RULES')
            await writeFile(join(root, 'work.md'), 'THE WORK')
            await mkdir(join(root, 'skills', 'good'), { recursive: true })
            await mkdir(join(root, 'skills', 'empty'), { recursive: true })
            await writeFile(join(root, 'skills', 'good', 'SKILL.md'), 'SKILL TEXT')
            await writeFile(join(root, 'skills', 'stray.txt'), 'x')
          })
          const run = (options: NativeAgentOptions) =>
            Effect.gen(function* () {
              let request: NativeRequest | undefined
              const api = provider(async (value) => {
                request = value
                return { text: 'Ok.', tools: [] }
              })
              const connection = yield* open(api, cwd, options)
              const session = yield* connection.newSession({ cwd, mode: 'ask' })
              yield* Stream.runDrain(session.prompt('Hi'))
              return request
            })
          const trusted = yield* run({ env: { ALTHAR_WORK: join(root, 'work.md') }, skills: join(root, 'skills') })
          const system = JSON.stringify(trusted?.messages[0])
          for (const text of ['THE WORK', 'ROOT RULES', 'SUB RULES', 'Available skill: good']) expect(system).toContain(text)
          expect(system).not.toContain('Available skill: empty')
          expect(trusted?.tools.some((tool) => tool.name === 'run_command')).toBe(true)

          const untrusted = yield* run({ untrusted: true, offline: true, env: { ALTHAR_WORK: join(root, 'missing.md') } })
          expect(JSON.stringify(untrusted?.messages[0])).not.toContain('ROOT RULES')
          expect(untrusted?.tools.some((tool) => tool.name === 'run_command')).toBe(false)
        }),
      ),
  )
})
