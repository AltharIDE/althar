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
  const ask = async (owner = OWNER) => {
    const approval = sessions.call(owner, { op: 'request', reason: 'Use Writer and Reader' }, signal())
    await vi.waitFor(() => expect(states.findLast((one) => one.taskId === owner.taskId)?.request).toBeDefined())
    const request = states.findLast((one) => one.taskId === owner.taskId)!.request!
    return { approval, request }
  }
  /** Asked and allowed: the windows it may use, by their apps. */
  const allowed = async (owner = OWNER) => {
    const { approval, request } = await ask(owner)
    expect(sessions.allow(owner.taskId, { requestId: request.id, allow: true })).toBe(true)
    const done = await approval
    if (!('value' in done)) throw new Error(done.error)
    const granted = JSON.parse(done.value.text) as { readonly windows: ReadonlyArray<{ readonly id: string; readonly app: string }> }
    return Object.fromEntries(granted.windows.map((one) => [one.app, one.id]))
  }
  return { sessions, states, ask, allowed }
}

describe('desktop access for a task', () => {
  it('lets one answer take in every window, foreground input and the display, for that turn only', async () => {
    const { sessions, ask } = setup()
    const { approval, request } = await ask()
    expect(request.primaryDisplay).toBe(true)
    expect(sessions.allow(TASK, { requestId: 'stale', allow: true })).toBe(false)
    expect(sessions.allow(TASK, { requestId: request.id, allow: true })).toBe(true)
    const done = await approval
    expect(done).toMatchObject({ value: { text: expect.stringContaining('"desktop":"desktop","foreground":true') } })
    const { windows } = JSON.parse('value' in done ? done.value.text : '{}') as { windows: Array<{ id: string; app: string }> }
    expect(windows.map((one) => one.app)).toEqual(['Writer', 'Reader'])
    for (const one of windows) expect(await sessions.call(OWNER, { op: 'observe', target: one.id }, signal())).toHaveProperty('value')
    expect(await sessions.call(OWNER, { op: 'observe', target: 'desktop' }, signal())).toHaveProperty('value')
    expect(await sessions.call({ ...OWNER, turnId: 'next' }, { op: 'observe', target: windows[0]!.id }, signal())).toHaveProperty('error')
  })

  it('keeps foreground input where the display itself cannot be shared', async () => {
    const { sessions, ask } = setup(testComputerWorker, () => false)
    const { request, approval } = await ask()
    expect(request.primaryDisplay).toBe(false)
    sessions.allow(TASK, { requestId: request.id, allow: true })
    expect(await approval).toMatchObject({ value: { text: expect.stringContaining('"desktop":null,"foreground":true') } })
    expect(await sessions.call(OWNER, { op: 'observe', target: 'desktop' }, signal())).toMatchObject({
      error: expect.stringContaining('approved'),
    })
    sessions.stop(TASK)
  })

  it('ends the session when the person declines', async () => {
    const { sessions, states, ask } = setup()
    const { approval, request } = await ask()
    expect(sessions.allow(TASK, { requestId: request.id, allow: false })).toBe(true)
    expect(await approval).toEqual({ error: 'The person declined computer access.' })
    expect(states.at(-1)).toMatchObject({ phase: 'stopped', action: 'Computer access declined.' })
  })

  it('asks once a turn, keeping the ids it gave', async () => {
    const { sessions, states, allowed } = setup()
    const first = await allowed()
    const asked = states.filter((one) => one.request !== undefined).length
    const again = await sessions.call(OWNER, { op: 'request', reason: 'Find Reader again' }, signal())
    expect(states.filter((one) => one.request !== undefined)).toHaveLength(asked)
    expect(again).toMatchObject({ value: { text: expect.stringContaining(first.Reader!) } })
  })

  it('leaves an app another task is using to it until that turn ends', async () => {
    const { sessions, allowed } = setup()
    const mine = await allowed()
    expect(await sessions.call(OWNER, { op: 'observe', target: mine.Writer! }, signal())).toHaveProperty('value')
    const other = { ...OWNER, taskId: `task_${'b'.repeat(32)}` }
    const theirs = await allowed(other)
    expect(await sessions.call(other, { op: 'observe', target: theirs.Writer! }, signal())).toEqual({
      error: 'Another task is using Writer. Wait for its turn to end.',
    })
    expect(await sessions.call(other, { op: 'observe', target: theirs.Reader! }, signal())).toHaveProperty('value')
    sessions.ended(OWNER)
    // Once its helper has stopped.
    await vi.waitFor(async () =>
      expect(await sessions.call(other, { op: 'observe', target: theirs.Writer! }, signal())).toHaveProperty('value'),
    )
    sessions.stopAll('Done.')
  })

  it('keeps another task’s input to the whole display off an app it holds, and its apps off one that used the display', async () => {
    const { sessions, allowed } = setup()
    const mine = await allowed()
    expect(await sessions.call(OWNER, { op: 'observe', target: mine.Writer! }, signal())).toHaveProperty('value')
    const other = { ...OWNER, taskId: `task_${'b'.repeat(32)}` }
    await allowed(other)
    const click = { op: 'click' as const, target: 'desktop', observation: 'obs', at: { x: 40, y: 40 } }
    // It may look at the display, but not reach into Writer through it.
    expect(await sessions.call(other, { op: 'observe', target: 'desktop' }, signal())).toHaveProperty('value')
    expect(await sessions.call(other, click, signal())).toEqual({ error: 'Another task is using Writer. Wait for its turn to end.' })
    sessions.ended(OWNER)
    await vi.waitFor(async () => expect(await sessions.call(other, click, signal())).toHaveProperty('value'))
    // Having sent input to the whole display, it holds every app until its turn ends.
    const next = { ...OWNER, turnId: 'next' }
    const again = await allowed(next)
    const refused = { error: 'Another task is using the primary display. Wait for its turn to end.' }
    expect(await sessions.call(next, { op: 'observe', target: again.Reader! }, signal())).toEqual(refused)
    expect(await sessions.call(next, { ...click, target: again.Reader! }, signal())).toEqual(refused)
    expect(await sessions.call(next, click, signal())).toEqual(refused)
    sessions.ended(other)
    await vi.waitFor(async () =>
      expect(await sessions.call(next, { op: 'observe', target: again.Reader! }, signal())).toHaveProperty('value'),
    )
    sessions.stopAll('Done.')
  })

  it('stops a pending native call, then refuses input after taking over and stopping', async () => {
    const stopped = vi.fn(() => Promise.resolve())
    let finish: (() => void) | undefined
    const { sessions, allowed } = setup(() => {
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
    const target = (await allowed()).Writer!
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
