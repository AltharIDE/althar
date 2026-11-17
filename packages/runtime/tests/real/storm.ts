import type { InProcessAgent } from '@althar/provider-adapters'
import { Effect, Layer } from 'effect'

import { type AgentEntry, Agents } from '../../src/Config'
import { fakeAgents } from '../support'

/*
 * Agents at work as hard as real ones, for the responsiveness run: the fake
 * agent, but where what it is told says `[storm]`, a turn of a working
 * agent's shape, which the fake has no marker for: message after message
 * streamed in small chunks, a tool call between each, until the turn is done
 * or cancelled; `[storm:until-stopped]`, until it is cancelled, as the turn a
 * press stops. Everything else is the fake's own. It sits on the ACP stream
 * between the runtime and the fake, so the runtime hears it as it hears any
 * agent: what it records, streams and works out again is all its own.
 */

export interface Storm {
  /** Messages in a turn, each followed by a tool call and its result. */
  readonly calls: number
  /** Chunks each message streams in. */
  readonly chunks: number
  /** Characters in each chunk. */
  readonly size: number
  /** How long between chunks, in ms, as a model streams. */
  readonly every: number
}

type Message = {
  readonly jsonrpc?: string
  readonly id?: string | number
  readonly method?: string
  readonly params?: { readonly sessionId?: string; readonly prompt?: unknown }
}

const pause = (ms: number) =>
  // oxlint-disable-next-line althar/one-clock -- the agent's own pace, as the fake's is
  new Promise((resolve) => setTimeout(resolve, ms))

const PROSE = 'The checkout retries once when the payment call fails, and the tests cover a dropped connection on the second try. '

/** The fake agent, with `[storm]` turns played in front of it. */
const storming = (inner: InProcessAgent, storm: Storm): InProcessAgent => ({
  _tag: 'InProcessAgent',
  // All the runtime asks of an agent in this process is to connect to it.
  app: {
    connect: ({ readable, writable }: { readable: ReadableStream<Message>; writable: WritableStream<Message> }) => {
      const toInner = new TransformStream<Message, Message>()
      const fromInner = new TransformStream<Message, Message>()
      const out = writable.getWriter()
      const peer = inner.app.connect({ readable: toInner.readable, writable: fromInner.writable } as never)
      const cancelled = new Set<string>()
      const send = (message: Message) => out.write({ jsonrpc: '2.0', ...message }).catch(() => undefined)
      const update = (sessionId: string, value: Record<string, unknown>) =>
        send({ method: 'session/update', params: { sessionId, update: value } as never })
      const turn = async (id: string | number, sessionId: string, stopped: boolean) => {
        cancelled.delete(sessionId)
        let stopReason = 'end_turn'
        // One that goes on until it is stopped ends by itself after a minute all the same, should nothing ever stop it.
        const until = Date.now() + 60_000
        for (let call = 0; (stopped ? Date.now() < until : call < storm.calls) && stopReason === 'end_turn'; call += 1) {
          for (let chunk = 0; chunk < storm.chunks; chunk += 1) {
            if (cancelled.has(sessionId)) break
            await update(sessionId, {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: PROSE.repeat(Math.ceil(storm.size / PROSE.length)).slice(0, storm.size) },
            })
            await pause(storm.every)
          }
          if (cancelled.has(sessionId)) stopReason = 'cancelled'
          else {
            const toolCallId = `storm-${Date.now().toString(36)}-${call}`
            await update(sessionId, {
              sessionUpdate: 'tool_call',
              toolCallId,
              title: 'Read src/checkout/payment.ts',
              kind: 'read',
              status: 'in_progress',
              rawInput: { path: 'src/checkout/payment.ts' },
            })
            await update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: { lines: 120 } })
          }
        }
        await send({ id, result: { stopReason } as never } as Message)
      }
      void (async () => {
        for await (const message of fromInner.readable) await out.write(message).catch(() => undefined)
      })()
      void (async () => {
        const forInner = toInner.writable.getWriter()
        for await (const message of readable) {
          const sessionId = message.params?.sessionId
          if (message.method === 'session/cancel' && sessionId !== undefined) cancelled.add(sessionId)
          const said = message.method === 'session/prompt' ? JSON.stringify(message.params?.prompt ?? '') : ''
          const stopped = said.includes('[storm:until-stopped]')
          if (message.id !== undefined && sessionId !== undefined && (stopped || said.includes('[storm]'))) {
            void turn(message.id, sessionId, stopped)
            continue
          }
          await forInner.write(message).catch(() => undefined)
        }
        await forInner.close().catch(() => undefined)
      })()
      return peer
    },
  } as unknown as InProcessAgent['app'],
})

/** The fake agents, each playing `[storm]` turns as `storm` says. */
export const stormingAgents = (storm: Storm) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const wrapped = (entry: AgentEntry): AgentEntry => ({
        ...entry,
        transport: (cwd, env, options) => {
          const transport = entry.transport(cwd, env, options)
          return transport._tag === 'InProcess' ? { _tag: 'InProcess', agent: storming(transport.agent, storm) } : transport
        },
      })
      return Agents.of({ list: agents.list.map(wrapped), get: (id) => Effect.map(agents.get(id), wrapped) })
    }),
  ).pipe(Layer.provide(fakeAgents()))
