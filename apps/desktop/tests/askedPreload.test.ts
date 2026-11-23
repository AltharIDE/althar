import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * What main sends as `althar:open` reaches the window's listener with whether the thread raised the prompt itself: held
 * for a page that listens later, as a window that just opened has none yet. Each test loads the preload afresh.
 */

const handlers = new Map<string, (...args: unknown[]) => void>()
const exposed: Record<string, any> = {}

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: unknown) => Object.assign(exposed, api) },
  ipcRenderer: {
    on: (channel: string, handler: (...args: unknown[]) => void) => void handlers.set(channel, handler),
    send: vi.fn(),
    invoke: vi.fn(async () => undefined),
    removeListener: vi.fn(),
  },
  webFrame: { setZoomFactor: vi.fn() },
}))

const load = async () => {
  await import('../src/preload/preload')
  return handlers.get('althar:open')!
}

describe('the open the preload forwards', () => {
  beforeEach(() => {
    vi.resetModules()
    handlers.clear()
  })

  it('says a prompt the thread raised itself, and a click on a notification, apart', async () => {
    const send = await load()
    const listener = vi.fn()
    exposed.onOpen(listener)
    send({}, 'th1', true)
    send({}, 'th2', false)
    send({}, 'th3')
    expect(listener.mock.calls).toEqual([
      ['th1', true],
      ['th2', false],
      ['th3', false],
    ])
  })

  it('holds one that came before the page listened, with its flag', async () => {
    const send = await load()
    send({}, 'th4', true)
    const late = vi.fn()
    exposed.onOpen(late)
    expect(late).toHaveBeenCalledWith('th4', true)
  })
})
