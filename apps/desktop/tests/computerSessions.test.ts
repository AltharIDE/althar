import { describe, expect, it, vi } from 'vitest'

import type { ComputerOwner, ComputerState } from '@althar/runtime/computerBridge'

import { computerSessions } from '../src/main/computer/sessions'
import { testComputerWorker } from '../src/main/computer/testNative'
import type { ComputerWorker } from '../src/main/computer/worker'

const TASK = `task_${'a'.repeat(32)}`
const OWNER: ComputerOwner = { taskId: TASK, sessionId: 'lead', turnId: 'turn', threadId: 'thread', title: 'Verify computer access' }
const signal = () => new AbortController().signal

const setup = (worker: () => ComputerWorker = testComputerWorker, canShareDisplay = () => true) => {
  const states: Array<ComputerState> = []
  const sessions = computerSessions({
    worker,
    changed: (state) => states.push(state),
    canAsk: () => true,
    canShareDisplay,
    available: () => true,
  })
  const ask = async (owner = OWNER, desktop = false) => {
    const approval = sessions.call(owner, { op: 'request', reason: 'Use Writer and Reader', desktop }, signal())
    await vi.waitFor(() => expect(states.at(-1)?.request).toBeDefined())
    const request = states.at(-1)!.request!
    return { approval, request }
  }
  return { sessions, states, ask }
}

describe('desktop access for a task', () => {
  it('keeps foreground window approval available when the display itself cannot be shared', async () => {
    const { sessions, ask } = setup(testComputerWorker, () => false)
    const { request, approval } = await ask(OWNER, true)
    const answer = { requestId: request.id, windows: [request.windows[0]!.id], foreground: true }
    expect(request.primaryDisplay).toBe(false)
    expect(sessions.allow(TASK, { ...answer, desktop: true })).toBe(false)
    expect(sessions.allow(TASK, { ...answer, desktop: false })).toBe(true)
    expect(await approval).toMatchObject({ value: { text: expect.stringContaining('"desktop":null,"foreground":true') } })
    sessions.stop(TASK)
  })

  it('restricts the grant to a live request and the windows the person selected', async () => {
    const { sessions, ask } = setup()
    const { approval, request } = await ask()
    const [writer, reader] = request.windows
    expect(sessions.allow(TASK, { requestId: request.id, windows: [writer!.id], desktop: true, foreground: false })).toBe(false)
    expect(sessions.allow(TASK, { requestId: 'stale', windows: [reader!.id], desktop: false, foreground: false })).toBe(false)
    expect(sessions.allow(TASK, { requestId: request.id, windows: [writer!.id], desktop: false, foreground: false })).toBe(true)
    expect(await approval).toMatchObject({ value: { text: expect.stringContaining('Writer') } })
    expect(await sessions.call(OWNER, { op: 'observe', target: reader!.id }, signal())).toMatchObject({
      error: expect.stringContaining('approved'),
    })
    expect(await sessions.call(OWNER, { op: 'observe', target: 'desktop' }, signal())).toMatchObject({
      error: expect.stringContaining('approved'),
    })
    expect(await sessions.call(OWNER, { op: 'observe', target: writer!.id }, signal())).toHaveProperty('value')
    expect(await sessions.call({ ...OWNER, turnId: 'next' }, { op: 'observe', target: writer!.id }, signal())).toHaveProperty('error')
  })

  it('can extend one task to another app and blocks an overlapping grant to another task', async () => {
    const { ask, sessions } = setup()
    const first = await ask()
    sessions.allow(TASK, { requestId: first.request.id, windows: [first.request.windows[0]!.id], desktop: false, foreground: false })
    await first.approval
    const second = await ask()
    expect(second.request.windows.map((one) => one.app)).toEqual(['Reader'])
    sessions.allow(TASK, { requestId: second.request.id, windows: [second.request.windows[0]!.id], desktop: false, foreground: false })
    const approved = await second.approval
    expect(approved).toMatchObject({ value: { text: expect.stringContaining('Writer') } })
    expect(approved).toMatchObject({ value: { text: expect.stringContaining('Reader') } })
    const other = { ...OWNER, taskId: `task_${'b'.repeat(32)}` }
    const third = await ask(other)
    expect(
      sessions.allow(other.taskId, {
        requestId: third.request.id,
        windows: [third.request.windows[0]!.id],
        desktop: false,
        foreground: false,
      }),
    ).toBe(false)
    sessions.stopAll('Done.')
    expect(await third.approval).toEqual({ error: 'Done.' })
  })

  it('stops a pending native call, then refuses input after taking over and stopping', async () => {
    const stopped = vi.fn(() => Promise.resolve())
    let finish: (() => void) | undefined
    const { sessions, ask } = setup(() => {
      const fallback = testComputerWorker()
      return {
        run: (call) =>
          call.op === 'act'
            ? new Promise((resolve) => {
                finish = () => resolve({ kind: 'acted', answer: { text: 'Late answer' } })
              })
            : fallback.run(call),
        stop: stopped,
      }
    })
    const { approval, request } = await ask()
    const target = request.windows[0]!.id
    sessions.allow(TASK, { requestId: request.id, windows: [target], desktop: false, foreground: false })
    await approval
    const press = { op: 'click' as const, target, observation: 'obs', at: { element: 'e1' } }
    const action = sessions.call(OWNER, press, signal())
    expect(sessions.pause(TASK)).toBe(true)
    expect(stopped).toHaveBeenCalledOnce()
    expect(await sessions.call(OWNER, press, signal())).toMatchObject({ error: expect.stringContaining('has control') })
    finish?.()
    expect(await action).toHaveProperty('error')
    expect(sessions.resume(TASK)).toBe(true)
    expect(sessions.stop(TASK)).toBe(true)
    expect(await sessions.call(OWNER, press, signal())).toMatchObject({ error: expect.stringContaining('first') })
  })
})
