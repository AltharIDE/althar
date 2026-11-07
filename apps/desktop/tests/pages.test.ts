import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CookieKeep } from '../src/main/browser/cookies'

/*
 * The pages beside the conversations as the main process holds them
 * (ADR-100), over a stand-in for Electron: where each is laid as windows
 * come and go, what a settled task's page does, and where a key pressed in a
 * page sends the keyboard. Electron's own objects are faked only as far as
 * pages.ts reaches them; a window that is gone throws as Electron's does.
 */

const electron = vi.hoisted(() => {
  type Listener = (...args: Array<unknown>) => void
  let ids = 0
  class Contents {
    readonly id = ++ids
    url = ''
    destroyed = false
    breaksOnClose = false
    readonly listeners = new Map<string, Array<Listener>>()
    readonly navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: () => {}, goForward: () => {} }
    readonly debugger = { isAttached: () => false, attach: () => {}, detach: () => {}, sendCommand: async () => ({}) }
    readonly focus = vi.fn()
    setWindowOpenHandler() {}
    on(name: string, listener: Listener) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
    emit(name: string, ...args: Array<unknown>) {
      for (const listener of this.listeners.get(name) ?? []) listener(...args)
    }
    getURL() {
      return this.url
    }
    getTitle() {
      return ''
    }
    isLoading() {
      return false
    }
    isDestroyed() {
      return this.destroyed
    }
    close() {
      if (this.breaksOnClose) throw new Error('Object has been destroyed')
      this.destroyed = true
    }
    async loadURL(url: string) {
      this.url = url
    }
    reload() {}
    stop() {}
    async executeJavaScriptInIsolatedWorld() {
      return null
    }
  }
  const views: Array<View> = []
  class View {
    readonly webContents = new Contents()
    visible = true
    constructor() {
      views.push(this)
    }
    setBounds() {}
    setVisible(visible: boolean) {
      this.visible = visible
    }
    setBackgroundColor() {}
  }
  const sessions = new Map<string, { readonly clearStorageData: ReturnType<typeof vi.fn> }>()
  const fromPartition = (partition: string) => {
    const found = sessions.get(partition)
    if (found !== undefined) return found
    const made = {
      setUserAgent: () => {},
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      setDevicePermissionHandler: () => {},
      on: () => {},
      clearStorageData: vi.fn(async () => {}),
      clearCache: async () => {},
      clearAuthCache: async () => {},
    }
    sessions.set(partition, made)
    return made
  }
  return { Contents, View, views, sessions, module: { WebContentsView: View, session: { fromPartition } } }
})

vi.mock('electron', () => electron.module)

const { startPages } = await import('../src/main/browser/pages')

type FakeView = InstanceType<typeof electron.View>

/** A window of Althar's: the views laid over it, its page's focus, and, once gone, throwing at whatever touches it, as Electron does. */
const windowOf = () => {
  let gone = false
  const children = new Set<unknown>()
  const touch = () => {
    if (gone) throw new Error('Object has been destroyed')
  }
  const window = {
    isDestroyed: () => gone,
    contentView: {
      addChildView: (view: unknown) => {
        touch()
        children.add(view)
      },
      removeChildView: (view: unknown) => {
        touch()
        children.delete(view)
      },
    },
    webContents: { getZoomFactor: () => 1, focus: vi.fn() },
  }
  return { window: window as unknown as Electron.BrowserWindow, raw: window, children, close: () => void (gone = true) }
}

const owner = (n: number) => `task_${n.toString(16).padStart(32, '0')}`
const PLACE = { x: 640, y: 120, width: 640, height: 700 }

let keep: CookieKeep = 'task'
let partitions = ''
const started = () => {
  const options = {
    overlay: () => '',
    keep: () => keep,
    partitions,
    outside: vi.fn(),
    tell: vi.fn(),
    pressed: vi.fn(),
    closed: vi.fn(),
    chrome: '130.0.0.0',
    agent: 'Mozilla/5.0 Chrome/130.0.0.0',
  }
  return { pages: startPages(options), options }
}

/** The view an owner's page was last laid out in, by the address it opened at. */
const viewAt = (address: string): FakeView | undefined => electron.views.findLast((view) => view.webContents.url === address)

beforeEach(() => {
  keep = 'task'
  partitions = mkdtempSync(join(tmpdir(), 'althar-partitions-'))
  electron.views.length = 0
  // Sessions last the process, as Electron's do: what each was asked is looked at afresh.
  for (const session of electron.sessions.values()) session.clearStorageData.mockClear()
})

describe('a page as windows come and go', () => {
  it('stays, hidden, as the window showing it closes, and shows again in a window opened after, never reaching the one gone', () => {
    const { pages } = started()
    const first = windowOf()
    pages.open(owner(1), 'http://localhost:5173/refunds')
    pages.show(first.window, owner(1), PLACE)
    const view = viewAt('http://localhost:5173/refunds')
    expect(first.children.has(view)).toBe(true)

    first.close()
    pages.hideIn(first.window)
    // The window opened after hears how it stands, and shows it where it was.
    expect(pages.states().map((state) => state.address)).toEqual(['http://localhost:5173/refunds'])
    const second = windowOf()
    expect(() => pages.show(second.window, owner(1), PLACE)).not.toThrow()
    expect(second.children.has(view)).toBe(true)
    expect(view?.visible).toBe(true)
  })

  it('is taken off a window whose document went, reloaded as the runtime restarts, until the new one shows it again', () => {
    const { pages } = started()
    const window = windowOf()
    pages.open(owner(1), 'http://localhost:5173/refunds')
    pages.open(owner(2), 'http://localhost:5173/other')
    pages.show(window.window, owner(1), PLACE)
    const view = viewAt('http://localhost:5173/refunds')
    const other = windowOf()
    pages.show(other.window, owner(2), PLACE)

    pages.hideIn(window.window)
    // Nothing of the reloaded window's says where the page goes: it isn't drawn over it, nor anywhere.
    expect(window.children.size).toBe(0)
    // Another window's page stays where it is.
    expect(other.children.size).toBe(1)
    // The new document hears how it stands, and lays it where it was again.
    expect(pages.states().map((state) => state.address)).toEqual(['http://localhost:5173/refunds', 'http://localhost:5173/other'])
    pages.show(window.window, owner(1), PLACE)
    expect(window.children.has(view)).toBe(true)
    expect(view?.webContents.destroyed).toBe(false)
  })

  it('moves to another window without touching one already gone, even before main hears it closed', () => {
    const { pages } = started()
    const first = windowOf()
    pages.open(owner(1), 'http://localhost:5173/')
    pages.show(first.window, owner(1), PLACE)
    first.close()
    const second = windowOf()
    expect(() => pages.show(second.window, owner(1), PLACE)).not.toThrow()
    expect(second.children.size).toBe(1)
    expect(() => pages.close(owner(1))).not.toThrow()
  })
})

describe('a page whose task settles', () => {
  it('closes, the windows hear it, and every settled owner’s session is cleared, even past one that can’t close', async () => {
    const { pages, options } = started()
    const shown = windowOf()
    pages.open(owner(1), 'http://localhost:5173/one')
    pages.open(owner(2), 'http://localhost:5173/two')
    pages.show(shown.window, owner(1), PLACE)
    shown.close()
    const breaks = viewAt('http://localhost:5173/two')
    if (breaks !== undefined) breaks.webContents.breaksOnClose = true
    // A task with no page this launch keeps only its folder on disk.
    const folder = join(partitions, `task-${'0'.repeat(31)}3`)
    mkdirSync(folder)

    await pages.moment('settled', [owner(1), owner(2), owner(3)])

    expect(options.closed.mock.calls).toEqual([[owner(1)], [owner(2)]])
    expect(pages.states()).toEqual([])
    expect(viewAt('http://localhost:5173/one')?.webContents.destroyed).toBe(true)
    expect(electron.sessions.get(`persist:task-${'0'.repeat(31)}1`)?.clearStorageData).toHaveBeenCalled()
    expect(electron.sessions.get(`persist:task-${'0'.repeat(31)}2`)?.clearStorageData).toHaveBeenCalled()
    expect(existsSync(folder)).toBe(false)
  })

  it('stays open where the person keeps cookies as long as each site asks', async () => {
    keep = 'site'
    const { pages, options } = started()
    pages.open(owner(1), 'http://localhost:5173/')
    await pages.moment('settled', [owner(1)])
    expect(options.closed).not.toHaveBeenCalled()
    expect(pages.states()).toHaveLength(1)
  })
})

describe('pages hidden past the few kept', () => {
  it('go to sleep with their sessions as they were, and wake where they were', () => {
    keep = 'page'
    const { pages, options } = started()
    const window = windowOf()
    for (const n of [1, 2, 3, 4]) {
      pages.open(owner(n), `http://localhost:5173/${n}`)
      pages.show(window.window, owner(n), PLACE)
      pages.show(window.window, owner(n), null)
    }
    // The one hidden longest is closed, and nothing it kept goes: for the person it never closed.
    expect(viewAt('http://localhost:5173/1')?.webContents.destroyed).toBe(true)
    expect(electron.sessions.get(`persist:task-${'0'.repeat(31)}1`)?.clearStorageData).not.toHaveBeenCalled()
    expect(options.closed).not.toHaveBeenCalled()
    // A window that asks hears of it as it will wake: where it was, without its history.
    expect(pages.states().find((state) => state.owner === owner(1))).toMatchObject({
      address: 'http://localhost:5173/1',
      back: false,
      forward: false,
      loading: false,
    })
    expect(pages.states()).toHaveLength(4)
    pages.show(window.window, owner(1), PLACE)
    const woke = viewAt('http://localhost:5173/1')
    expect(woke?.webContents.destroyed).toBe(false)
    expect(window.children.has(woke)).toBe(true)
  })
})

describe('a key pressed in the page', () => {
  const mod = process.platform === 'darwin' ? { meta: true, control: false } : { meta: false, control: true }
  const press = (view: FakeView | undefined, key: string) => {
    const event = { preventDefault: vi.fn() }
    view?.webContents.emit('before-input-event', event, { type: 'keyDown', key, shift: false, alt: false, ...mod })
    return event
  }

  it('⌘L gives the window the keyboard, for its address field', () => {
    const { pages, options } = started()
    const window = windowOf()
    pages.open(owner(1), 'http://localhost:5173/')
    pages.show(window.window, owner(1), PLACE)
    const event = press(viewAt('http://localhost:5173/'), 'l')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.raw.webContents.focus).toHaveBeenCalled()
    expect(options.pressed).toHaveBeenCalledWith(owner(1), 'address')
  })

  it('reaches no window that is gone', () => {
    const { pages, options } = started()
    const window = windowOf()
    pages.open(owner(1), 'http://localhost:5173/')
    pages.show(window.window, owner(1), PLACE)
    window.close()
    pages.hideIn(window.window)
    expect(() => press(viewAt('http://localhost:5173/'), 'l')).not.toThrow()
    expect(window.raw.webContents.focus).not.toHaveBeenCalled()
    expect(options.pressed).toHaveBeenCalledWith(owner(1), 'address')
  })
})
