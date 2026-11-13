// @vitest-environment node
import { PAGE_OPS, type PageCall, type PageDone } from '@althar/runtime/pageBridge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * How the runtime's tools reach the page beside a conversation (ADR-100):
 * only the runtime process main started counts, the page an owner id names is
 * a task's or a project's, every field of a call is checked, and what can't
 * be read is answered in words. The windows' own calls about pages have no
 * way to drive one.
 */

const channels = vi.hoisted(() => ({ handled: new Array<string>(), listened: new Array<string>() }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string) => void channels.handled.push(channel),
    on: (channel: string) => void channels.listened.push(channel),
  },
}))

const { bridgeOf, callOf } = await import('../src/main/browser/bridge')
const { handlePages } = await import('../src/main/browser/ipc')

const TASK = `task_${'a1'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`

const RUNTIME = { name: 'the runtime' }
const OTHER = { name: 'a window or anything else' }

const setup = (
  drive: (owner: string, call: PageCall, signal?: AbortSignal) => Promise<PageDone> = async () => ({ value: { text: 'done' } }),
) => {
  const driven = vi.fn(drive)
  const reply = vi.fn()
  const bridge = bridgeOf({ pages: { drive: driven }, isRuntime: (from) => from === RUNTIME, reply })
  return { bridge, driven, reply }
}

/** Waits for the answer a message got. */
const answered = (reply: ReturnType<typeof vi.fn>) => vi.waitFor(() => expect(reply).toHaveBeenCalled())

describe('who reaches the pages', () => {
  it('answers the runtime process, to the process that asked', async () => {
    const { bridge, driven, reply } = setup()
    expect(bridge.handle(RUNTIME, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })).toBe(true)
    await answered(reply)
    expect(driven).toHaveBeenCalledWith(TASK, { op: 'state' }, expect.any(AbortSignal))
    expect(reply).toHaveBeenCalledWith(RUNTIME, 'r1', { value: { text: 'done' } })
  })

  it('ends a call the runtime gave up on, and answers it no more', async () => {
    let release = () => undefined as void
    const signals: Array<AbortSignal> = []
    const { bridge, reply } = setup(
      (_owner, _call, signal) =>
        new Promise((resolve) => {
          if (signal !== undefined) signals.push(signal)
          release = () => resolve({ value: { text: 'done late' } })
        }),
    )
    bridge.handle(RUNTIME, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    // Only the runtime ends one; anyone else's word is nothing.
    expect(bridge.handle(OTHER, { type: 'page-cancel', requestId: 'r1' })).toBe(false)
    expect(signals[0]?.aborted).toBe(false)
    expect(bridge.handle(RUNTIME, { type: 'page-cancel', requestId: 'r1' })).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    release()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(reply).not.toHaveBeenCalled()
    // Ending one nobody asked for, or one twice, is nothing too.
    expect(bridge.handle(RUNTIME, { type: 'page-cancel', requestId: 'r1' })).toBe(true)
    expect(bridge.handle(RUNTIME, { type: 'page-cancel', requestId: 'nobody' })).toBe(true)
  })

  it('drives a request once, where the same one comes twice while it is under way', async () => {
    let release = () => undefined as void
    const { bridge, driven, reply } = setup(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ value: { text: 'done' } })
        }),
    )
    bridge.handle(RUNTIME, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })
    bridge.handle(RUNTIME, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })
    await vi.waitFor(() => expect(driven).toHaveBeenCalledTimes(1))
    release()
    await answered(reply)
    expect(reply).toHaveBeenCalledTimes(1)
  })

  it('ignores every other sender: nothing is driven and nothing is answered', async () => {
    const { bridge, driven, reply } = setup()
    for (const from of [OTHER, undefined, null, 'runtime', 1, {}])
      expect(bridge.handle(from, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })).toBe(false)
    // An older runtime, one that has since been replaced, is another sender too.
    await Promise.resolve()
    expect(driven).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it('leaves alone a message that is not a page call', () => {
    const { bridge, driven } = setup()
    for (const message of [null, 'page', 7, { type: 'screenshot' }, { type: 'pages' }, {}])
      expect(bridge.handle(RUNTIME, message)).toBe(false)
    expect(driven).not.toHaveBeenCalled()
  })

  it('has no one to answer where a call names no request', () => {
    const { bridge, driven, reply } = setup()
    for (const requestId of [undefined, '', 7, 'x'.repeat(101)])
      expect(bridge.handle(RUNTIME, { type: 'page', requestId, owner: TASK, call: { op: 'state' } })).toBe(true)
    expect(driven).not.toHaveBeenCalled()
    expect(reply).not.toHaveBeenCalled()
  })

  it('has no channel by which a window or a page drives a page', () => {
    handlePages({} as Parameters<typeof handlePages>[0], () => true)
    const all = [...channels.handled, ...channels.listened]
    expect(all.length).toBeGreaterThan(5)
    for (const channel of all) {
      expect(channel, channel).toMatch(/^althar:pages?-/)
      expect(channel, channel).not.toMatch(/drive|agent|bridge|snapshot|click|evaluate|lead/i)
    }
  })
})

describe('whose page', () => {
  it('is a task’s or a project’s, named by the runtime from the session, and no other', async () => {
    const { bridge, driven, reply } = setup()
    for (const owner of [PROJECT, TASK]) bridge.handle(RUNTIME, { type: 'page', requestId: owner, owner, call: { op: 'state' } })
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    expect(driven.mock.calls.map(([owner]) => owner)).toEqual([PROJECT, TASK])
  })

  it('is refused in words where the id is anything else, and nothing is driven', async () => {
    const { bridge, driven, reply } = setup()
    const owners: ReadonlyArray<unknown> = [
      undefined,
      null,
      7,
      '',
      'task_1',
      `task_${'A1'.repeat(16)}`,
      `repo_${'a1'.repeat(16)}`,
      `${TASK}/../x`,
      { id: TASK },
    ]
    for (const [n, owner] of owners.entries()) bridge.handle(RUNTIME, { type: 'page', requestId: `r${n}`, owner, call: { op: 'state' } })
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(owners.length))
    for (const [, , done] of reply.mock.calls) expect(done).toEqual({ error: 'That isn’t a page Althar can open.' })
    expect(driven).not.toHaveBeenCalled()
  })

  it('says what went wrong where driving the page throws, never throwing itself', async () => {
    const { bridge, reply } = setup(async () => {
      throw new Error('Object has been destroyed')
    })
    bridge.handle(RUNTIME, { type: 'page', requestId: 'r1', owner: TASK, call: { op: 'state' } })
    await answered(reply)
    expect(reply).toHaveBeenCalledWith(RUNTIME, 'r1', { error: 'The page couldn’t do that: Object has been destroyed' })
  })

  it('gives the test hook the same path, with no sender to check', async () => {
    const { bridge, driven } = setup()
    expect(await bridge.request(TASK, { op: 'open', url: 'http://localhost:5173/' })).toEqual({ value: { text: 'done' } })
    expect(driven).toHaveBeenCalledWith(TASK, { op: 'open', url: 'http://localhost:5173/' }, undefined)
    expect(await bridge.request('nobody', { op: 'state' })).toEqual({ error: 'That isn’t a page Althar can open.' })
  })
})

/** Every call the tools make, whole. */
const CALLS: ReadonlyArray<PageCall> = [
  { op: 'state' },
  { op: 'open', url: 'localhost:5173' },
  { op: 'move', move: 'back' },
  { op: 'viewport', viewport: 'phone' },
  { op: 'snapshot', target: null },
  { op: 'snapshot', target: { ref: 'e3' } },
  { op: 'screenshot', target: { selector: 'main > .list' }, fullPage: false },
  { op: 'logs', since: 0, kind: 'all' },
  { op: 'click', target: { ref: 'e12' }, button: 'left', double: false },
  { op: 'hover', target: { selector: '.menu' } },
  { op: 'type', target: { ref: 'e5' }, text: 'refund', replace: true, submit: false },
  { op: 'press', key: 'Control+A', target: null },
  { op: 'scroll', target: null, to: 'down', by: null },
  { op: 'select', target: { ref: 'e8' }, values: ['es'] },
  { op: 'wait', text: 'Saved', gone: null, target: null, seconds: 10 },
  { op: 'evaluate', script: 'document.title' },
  { op: 'dialog', accept: true, text: null },
  { op: 'dialog', accept: false, text: 'a prompt’s answer' },
]

describe('a call, field by field', () => {
  it('covers every operation there is', () => {
    for (const op of PAGE_OPS)
      expect(
        CALLS.some((call) => call.op === op),
        op,
      ).toBe(true)
  })

  it.each(CALLS)('reads $op whole, as the tools make it', (call) => {
    expect(callOf(call)).toEqual(call)
  })

  it('takes a target a tool left out where it is optional, as none', () => {
    expect(callOf({ op: 'snapshot' })).toEqual({ op: 'snapshot', target: null })
    expect(callOf({ op: 'press', key: 'Enter' })).toEqual({ op: 'press', key: 'Enter', target: null })
    expect(callOf({ op: 'scroll' })).toEqual({ op: 'scroll', target: null, to: null, by: null })
  })

  it('names exactly one of a ref and a selector, and a ref is one the snapshot gives', () => {
    for (const target of [
      { ref: 'e1', selector: '.a' },
      {},
      { ref: 'x1' },
      { ref: 'e' },
      { ref: 'e12345678901' },
      { ref: 5 },
      { selector: '' },
      { selector: 'a'.repeat(4_001) },
      { selector: 3 },
      'e1',
    ])
      expect(callOf({ op: 'hover', target }), JSON.stringify(target)).toBe('That isn’t a request Althar’s pages take.')
    expect(callOf({ op: 'hover', target: { selector: 'a'.repeat(4_000) } })).toMatchObject({ op: 'hover' })
  })

  it('says to name an element where an action needs one', () => {
    const say = 'Say which element: a ref from page_snapshot, or a CSS selector.'
    expect(callOf({ op: 'click', button: 'left', double: false })).toBe(say)
    expect(callOf({ op: 'hover', target: null })).toBe(say)
    expect(callOf({ op: 'type', text: 'a', replace: true, submit: false })).toBe(say)
    expect(callOf({ op: 'select', values: ['a'] })).toBe(say)
  })

  it('refuses what is not a call, an operation it does not have, and fields of the wrong kind', () => {
    const bad = 'That isn’t a request Althar’s pages take.'
    for (const value of [null, 'click', 7, [], {}, { op: 'drive' }, { op: 5 }, { op: 'constructor' }, { op: '__proto__' }])
      expect(callOf(value), JSON.stringify(value)).toBe(bad)
    expect(callOf({ op: 'move', move: 'sideways' })).toBe(bad)
    expect(callOf({ op: 'viewport', viewport: 'watch' })).toBe(bad)
    expect(callOf({ op: 'screenshot', target: null })).toBe(bad)
    expect(callOf({ op: 'logs', since: -1, kind: 'all' })).toBe(bad)
    expect(callOf({ op: 'logs', since: 1.5, kind: 'all' })).toBe(bad)
    expect(callOf({ op: 'logs', since: 0, kind: 'everything' })).toBe(bad)
    expect(callOf({ op: 'click', target: { ref: 'e1' }, button: 'back', double: false })).toBe(bad)
    expect(callOf({ op: 'click', target: { ref: 'e1' }, button: 'left', double: 'yes' })).toBe(bad)
    expect(callOf({ op: 'type', target: { ref: 'e1' }, text: 5, replace: true, submit: false })).toBe(bad)
    expect(callOf({ op: 'type', target: { ref: 'e1' }, text: 'a', replace: 'yes', submit: false })).toBe(bad)
    expect(callOf({ op: 'scroll', target: null, to: 'sideways', by: null })).toBe(bad)
    expect(callOf({ op: 'scroll', target: null, to: null, by: Number.NaN })).toBe(bad)
    expect(callOf({ op: 'scroll', target: null, to: null, by: 1_000_000 })).toBe(bad)
  })

  it('keeps every string to its length, and refuses a NUL in one', () => {
    const bad = 'That isn’t a request Althar’s pages take.'
    expect(callOf({ op: 'open', url: '' })).toBe('That isn’t a web address. Give one such as http://localhost:5173/ or example.com.')
    expect(callOf({ op: 'open', url: `http://a.test/${'x'.repeat(8_192)}` })).toBe(
      'That isn’t a web address. Give one such as http://localhost:5173/ or example.com.',
    )
    expect(callOf({ op: 'open', url: 'http://a.test/\u0000' })).toBe(
      'That isn’t a web address. Give one such as http://localhost:5173/ or example.com.',
    )
    expect(callOf({ op: 'type', target: { ref: 'e1' }, text: 'x'.repeat(20_000), replace: true, submit: false })).toMatchObject({
      op: 'type',
    })
    expect(callOf({ op: 'type', target: { ref: 'e1' }, text: 'x'.repeat(20_001), replace: true, submit: false })).toBe(bad)
    expect(callOf({ op: 'type', target: { ref: 'e1' }, text: 'a\u0000b', replace: true, submit: false })).toBe(bad)
    expect(callOf({ op: 'press', key: 'k'.repeat(65), target: null })).toBe(bad)
    expect(callOf({ op: 'press', key: '', target: null })).toBe(bad)
    expect(callOf({ op: 'evaluate', script: '' })).toBe(bad)
    expect(callOf({ op: 'evaluate', script: 'x'.repeat(20_000) })).toMatchObject({ op: 'evaluate' })
    expect(callOf({ op: 'evaluate', script: 'x'.repeat(20_001) })).toBe(bad)
    expect(callOf({ op: 'evaluate', script: 7 })).toBe(bad)
    expect(callOf({ op: 'dialog', accept: true })).toEqual({ op: 'dialog', accept: true, text: null })
    expect(callOf({ op: 'dialog', accept: true, text: '' })).toEqual({ op: 'dialog', accept: true, text: '' })
    expect(callOf({ op: 'dialog', accept: 'yes' })).toBe(bad)
    expect(callOf({ op: 'dialog' })).toBe(bad)
    expect(callOf({ op: 'dialog', accept: true, text: 7 })).toBe(bad)
    expect(callOf({ op: 'dialog', accept: true, text: 'x'.repeat(20_001) })).toBe(bad)
  })

  it('keeps the choices to a hundred strings, and a wait to the seconds it may last', () => {
    const bad = 'That isn’t a request Althar’s pages take.'
    expect(callOf({ op: 'select', target: { ref: 'e1' }, values: [] })).toBe(bad)
    expect(callOf({ op: 'select', target: { ref: 'e1' }, values: Array.from({ length: 101 }, () => 'a') })).toBe(bad)
    expect(callOf({ op: 'select', target: { ref: 'e1' }, values: Array.from({ length: 100 }, () => 'a') })).toMatchObject({ op: 'select' })
    expect(callOf({ op: 'select', target: { ref: 'e1' }, values: [5] })).toBe(bad)
    for (const seconds of [0, 0.5, 61, Number.NaN, Number.POSITIVE_INFINITY, '10'])
      expect(callOf({ op: 'wait', text: 'a', gone: null, target: null, seconds }), String(seconds)).toBe(bad)
    for (const seconds of [1, 10, 60])
      expect(callOf({ op: 'wait', text: null, gone: null, target: null, seconds })).toMatchObject({ seconds })
    expect(callOf({ op: 'wait', text: '', gone: null, target: null, seconds: 5 })).toBe(bad)
    expect(callOf({ op: 'wait', text: 'a'.repeat(501), gone: null, target: null, seconds: 5 })).toBe(bad)
  })

  it('doesn’t carry anything it was not meant to: extra fields are left behind', () => {
    expect(callOf({ op: 'state', owner: 'task_x', extra: true })).toEqual({ op: 'state' })
    expect(callOf({ op: 'open', url: 'http://a.test/', owner: 'task_x' })).toEqual({ op: 'open', url: 'http://a.test/' })
  })
})

beforeEach(() => {
  channels.handled.length = 0
  channels.listened.length = 0
})
