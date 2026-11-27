// @vitest-environment node
import { EventEmitter } from 'node:events'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { describe, expect, it, vi } from 'vitest'

/*
 * A run's preview on a worker, opened from the Althar window (workerPreview.ts): in a window of its own, made once the
 * window's own open handler has answered, not as that window's child, and once for a run however often it's pressed.
 */

const made = vi.hoisted(() => ({ windows: [] as Array<{ options: Record<string, unknown> }> }))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeWindow extends Emitter {
    readonly webContents = Object.assign(new Emitter(), { id: 2, setWindowOpenHandler: () => {}, isDestroyed: () => false })
    constructor(readonly options: Record<string, unknown>) {
      super()
      made.windows.push(this)
    }
    isDestroyed = () => false
    show = vi.fn()
    focus = vi.fn()
    close = () => this.emit('closed')
    loadURL = async () => {}
  }
  return {
    BrowserWindow: FakeWindow,
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
        on: () => {},
        clearStorageData: async () => {},
        webRequest: { onBeforeRequest: () => {}, onBeforeSendHeaders: () => {} },
      }),
    },
  }
})

const { workerPreviews } = await import('../src/main/browser/workerPreview')

const address = `althar-preview://proc_${'a'.repeat(32)}.proj_${'b'.repeat(32)}/`
const owner = () =>
  Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }),
  }) as unknown as Electron.BrowserWindow

describe('a worker run’s preview', () => {
  it('opens in a window of its own once the Althar window’s open handler has answered, once however often it’s pressed', async () => {
    made.windows.length = 0
    // The home is never reached here: the preview's own connection waits.
    const show = workerPreviews(() => new Promise(() => {}))
    const window = owner()
    expect(show(window, 'https://example.com/')).toBe(false)
    expect(show(window, address)).toBe(true)
    expect(show(window, address)).toBe(true)
    // Not inside the handler that asked.
    expect(made.windows).toHaveLength(0)
    await nextTurn()
    expect(made.windows).toHaveLength(1)
    expect(made.windows[0]?.options).not.toHaveProperty('parent')
    expect(made.windows[0]?.options).toMatchObject({ title: 'Preview', webPreferences: { sandbox: true, nodeIntegration: false } })
    // Pressed again, the same window comes forward.
    expect(show(window, address)).toBe(true)
    await nextTurn()
    expect(made.windows).toHaveLength(1)
  })

  it('opens nothing for a window gone before it could', async () => {
    made.windows.length = 0
    const show = workerPreviews(() => new Promise(() => {}))
    const window = owner()
    Object.assign(window, { isDestroyed: () => true })
    expect(show(window, address)).toBe(true)
    await nextTurn()
    expect(made.windows).toHaveLength(0)
  })
})
