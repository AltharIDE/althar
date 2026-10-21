import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'

import { type BackgroundEvent, takingBackground } from '../src/background'

/*
 * What an agent says of the commands it leaves running, taken off the stream
 * before the SDK reads it: each update as the agents send it, and those that
 * say too little to be one.
 */

const update = (fields: Record<string, unknown>, sessionId: unknown = 's1'): acp.AnyMessage =>
  ({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: fields } }) as acp.AnyMessage

/** Sends messages through, and says what the SDK would read and what was heard. */
const through = async (messages: ReadonlyArray<acp.AnyMessage>) => {
  const heard: Array<[string, BackgroundEvent]> = []
  const stream = takingBackground(
    {
      readable: new ReadableStream({ start: (controller) => (messages.forEach((m) => controller.enqueue(m)), controller.close()) }),
      writable: new WritableStream(),
    },
    (sessionId, event) => void heard.push([sessionId, event]),
  )
  const read: Array<acp.AnyMessage> = []
  for await (const message of stream.readable) read.push(message)
  return { heard, read }
}

describe('commands an agent leaves running', () => {
  it('names a command by its description where it has no name, or by nothing, and keeps where its output goes', async () => {
    const { heard } = await through([
      update({ sessionUpdate: 'async_task_spawned', asyncTaskId: 'bg-1', taskType: 'shell', description: 'Watch the tests' }),
      update({ sessionUpdate: 'async_task_spawned', asyncTaskId: 'bg-2', taskType: 'shell', outputFilePath: '/tmp/bg-2.log' }),
    ])
    expect(heard).toEqual([
      ['s1', { _tag: 'BackgroundStarted', id: 'bg-1', name: 'Watch the tests' }],
      ['s1', { _tag: 'BackgroundStarted', id: 'bg-2', name: '', outputPath: '/tmp/bg-2.log' }],
    ])
  })

  it('hears where output goes as it runs, and a command still running or paused as running', async () => {
    const { heard, read } = await through([
      update({ sessionUpdate: 'async_task_progress', asyncTaskId: 'bg-1', outputFilePath: '/tmp/bg-1.log' }),
      update({ sessionUpdate: 'async_task_progress', asyncTaskId: 'bg-1' }),
      update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'bg-1', state: 'running', outputFilePath: '/tmp/bg-1.log' }),
      update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'bg-1', state: 'paused' }),
      update({ sessionUpdate: 'async_task_state_update', asyncTaskId: 'bg-1', state: 'stopped' }),
    ])
    expect(heard).toEqual([
      ['s1', { _tag: 'BackgroundOutput', id: 'bg-1', outputPath: '/tmp/bg-1.log' }],
      ['s1', { _tag: 'BackgroundOutput', id: 'bg-1', outputPath: '/tmp/bg-1.log' }],
      ['s1', { _tag: 'BackgroundEnded', id: 'bg-1', end: 'stopped' }],
    ])
    // None of them reach the SDK, which would drop them anyway.
    expect(read).toEqual([])
  })

  it('takes off, unheard, those that say too little: no task, no session, or a kind it doesn’t know', async () => {
    const { heard, read } = await through([
      update({ sessionUpdate: 'async_task_spawned', taskType: 'shell', name: 'bun dev' }),
      update({ sessionUpdate: 'async_task_spawned', asyncTaskId: 'bg-1', taskType: 'shell', name: 'bun dev' }, 42),
      update({ sessionUpdate: 'async_task_renamed', asyncTaskId: 'bg-1', name: 'bun run dev' }),
    ])
    expect(heard).toEqual([])
    expect(read).toEqual([])
  })

  it('passes on everything else as it came', async () => {
    const others = [
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }),
      { jsonrpc: '2.0', method: 'session/update', params: 'not an object' } as unknown as acp.AnyMessage,
      { jsonrpc: '2.0', id: 1, result: {} } as acp.AnyMessage,
    ]
    const { heard, read } = await through(others)
    expect(heard).toEqual([])
    expect(read).toEqual(others)
  })
})
