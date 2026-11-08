// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PageCall } from '@althar/runtime/pageBridge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The lead and the coordinator driving the page beside their conversation
 * (ADR-100), through `pages.drive`, over a stand-in for Electron and for the
 * in-page driver: what is refused and said, what is sent as real input, how
 * the person's own input wins, what is read, and the cases where the window
 * or the page isn't there. Electron's objects are faked only as far as
 * pages.ts reaches them.
 */

const electron = vi.hoisted(() => {
  type Listener = (...args: Array<any>) => void
  interface Image {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    resize(options: { width: number }): Image
    toPNG(): Buffer
  }
  const picture = (width: number, height: number): Image => ({
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    resize: ({ width: wanted }) => picture(wanted, Math.round((height * wanted) / width)),
    toPNG: () => Buffer.from(`png ${width}x${height}`),
  })
  /** The in-page driver's answers by method, with the arguments it was asked with; a test replaces what it needs. */
  type Driver = Record<string, (...args: Array<any>) => unknown>
  let ids = 0
  class Contents {
    readonly id = ++ids
    url = ''
    title = ''
    destroyed = false
    loading = false
    attached = false
    detaches = 0
    readonly listeners = new Map<string, Array<Listener>>()
    readonly commands: Array<{ method: string; params: Record<string, any> }> = []
    readonly worlds: Array<{ world: number; code: string }> = []
    readonly loaded: Array<string> = []
    readonly asks: Array<{ method: string; args: Array<any> }> = []
    /** How the page answers a DevTools command. */
    answers: Record<string, unknown> = {}
    driver: Driver = {}
    /** What running script `code` in world `world` gives, for the agent's own scripts. */
    evaluated: (code: string, world: number) => unknown = () => undefined
    shot: Image = picture(640, 700)
    history = { back: false, forward: false }
    readonly goBack = vi.fn()
    readonly goForward = vi.fn()
    readonly navigationHistory = {
      canGoBack: () => this.history.back,
      canGoForward: () => this.history.forward,
      goBack: this.goBack,
      goForward: this.goForward,
    }
    readonly captures: Array<unknown> = []
    /** Whether each script was run as a user gesture would let it, in order. */
    readonly gestures: Array<{ world: number; gesture: boolean }> = []
    /** What a DevTools command does before it answers: an answer of its own where it gives one (a promise that never settles, say). */
    onCommand: (method: string, params: Record<string, any>) => unknown = () => undefined
    readonly debuggerListeners = new Map<string, Array<Listener>>()
    /** The debugger telling of something in the page, as Chromium's DevTools does. */
    tellsOf(method: string, params: Record<string, unknown> = {}) {
      for (const listener of this.debuggerListeners.get('message') ?? []) listener({}, method, params)
    }
    readonly debugger = {
      isAttached: () => this.attached,
      attach: () => {
        this.attached = true
      },
      detach: () => {
        this.attached = false
        this.detaches += 1
      },
      sendCommand: async (method: string, params?: Record<string, any>) => {
        this.commands.push({ method, params: params ?? {} })
        const own = this.onCommand(method, params ?? {})
        if (own !== undefined) return own
        const answer = this.answers[method]
        if (answer instanceof Error) throw answer
        return answer ?? {}
      },
      on: (name: string, listener: Listener) => {
        this.debuggerListeners.set(name, [...(this.debuggerListeners.get(name) ?? []), listener])
      },
    }
    readonly focus = vi.fn()
    readonly reload = vi.fn()
    readonly stop = vi.fn()
    setWindowOpenHandler() {}
    on(name: string, listener: Listener) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
    removeListener(name: string, listener: Listener) {
      this.listeners.set(
        name,
        (this.listeners.get(name) ?? []).filter((one) => one !== listener),
      )
      return this
    }
    emit(name: string, ...args: Array<unknown>) {
      for (const listener of this.listeners.get(name) ?? []) listener(...args)
    }
    getURL() {
      return this.url
    }
    getTitle() {
      return this.title
    }
    isLoading() {
      return this.loading
    }
    isDestroyed() {
      return this.destroyed
    }
    close() {
      this.destroyed = true
    }
    async loadURL(url: string) {
      this.loaded.push(url)
      this.url = url
    }
    /** How the compositor answers for a picture; a test makes it never answer. */
    capturing: (rect?: unknown) => Promise<Image> = async () => this.shot
    async capturePage(rect?: unknown) {
      this.captures.push(rect)
      return this.capturing(rect)
    }
    async executeJavaScriptInIsolatedWorld(world: number, sources: ReadonlyArray<{ code: string }>, gesture = false) {
      const code = sources[0]?.code ?? ''
      this.worlds.push({ world, code })
      this.gestures.push({ world, gesture })
      const driving = /^globalThis\.__altharDriver\.(\w+)\((.*)\)$/s.exec(code)
      if (world === 7_301 && driving !== null) {
        const method = driving[1] ?? ''
        const args = JSON.parse(`[${driving[2] ?? ''}]`) as Array<unknown>
        this.asks.push({ method, args })
        const answer = this.driver[method]
        return answer === undefined ? { ok: true } : answer(...args)
      }
      if (world === 7_301) return true
      const value = this.evaluated(code, world)
      if (value instanceof Error) throw value
      return value
    }
  }
  const views: Array<View> = []
  class View {
    readonly webContents = new Contents()
    visible = true
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    constructor() {
      views.push(this)
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }) {
      this.bounds = bounds
    }
    getBounds() {
      return this.bounds
    }
    setVisible(visible: boolean) {
      this.visible = visible
    }
    setBackgroundColor() {}
  }
  interface FakeSession {
    readonly clearStorageData: ReturnType<typeof vi.fn>
    errored?: Listener
    completed?: Listener
    asked?: Listener
    readonly handlers: Map<string, Listener>
  }
  const sessions = new Map<string, FakeSession>()
  const fromPartition = (partition: string) => {
    const found = sessions.get(partition)
    if (found !== undefined) return found
    const made: FakeSession & Record<string, unknown> = {
      setUserAgent: () => {},
      setPermissionRequestHandler: (listener: Listener) => {
        made.asked = listener
      },
      setPermissionCheckHandler: () => {},
      setDevicePermissionHandler: () => {},
      handlers: new Map<string, Listener>(),
      webRequest: {
        onErrorOccurred: (listener: Listener) => {
          made.errored = listener
        },
        onCompleted: (listener: Listener) => {
          made.completed = listener
        },
      },
      on: (name: string, listener: Listener) => {
        made.handlers.set(name, listener)
      },
      clearStorageData: vi.fn(async () => {}),
      clearCache: async () => {},
      clearAuthCache: async () => {},
    }
    sessions.set(partition, made)
    return made
  }
  return { Contents, View, views, sessions, picture, module: { WebContentsView: View, session: { fromPartition } } }
})

vi.mock('electron', () => electron.module)

const { startPages } = await import('../src/main/browser/pages')

type FakeView = InstanceType<typeof electron.View>

const windowOf = () => {
  const children = new Set<unknown>()
  const window = {
    isDestroyed: () => false,
    contentView: {
      addChildView: (view: unknown) => void children.add(view),
      removeChildView: (view: unknown) => void children.delete(view),
    },
    webContents: { getZoomFactor: () => 1, focus: vi.fn() },
  }
  return window as unknown as Electron.BrowserWindow
}

let serial = 0x5000
const nextOwner = () => `task_${(serial += 1).toString(16).padStart(32, '0')}`
const projectOwner = () => `proj_${(serial += 1).toString(16).padStart(32, '0')}`
const PLACE = { x: 640, y: 120, width: 640, height: 700 }
const NOW = { settle: 0, load: 50, fade: 40, poll: 5, script: 60 }

const picked = (label = 'button.save', text = 'Save') => ({
  selector: label,
  label,
  text,
  rect: { x: 10, y: 20, width: 80, height: 32 },
  font: '14px · 500 · Inter',
  colour: '#000000',
  background: '#ffffff',
  page: { width: 640, height: 700 },
})

const found = (over: Record<string, unknown> = {}) => ({
  ok: true,
  ref: 'e12',
  role: 'button',
  name: 'Save',
  rect: { x: 10, y: 20, width: 80, height: 32 },
  at: { x: 50, y: 36 },
  picked: picked(),
  covered: null,
  disabled: false,
  editable: false,
  inView: true,
  ...over,
})

let windowsOpen = 1
let quitting = false
const started = () => {
  const options = {
    overlay: () => '',
    keep: () => 'task' as const,
    partitions: mkdtempSync(join(tmpdir(), 'althar-partitions-')),
    outside: vi.fn(),
    tell: vi.fn(),
    pressed: vi.fn(),
    closed: vi.fn(),
    chrome: '130.0.0.0',
    agent: 'Mozilla/5.0 Chrome/130.0.0.0',
    opened: vi.fn(),
    windows: () => windowsOpen,
    quitting: () => quitting,
    pace: NOW,
  }
  return { pages: startPages(options), options }
}

/** The page an owner has, by the address it opened at. */
const viewOf = (url: string): FakeView => {
  const view = electron.views.findLast((one) => one.webContents.url === url)
  if (view === undefined) throw new Error(`No page at ${url}`)
  return view
}

const BASE = 'http://localhost:5173/'

/** A page opened for an owner and shown beside its conversation, in a window of Althar's. */
const shown = async (over?: (contents: InstanceType<typeof electron.Contents>) => void) => {
  const { pages, options } = started()
  const id = nextOwner()
  const window = windowOf()
  const opened = await pages.drive(id, { op: 'open', url: BASE })
  expect(opened.error).toBeUndefined()
  const view = viewOf(BASE)
  pages.show(window, id, PLACE, 'beside')
  view.webContents.title = 'Refunds'
  view.webContents.driver = { locate: () => found(), input: () => 0 }
  over?.(view.webContents)
  options.tell.mockClear()
  options.opened.mockClear()
  return { pages, options, id, window, view, contents: view.webContents }
}

const text = (done: { value?: { text: string }; error?: string }) => done.value?.text ?? done.error ?? ''

beforeEach(() => {
  windowsOpen = 1
  quitting = false
  electron.views.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('when an agent can’t reach a page, it is told plainly', () => {
  const calls: ReadonlyArray<PageCall> = [
    { op: 'snapshot', target: null },
    { op: 'screenshot', target: null, fullPage: false },
    { op: 'logs', since: 0, kind: 'all' },
    { op: 'click', target: { ref: 'e1' }, button: 'left', double: false },
    { op: 'move', move: 'reload' },
    { op: 'viewport', viewport: 'phone' },
    { op: 'wait', text: null, gone: null, target: null, seconds: 1 },
    { op: 'evaluate', script: '1' },
  ]

  it('says nothing is open beside the task or the project’s conversation, for every tool that needs a page', async () => {
    const { pages } = started()
    const task = nextOwner()
    const project = projectOwner()
    for (const call of calls) {
      expect((await pages.drive(task, call)).error, call.op).toBe('Nothing is open beside this task. page_open opens it at an address.')
      expect((await pages.drive(project, call)).error, call.op).toBe(
        'Nothing is open beside this project’s conversation. page_open opens it at an address.',
      )
    }
    expect(electron.views).toHaveLength(0)
  })

  it('says it has no window to put the page beside, for every tool but the one that only looks', async () => {
    const { pages } = started()
    const id = nextOwner()
    windowsOpen = 0
    for (const call of [...calls, { op: 'open', url: BASE } as const])
      expect((await pages.drive(id, call)).error, call.op).toBe(
        'Althar has no window open, so there is no page beside this task to read or drive. Open Althar’s window and ask again.',
      )
    const state = await pages.drive(id, { op: 'state' })
    expect(state.error).toBeUndefined()
    expect(text(state)).toContain('Nothing is open beside this task.')
    expect(text(state)).toContain('Althar’s window: not open')
    expect(electron.views).toHaveLength(0)
  })

  it('says Althar is quitting, for every tool', async () => {
    const { pages } = started()
    const id = nextOwner()
    quitting = true
    for (const call of [...calls, { op: 'state' } as const, { op: 'open', url: BASE } as const])
      expect((await pages.drive(id, call)).error, call.op).toBe('Althar is quitting, so the page is going.')
  })

  it('refuses an owner that is not a task or a project, and makes no page for it', async () => {
    const { pages } = started()
    for (const owner of ['', 'task_1', `repo_${'a'.repeat(32)}`, '../../etc', `task_${'G'.repeat(32)}`])
      expect((await pages.drive(owner, { op: 'open', url: BASE })).error, owner).toBe('That isn’t a page Althar can open.')
    expect(electron.views).toHaveLength(0)
  })

  it('says what a page that is gone, closed with its task, leaves: nothing open', async () => {
    const { pages, id } = await shown()
    await pages.close(id)
    expect((await pages.drive(id, { op: 'snapshot', target: null })).error).toBe(
      'Nothing is open beside this task. page_open opens it at an address.',
    )
  })
})

describe('what is open beside the conversation', () => {
  it('says where the page is, at what size, and what the page says', async () => {
    const { pages, id, contents } = await shown()
    contents.url = 'http://localhost:5173/refunds'
    contents.history.back = true
    expect(text(await pages.drive(id, { op: 'state' }))).toBe(
      [
        'Page beside this task: http://localhost:5173/refunds (“Refunds”)',
        'Shown: beside the conversation, on screen',
        'Viewport: fit (the panel’s own size)',
        'History: back is possible',
        'Log mark: 0',
      ].join('\n'),
    )
    contents.emit('did-fail-load', {}, -105, 'name not resolved', 'http://nowhere.test/', true)
    expect(text(await pages.drive(id, { op: 'state' }))).toContain('The page says: nowhere.test didn’t answer.')
  })

  it('says a page in a tab of its own, and one not on screen now', async () => {
    const { pages, id, window } = await shown()
    pages.show(window, id, PLACE, 'tab')
    expect(text(await pages.drive(id, { op: 'state' }))).toContain('Shown: in a tab of its own, on screen')
    pages.show(window, id, null)
    expect(text(await pages.drive(id, { op: 'state' }))).toContain('Shown: open but not on screen now')
  })

  it('says a page asleep wakes where it was, and wakes it for the tool that needs it, asking the windows to place it', async () => {
    const { pages, options } = started()
    const window = windowOf()
    const ids = [nextOwner(), nextOwner(), nextOwner(), nextOwner()]
    for (const [n, id] of ids.entries()) {
      await pages.drive(id, { op: 'open', url: `http://localhost:5173/${n}` })
      pages.show(window, id, PLACE)
      pages.show(window, id, null)
    }
    const first = ids[0] as string
    expect(viewOf('http://localhost:5173/0').webContents.destroyed).toBe(true)
    expect(text(await pages.drive(first, { op: 'state' }))).toContain('Shown: asleep; it wakes where it was when a tool needs it')
    options.opened.mockClear()

    const woke = await pages.drive(first, { op: 'logs', since: 0, kind: 'all' })

    expect(woke.error).toBeUndefined()
    const revived = electron.views.findLast((view) => view.webContents.url === 'http://localhost:5173/0')
    expect(revived?.webContents.destroyed).toBe(false)
    expect(options.opened).toHaveBeenCalledWith(first)
  })
})

describe('opening an address, under every guard the page has', () => {
  it('opens a web page at a typed address, beside the conversation where no window shows it yet', async () => {
    const { pages, options } = started()
    const id = nextOwner()
    const done = await pages.drive(id, { op: 'open', url: 'localhost:5173/refunds' })
    expect(text(done)).toBe(
      [
        'Opened http://localhost:5173/refunds, open but not on screen now (another screen is in front); it shows when the conversation does.',
        'Log mark: 0.',
      ].join('\n'),
    )
    expect(viewOf('http://localhost:5173/refunds').webContents.loaded).toEqual(['http://localhost:5173/refunds'])
    expect(options.opened).toHaveBeenCalledWith(id)
  })

  it('goes on in the page a window shows, without asking the windows to place it again', async () => {
    const { pages, options, id, contents } = await shown()
    const done = await pages.drive(id, { op: 'open', url: 'https://example.com/docs' })
    expect(text(done)).toContain('Opened https://example.com/docs (“Refunds”), beside the conversation, on screen.')
    expect(contents.loaded).toEqual([BASE, 'https://example.com/docs'])
    expect(options.opened).not.toHaveBeenCalled()
  })

  it.each([
    ['file:///etc/hosts', 'Files on this computer don’t open here: only http and https web pages do, so the page stayed where it was.'],
    ['javascript:alert(1)', 'Only http and https web pages open here, not javascript: addresses, so the page stayed where it was.'],
    ['data:text/html,<p>hi</p>', 'Only http and https web pages open here, not data: addresses, so the page stayed where it was.'],
    ['about:blank', 'Only http and https web pages open here, not about: addresses, so the page stayed where it was.'],
    ['vscode://file/etc/hosts', 'Only http and https web pages open here, not vscode: addresses, so the page stayed where it was.'],
    ['blob:https://example.com/1', 'Only http and https web pages open here, not blob: addresses, so the page stayed where it was.'],
    ['two words', 'That isn’t a web address. Give one such as http://localhost:5173/ or example.com.'],
  ])('refuses %s in words, and the page stays where it was', async (address, why) => {
    const { pages, id, contents } = await shown()
    const done = await pages.drive(id, { op: 'open', url: address })
    expect(done.error).toBe(why)
    expect(contents.loaded).toEqual([BASE])
    expect(contents.url).toBe(BASE)
  })

  it('makes no page for an address it refuses', async () => {
    const { pages } = started()
    const done = await pages.drive(nextOwner(), { op: 'open', url: 'file:///etc/hosts' })
    expect(done.error).toContain('Files on this computer')
    expect(electron.views).toHaveLength(0)
  })

  it.each([
    ['https://github.com/login', 'GitHub'],
    ['https://claude.ai/login', 'Claude'],
    ['https://gitlab.com/users/sign_in', 'GitLab'],
    ['https://linear.app/login', 'Linear'],
  ])('sends %s to the person’s browser, and tells the lead it did', async (address, service) => {
    const { pages, options, id, contents } = await shown()
    const done = await pages.drive(id, { op: 'open', url: address })
    expect(done.error).toBe(
      `That is ${service}’s sign-in. Sign-ins to Claude, GitHub, GitLab and Linear happen in the person’s own browser, never in this page: Althar opened it there, and this page stayed where it was. Ask the person to sign in if you need it.`,
    )
    expect(options.outside).toHaveBeenCalledWith(address)
    expect(contents.loaded).toEqual([BASE])
  })

  it('opens a sign-in in the person’s browser even where no page is open, without making one', async () => {
    const { pages, options } = started()
    const done = await pages.drive(nextOwner(), { op: 'open', url: 'https://github.com/login' })
    expect(done.error).toContain('GitHub’s sign-in')
    expect(options.outside).toHaveBeenCalledWith('https://github.com/login')
    expect(electron.views).toHaveLength(0)
  })

  it('opens another company’s sign-in in the page itself, in its own session', async () => {
    const { pages, options, id, contents } = await shown()
    const done = await pages.drive(id, { op: 'open', url: 'https://sso.example.com/login' })
    expect(done.error).toBeUndefined()
    expect(contents.loaded).toContain('https://sso.example.com/login')
    expect(options.outside).not.toHaveBeenCalled()
  })

  it('says a host that didn’t answer, and how to go on', async () => {
    const { pages, id, contents } = await shown()
    contents.loadURL = async (url: string) => {
      contents.emit('did-fail-load', {}, -102, 'refused', url, true)
      throw new Error('ERR_CONNECTION_REFUSED')
    }
    const done = await pages.drive(id, { op: 'open', url: 'localhost:9' })
    expect(done.error).toBe('localhost:9 didn’t answer. Check that it is running (run_project starts the project), then open it again.')
  })

  it('says a redirect the guards stopped, which the page never reached', async () => {
    const { pages, options, id, contents } = await shown()
    contents.loadURL = async (url: string) => {
      contents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false })
      contents.emit('will-redirect', { url: 'https://github.com/login?return_to=/x', isMainFrame: true, preventDefault: vi.fn() })
      throw new Error(`ERR_ABORTED ${url}`)
    }
    const done = await pages.drive(id, { op: 'open', url: 'https://example.com/app' })
    expect(done.error).toContain('GitHub’s sign-in')
    expect(options.outside).toHaveBeenCalledWith('https://example.com/app')
  })
})

describe('driving by real input, under the same guards', () => {
  it('presses an element where it is, with focus the person’s window doesn’t lose, and says what it pressed', async () => {
    const { pages, id, view, contents } = await shown()
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })

    expect(text(done)).toBe(
      ['Clicked button “Save”.', 'On `button.save` (“Save”), 80 × 32', 'Selector: `button.save`', 'Log mark: 0.'].join('\n'),
    )
    const sent = contents.commands.map((command) => `${command.method} ${String(command.params.type ?? command.params.enabled ?? '')}`)
    expect(sent).toEqual([
      // Once, as the agent first reached the page: the debugger tells of the dialogs it opens from then on.
      'Page.enable ',
      'Emulation.setFocusEmulationEnabled true',
      'Input.dispatchMouseEvent mouseMoved',
      'Input.dispatchMouseEvent mousePressed',
      'Input.dispatchMouseEvent mouseReleased',
      'Emulation.setFocusEmulationEnabled false',
    ])
    expect(contents.commands.find((command) => command.params.type === 'mousePressed')?.params).toMatchObject({
      x: 50,
      y: 36,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    expect(contents.focus).not.toHaveBeenCalled()
    // The lead’s outline, on the element the press goes to, and the debugger kept for it.
    expect(contents.asks.find((ask) => ask.method === 'mark')?.args).toEqual([{ x: 10, y: 20, width: 80, height: 32 }])
    expect(contents.asks.find((ask) => ask.method === 'locate')?.args).toEqual([{ ref: 'e12' }, true])
    expect(contents.attached).toBe(true)
    expect(view.webContents.detaches).toBe(0)
  })

  it('double-clicks and right-clicks', async () => {
    const { pages, id, contents } = await shown()
    expect(text(await pages.drive(id, { op: 'click', target: { selector: '.save' }, button: 'left', double: true }))).toContain(
      'Double-clicked',
    )
    const presses = contents.commands.filter(
      (command) => command.method === 'Input.dispatchMouseEvent' && command.params.type === 'mousePressed',
    )
    expect(presses.map((press) => press.params.clickCount)).toEqual([1, 2])
    contents.commands.length = 0
    expect(text(await pages.drive(id, { op: 'click', target: { ref: 'e1' }, button: 'right', double: false }))).toContain('Right-clicked')
    expect(contents.commands.find((command) => command.params.type === 'mousePressed')?.params).toMatchObject({
      button: 'right',
      buttons: 2,
    })
  })

  it('takes a point in a smaller viewport to where the page is drawn', async () => {
    const { pages, id, contents } = await shown()
    await pages.drive(id, { op: 'viewport', viewport: 'phone' })
    contents.commands.length = 0
    await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    const scale = (PLACE.height - 32) / 844
    expect(scale).toBeLessThan(1)
    expect(contents.commands.find((command) => command.params.type === 'mousePressed')?.params).toMatchObject({
      x: 50 * scale,
      y: 36 * scale,
    })
  })

  it('says a stale reference, a selector that finds nothing and an answer it can’t read, as the page or driver says them', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => ({ ok: false, why: 'e12 isn’t on the page any more. Take a new snapshot.' })
    expect((await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })).error).toBe(
      'e12 isn’t on the page any more. Take a new snapshot.',
    )
    contents.driver.locate = () => ({ ok: false, why: 'Nothing on the page matches `.gone`.' })
    expect((await pages.drive(id, { op: 'hover', target: { selector: '.gone' } })).error).toBe('Nothing on the page matches `.gone`.')
    contents.driver.locate = () => ({ ok: true, ref: 'x' })
    expect((await pages.drive(id, { op: 'click', target: { ref: 'e1' }, button: 'left', double: false })).error).toContain(
      'answered in a way Althar couldn’t read',
    )
    expect(contents.commands.some((command) => command.method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('doesn’t press what is disabled or out of reach, and says another element is over what it presses', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ disabled: true })
    expect((await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })).error).toBe(
      'button “Save” is disabled, so clicking it does nothing.',
    )
    contents.driver.locate = () => found({ inView: false })
    expect((await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })).error).toContain(
      'outside the viewport',
    )
    contents.driver.locate = () => found({ covered: 'div.modal' })
    expect(text(await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false }))).toContain(
      '`div.modal` was over it, so the press went to that.',
    )
  })

  /** A click whose press sets going whatever `onPress` does. */
  const pressing = (contents: InstanceType<typeof electron.Contents>, onPress: () => void) => {
    contents.debugger.sendCommand = async (method, params = {}) => {
      contents.commands.push({ method, params })
      if (params.type === 'mousePressed') onPress()
      return {}
    }
  }
  const click = { op: 'click', target: { ref: 'e12' }, button: 'left', double: false } as const

  it('says a press that went to a sign-in: the guard stops it and the person’s browser opens it', async () => {
    const { pages, options, id, contents } = await shown()
    pressing(contents, () =>
      contents.emit('will-frame-navigate', { url: 'https://github.com/login', isMainFrame: true, preventDefault: vi.fn() }),
    )
    expect(text(await pages.drive(id, click))).toContain(
      'That led to GitHub’s sign-in. Sign-ins to Claude, GitHub, GitLab and Linear happen in the person’s own browser',
    )
    expect(options.outside).toHaveBeenCalledWith('https://github.com/login')
  })

  it('says a press that would have left for a file, which stayed where it was', async () => {
    const { pages, id, contents } = await shown()
    const stop = vi.fn()
    pressing(contents, () => contents.emit('will-frame-navigate', { url: 'file:///etc/hosts', isMainFrame: true, preventDefault: stop }))
    expect(text(await pages.drive(id, click))).toContain(
      'That would have taken the page to a file on this computer. Only http and https web pages open here, so the page stayed where it was.',
    )
    expect(stop).toHaveBeenCalled()
  })

  it('says a page it went on to', async () => {
    const { pages, id, contents } = await shown()
    contents.title = 'Refund re_3Pq'
    pressing(contents, () => void (contents.url = 'http://localhost:5173/refunds/re_3Pq'))
    expect(text(await pages.drive(id, click))).toContain('The page is now at http://localhost:5173/refunds/re_3Pq (“Refund re_3Pq”).')
  })

  it('says a camera the page asked for, which pages here never get', async () => {
    const { pages, id, contents } = await shown()
    const session = electron.sessions.get(`persist:task-${id.slice('task_'.length)}`)
    pressing(contents, () =>
      session?.asked?.(contents, 'media', vi.fn(), { requestingUrl: 'http://localhost:5173/', mediaTypes: ['video'] }),
    )
    expect(text(await pages.drive(id, click))).toContain('localhost:5173 asked for the camera, which pages here never get.')
  })

  it('says a download the page started, refused here and offered to the person’s browser', async () => {
    const { pages, id, contents } = await shown()
    const session = electron.sessions.get(`persist:task-${id.slice('task_'.length)}`)
    const item = { getURL: () => 'http://localhost:5173/report.pdf', getFilename: () => 'report.pdf' }
    pressing(contents, () => session?.handlers.get('will-download')?.({ preventDefault: vi.fn() }, item, contents))
    expect(text(await pages.drive(id, click))).toContain(
      'The page tried to download report.pdf. Downloads are refused here, and offered to the person’s browser instead.',
    )
  })

  it('tells what went wrong in the page while it acted, and where to read it', async () => {
    const { pages, id, contents } = await shown()
    contents.debugger.sendCommand = async (method, params = {}) => {
      contents.commands.push({ method, params })
      if (params.type === 'mousePressed')
        contents.emit('console-message', {
          level: 'error',
          message: 'TypeError: x is undefined',
          lineNumber: 12,
          sourceId: 'http://localhost:5173/app.js',
          frame: { parent: null },
        })
      return {}
    }
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    expect(text(done)).toContain('Meanwhile: 1 console error. page_logs with since 0 reads it.')
    expect(text(await pages.drive(id, { op: 'logs', since: 0, kind: 'all' }))).toContain(
      '[1] console error TypeError: x is undefined (app.js:12)',
    )
  })
})

describe('the person’s own input always wins', () => {
  /** A page whose count of real inputs reads `counts` in turn, then the last, as the person acts. */
  const counting = (contents: InstanceType<typeof electron.Contents>, counts: ReadonlyArray<number>) => {
    let n = 0
    contents.driver.input = () => counts[Math.min(n++, counts.length - 1)]
  }

  it('stops before it presses where the person pressed first, and the page stops saying the lead is at work', async () => {
    const { pages, options, id, contents } = await shown()
    // Read at the start (0), then after the pointer moved: the person has pressed twice.
    counting(contents, [0, 2])
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    expect(done.error).toBe(
      'The person clicked, typed or scrolled in the page while you acted on it, so the action stopped. Take a new snapshot to see where the page is now.',
    )
    expect(contents.commands.some((command) => command.params.type === 'mousePressed')).toBe(false)
    expect(pages.states()[0]?.working).toBe(false)
    expect(options.tell.mock.calls.at(-1)?.[0]).toMatchObject({ owner: id, working: false })
  })

  it('stops after a press the person came into, and says what had been done', async () => {
    const { pages, id, contents } = await shown()
    // At the start 0; after the move 0; after the lead’s own press, 1 expected but 2 counted.
    counting(contents, [0, 0, 2])
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: true })
    expect(done.error).toContain('so the action stopped (the press had been made).')
    expect(contents.commands.filter((command) => command.params.type === 'mousePressed')).toHaveLength(1)
  })

  it('lets its own inputs be counted: one press, one count, is not the person', async () => {
    const { pages, id, contents } = await shown()
    counting(contents, [3, 3, 4])
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    expect(done.error).toBeUndefined()
  })

  it('counts each key of a chord as its own, and stops where the person typed in the middle of one', async () => {
    const { pages, id, contents } = await shown()
    counting(contents, [0, 0, 2])
    const same = await pages.drive(id, { op: 'press', key: 'Control+A', target: null })
    expect(same.error).toBeUndefined()
    counting(contents, [10, 10, 13])
    const person = await pages.drive(id, { op: 'press', key: 'Control+A', target: null })
    expect(person.error).toContain('so the action stopped (the key had been pressed)')
  })

  it('starts over at a page it has gone to, whose count begins again', async () => {
    const { pages, id, contents } = await shown()
    counting(contents, [7, 0, 1])
    const done = await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    expect(done.error).toBeUndefined()
  })

  it('stops in the middle of typing, before the rest', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true })
    counting(contents, [0, 0, 5])
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund', replace: true, submit: true })
    expect(done.error).toContain('so the action stopped (some of it was typed)')
    expect(contents.commands.some((command) => command.params.key === 'Enter')).toBe(false)
  })
})

/** Runs timers on until a promise is done: for what waits on the clock. */
const finishing = async <T>(work: Promise<T>): Promise<T> => {
  let done = false
  const finished = work.finally(() => void (done = true))
  while (!done) await vi.advanceTimersByTimeAsync(1)
  return finished
}

describe('the page says the lead is at work', () => {
  it('while it acts, and for a moment after its last action', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { pages, options, id, contents } = await shown()
    // The opening it did itself has had its moment.
    await vi.advanceTimersByTimeAsync(NOW.fade)
    expect(pages.states()[0]?.working).toBe(false)
    options.tell.mockClear()
    const seen: Array<boolean> = []
    contents.debugger.sendCommand = async (method, params = {}) => {
      contents.commands.push({ method, params })
      seen.push(pages.states().find((state) => state.owner === id)?.working === true)
      return {}
    }
    await finishing(pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false }))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((one) => one)).toBe(true)
    // Over, it still says so until the moment passes.
    expect(pages.states()[0]?.working).toBe(true)
    expect(options.tell.mock.calls.map(([state]) => (state as { working: boolean }).working)).toContain(true)
    await vi.advanceTimersByTimeAsync(NOW.fade)
    expect(pages.states()[0]?.working).toBe(false)
    expect(options.tell.mock.calls.at(-1)?.[0]).toMatchObject({ working: false })
  })

  it('goes on a moment longer with each action, from its last', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { pages, id } = await shown()
    await vi.advanceTimersByTimeAsync(NOW.fade)
    await finishing(pages.drive(id, { op: 'hover', target: { ref: 'e12' } }))
    await vi.advanceTimersByTimeAsync(NOW.fade - 5)
    await finishing(pages.drive(id, { op: 'hover', target: { ref: 'e12' } }))
    await vi.advanceTimersByTimeAsync(NOW.fade - 5)
    expect(pages.states()[0]?.working).toBe(true)
    await vi.advanceTimersByTimeAsync(5)
    expect(pages.states()[0]?.working).toBe(false)
  })

  it('doesn’t, for reading the page', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { pages, id, contents } = await shown()
    await vi.advanceTimersByTimeAsync(NOW.fade)
    contents.driver.snapshot = () => ({ ok: true, text: '- heading "Refunds" [level=1] [ref=e3]', nodes: 1, truncated: false })
    await finishing(pages.drive(id, { op: 'snapshot', target: null }))
    await finishing(pages.drive(id, { op: 'logs', since: 0, kind: 'all' }))
    await finishing(pages.drive(id, { op: 'state' }))
    expect(pages.states()[0]?.working).toBe(false)
  })
})

describe('typing, keys, scrolling and choosing', () => {
  it('types into a field it focused and selected, and says what it typed', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true, picked: picked('input.search', '') })
    contents.driver.valueOf = () => 'refund 88210'
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund 88210', replace: true, submit: false })
    expect(text(done)).toContain('Typed 12 characters in textbox “Search”.')
    expect(contents.asks.map((ask) => ask.method)).toEqual(expect.arrayContaining(['focus', 'selectAll', 'valueOf']))
    expect(contents.commands.find((command) => command.method === 'Input.insertText')?.params).toEqual({ text: 'refund 88210' })
    expect(contents.asks.some((ask) => ask.method === 'fill')).toBe(false)
  })

  it('keeps what a field holds when it isn’t asked to replace it', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true })
    contents.driver.valueOf = () => 'abc'
    await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'c', replace: false, submit: false })
    expect(contents.asks.some((ask) => ask.method === 'selectAll')).toBe(false)
  })

  it('sets a field that ignored typing the way typing sets it, and says so', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true })
    contents.driver.valueOf = () => ''
    contents.driver.fill = () => ({ ok: true, value: 'refund' })
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund', replace: true, submit: false })
    expect(text(done)).toContain('The field ignored typing, so its value was set instead.')
    expect(contents.asks.find((ask) => ask.method === 'fill')?.args).toEqual([{ ref: 'e3' }, 'refund', true])
  })

  it('clears a field by deleting what it selected, where there is nothing to type', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true })
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: '', replace: true, submit: false })
    expect(text(done)).toContain('Cleared textbox “Search”.')
    expect(contents.commands.some((command) => command.method === 'Input.insertText')).toBe(false)
    expect(
      contents.commands
        .filter((command) => command.method === 'Input.dispatchKeyEvent')
        .map((command) => `${command.params.type} ${command.params.key}`),
    ).toEqual(['rawKeyDown Backspace', 'keyUp Backspace'])
    const kept = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: '', replace: false, submit: false })
    expect(text(kept)).toContain('Typed nothing in textbox “Search”.')
  })

  it('presses Enter after the text when asked', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'textbox', name: 'Search', editable: true })
    contents.driver.valueOf = () => 'a'
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'a', replace: true, submit: true })
    expect(text(done)).toContain('Typed 1 character and pressed Enter in textbox “Search”.')
    expect(
      contents.commands
        .filter((command) => command.method === 'Input.dispatchKeyEvent')
        .map((command) => `${command.params.type} ${command.params.key}`),
    ).toEqual(['keyDown Enter', 'keyUp Enter'])
  })

  it('doesn’t type in what isn’t a field or is disabled', async () => {
    const { pages, id, contents } = await shown()
    expect((await pages.drive(id, { op: 'type', target: { ref: 'e12' }, text: 'x', replace: true, submit: false })).error).toBe(
      'button “Save” isn’t a field to type in. page_click presses buttons and links.',
    )
    contents.driver.locate = () => found({ editable: true, disabled: true })
    expect((await pages.drive(id, { op: 'type', target: { ref: 'e12' }, text: 'x', replace: true, submit: false })).error).toContain(
      'is disabled',
    )
    expect(contents.commands.some((command) => command.method === 'Input.insertText')).toBe(false)
  })

  it('presses a key or a chord, to the element named, and says which keys it doesn’t know', async () => {
    const { pages, id, contents } = await shown()
    expect(text(await pages.drive(id, { op: 'press', key: 'Shift+Tab', target: { ref: 'e12' } }))).toContain(
      'Pressed Shift+Tab on button “Save”.',
    )
    expect(contents.asks.some((ask) => ask.method === 'focus')).toBe(true)
    expect(
      contents.commands
        .filter((command) => command.method === 'Input.dispatchKeyEvent')
        .map((command) => `${command.params.type} ${command.params.key}`),
    ).toEqual(['rawKeyDown Shift', 'rawKeyDown Tab', 'keyUp Tab', 'keyUp Shift'])
    expect(text(await pages.drive(id, { op: 'press', key: 'Escape', target: null }))).toContain('Pressed Escape.')
    expect((await pages.drive(id, { op: 'press', key: 'Banana', target: null })).error).toContain('isn’t a key I know')
  })

  it('moves the pointer over an element', async () => {
    const { pages, id, contents } = await shown()
    expect(text(await pages.drive(id, { op: 'hover', target: { ref: 'e12' } }))).toContain('Moved the pointer over button “Save”.')
    expect(
      contents.commands.filter((command) => command.method === 'Input.dispatchMouseEvent').map((command) => command.params.type),
    ).toEqual(['mouseMoved'])
  })

  it('scrolls the page, an element, or an element into view', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.scroll = () => ({ ok: true, x: 0, y: 700, atStart: false, atEnd: false })
    contents.driver.layout = () => ({ width: 640, height: 700, scrollX: 0, scrollY: 700, contentWidth: 640, contentHeight: 2000 })
    expect(text(await pages.drive(id, { op: 'scroll', target: null, to: null, by: null }))).toContain(
      'Scrolled to 0, 700 of a 640×2000 page, seen through 640×700.',
    )
    expect(contents.asks.find((ask) => ask.method === 'scroll')?.args).toEqual([null, 'down', null])
    await pages.drive(id, { op: 'scroll', target: { selector: '.list' }, to: 'bottom', by: null })
    expect(contents.asks.filter((ask) => ask.method === 'scroll').at(-1)?.args).toEqual([{ selector: '.list' }, 'bottom', null])
    expect(text(await pages.drive(id, { op: 'scroll', target: { ref: 'e12' }, to: null, by: null }))).toContain(
      'Scrolled into view button “Save”.',
    )
    contents.driver.scroll = () => ({ ok: false, why: 'Nothing on the page matches `.x`.' })
    expect((await pages.drive(id, { op: 'scroll', target: { selector: '.x' }, to: 'up', by: null })).error).toBe(
      'Nothing on the page matches `.x`.',
    )
  })

  it('chooses options by label or value', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.locate = () => found({ role: 'combobox', name: 'Country' })
    contents.driver.select = () => ({ ok: true, chosen: ['Spain'] })
    expect(text(await pages.drive(id, { op: 'select', target: { ref: 'e5' }, values: ['es'] }))).toContain(
      'Chose “Spain” in combobox “Country”.',
    )
    expect(contents.asks.find((ask) => ask.method === 'select')?.args).toEqual([{ ref: 'e5' }, ['es']])
    contents.driver.select = () => ({ ok: false, why: 'combobox “Country” has no option “zz”.' })
    expect((await pages.drive(id, { op: 'select', target: { ref: 'e5' }, values: ['zz'] })).error).toBe(
      'combobox “Country” has no option “zz”.',
    )
  })
})

describe('waiting', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))

  it('waits until words show, and says when they didn’t in time', async () => {
    const { pages, id, contents } = await shown()
    let looks = 0
    contents.driver.has = () => ++looks > 3
    expect(text(await finishing(pages.drive(id, { op: 'wait', text: 'Saved', gone: null, target: null, seconds: 1 })))).toBe(
      'It is there now.',
    )
    expect(contents.asks.find((ask) => ask.method === 'has')?.args).toEqual([{ text: 'Saved' }])
    contents.driver.has = () => false
    const late = await finishing(pages.drive(id, { op: 'wait', text: 'Saved', gone: null, target: { ref: 'e4' }, seconds: 1 }))
    expect(late.error).toBe('After 1 second, the words “Saved” haven’t shown and e4 isn’t on the page.')
  })

  it('waits for words to go', async () => {
    const { pages, id, contents } = await shown()
    let looks = 0
    contents.driver.has = () => ++looks < 3
    expect(text(await finishing(pages.drive(id, { op: 'wait', text: null, gone: 'Loading…', target: null, seconds: 1 })))).toBe(
      'It is there now.',
    )
    contents.driver.has = () => true
    expect((await finishing(pages.drive(id, { op: 'wait', text: null, gone: 'Loading…', target: null, seconds: 2 }))).error).toBe(
      'After 2 seconds, the words “Loading…” are still there.',
    )
  })

  it('only waits where it is asked for nothing in particular, and goes on when the person uses the page', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.input = () => 99
    expect(text(await finishing(pages.drive(id, { op: 'wait', text: null, gone: null, target: null, seconds: 1 })))).toBe(
      'Waited 1 second.',
    )
  })

  it('stops waiting on a page that closed', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.has = () => {
      contents.destroyed = true
      return false
    }
    expect((await finishing(pages.drive(id, { op: 'wait', text: 'x', gone: null, target: null, seconds: 5 }))).error).toBe(
      'The page closed while waiting.',
    )
  })
})

describe('scripts in an isolated world', () => {
  it('runs an expression in a world of its own, not the overlay’s, the page’s or Electron’s', async () => {
    const { pages, id, contents } = await shown()
    contents.evaluated = (code) => (code.includes('document.title') && code.startsWith('(async () => (') ? 'Refunds' : true)
    const done = await pages.drive(id, { op: 'evaluate', script: 'document.title;' })
    expect(text(done)).toBe('Refunds')
    const mine = contents.worlds.filter((one) => one.code.includes('document.title'))
    expect(mine.length).toBeGreaterThan(0)
    for (const one of mine) expect(one.world).toBe(7_302)
    expect(contents.worlds.some((one) => one.world === 0 || one.world === 999)).toBe(false)
  })

  it('runs statements that return, where the script is not an expression, and says what a script that returns nothing gives', async () => {
    const { pages, id, contents } = await shown()
    contents.evaluated = (code) => {
      if (code.startsWith('(() => { void (async () =>')) return new Error('SyntaxError: Unexpected token ‘const’')
      return code.includes('return n') ? 3 : undefined
    }
    expect(text(await pages.drive(id, { op: 'evaluate', script: 'const n = 3; return n' }))).toBe('3')
    const quiet = await pages.drive(id, { op: 'evaluate', script: 'const n = 3' })
    expect(text(quiet)).toBe('undefined\n(A script of statements gives back what it `return`s.)')
  })

  it('says a script that threw, and one that ran too long', async () => {
    const { pages, id, contents } = await shown()
    contents.evaluated = (code) => (code.startsWith('(async () =>') ? new Error('x is not defined') : true)
    expect((await pages.drive(id, { op: 'evaluate', script: 'x' })).error).toBe('The script threw: x is not defined')
    contents.worlds.length = 0
    contents.executeJavaScriptInIsolatedWorld = async (world: number, sources: ReadonlyArray<{ code: string }>) => {
      contents.worlds.push({ world, code: sources[0]?.code ?? '' })
      if (world === 7_301 || sources[0]?.code.startsWith('(() =>')) return true
      return new Promise(() => undefined)
    }
    expect((await pages.drive(id, { op: 'evaluate', script: 'while (true) {}' })).error).toContain('ran longer than')
  })

  it('shares a page’s guards: what a script navigates to is met by the same ones', async () => {
    const { pages, options, id, contents } = await shown()
    contents.evaluated = (code) => {
      if (code.startsWith('(async () =>'))
        contents.emit('will-frame-navigate', { url: 'https://gitlab.com/users/sign_in', isMainFrame: true, preventDefault: vi.fn() })
      return null
    }
    const done = await pages.drive(id, { op: 'evaluate', script: 'location.href = "https://gitlab.com/users/sign_in"' })
    expect(text(done)).toContain('GitLab’s sign-in')
    expect(options.outside).toHaveBeenCalledWith('https://gitlab.com/users/sign_in')
  })
})

describe('reading the page', () => {
  it('reads its snapshot, whole or one element’s, with where it is', async () => {
    const { pages, id, contents } = await shown()
    contents.url = 'http://localhost:5173/refunds'
    contents.driver.snapshot = () => ({
      ok: true,
      text: '- heading "Refunds" [level=1] [ref=e3]\n- button "Camera" [ref=e7]',
      nodes: 2,
      truncated: false,
    })
    expect(text(await pages.drive(id, { op: 'snapshot', target: null }))).toBe(
      ['Page: http://localhost:5173/refunds (“Refunds”)', '- heading "Refunds" [level=1] [ref=e3]', '- button "Camera" [ref=e7]'].join(
        '\n',
      ),
    )
    expect(contents.asks.find((ask) => ask.method === 'snapshot')?.args).toEqual([null, 1_500])
    await pages.drive(id, { op: 'snapshot', target: { ref: 'e3' } })
    expect(contents.asks.filter((ask) => ask.method === 'snapshot').at(-1)?.args).toEqual([{ ref: 'e3' }, 1_500])
    contents.driver.snapshot = () => ({ ok: true, text: '- main', nodes: 1_500, truncated: true })
    expect(text(await pages.drive(id, { op: 'snapshot', target: null }))).toContain(
      '(Stopped at 1500 elements. Pass ref or selector to read one part of the page.)',
    )
    contents.driver.snapshot = () => ({ ok: false, why: 'e3 isn’t on the page any more. Take a new snapshot.' })
    expect((await pages.drive(id, { op: 'snapshot', target: { ref: 'e3' } })).error).toBe(
      'e3 isn’t on the page any more. Take a new snapshot.',
    )
    contents.driver.snapshot = () => 'nonsense'
    expect((await pages.drive(id, { op: 'snapshot', target: null })).error).toContain('couldn’t read')
  })

  it('says a phone’s viewport in the snapshot’s heading', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.snapshot = () => ({ ok: true, text: '- main', nodes: 1, truncated: false })
    await pages.drive(id, { op: 'viewport', viewport: 'phone' })
    expect(text(await pages.drive(id, { op: 'snapshot', target: null }))).toContain('· viewport phone (390×844')
  })

  it('reads the console and the requests that failed, after a point, and says where to read on', async () => {
    const { pages, id, contents } = await shown()
    const session = electron.sessions.get(`persist:task-${id.slice('task_'.length)}`)
    contents.emit('console-message', {
      level: 'error',
      message: 'Uncaught ReferenceError: boom',
      lineNumber: 3,
      sourceId: 'http://localhost:5173/assets/app.js?v=2',
      frame: { parent: null },
    })
    contents.emit('console-message', { level: 'info', message: 'ready', lineNumber: 0, sourceId: '', frame: { parent: null } })
    session?.errored?.({
      method: 'GET',
      url: 'http://localhost:5173/api/refunds',
      error: 'net::ERR_CONNECTION_REFUSED',
      webContentsId: contents.id,
    })
    session?.errored?.({ method: 'GET', url: 'http://localhost:5173/x.png', error: 'net::ERR_ABORTED', webContentsId: contents.id })
    session?.completed?.({
      method: 'POST',
      url: 'http://localhost:5173/api/pay',
      statusCode: 500,
      statusLine: 'HTTP/1.1 500 Internal Server Error',
      webContentsId: contents.id,
    })
    session?.completed?.({
      method: 'GET',
      url: 'http://localhost:5173/ok',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200 OK',
      webContentsId: contents.id,
    })

    expect(text(await pages.drive(id, { op: 'logs', since: 0, kind: 'all' }))).toBe(
      [
        'Console messages and failed requests since 0 (4):',
        '[1] console error Uncaught ReferenceError: boom (app.js:3)',
        '[2] console info  ready',
        '[3] network error GET http://localhost:5173/api/refunds failed: net::ERR_CONNECTION_REFUSED',
        '[4] network error POST http://localhost:5173/api/pay answered 500 Internal Server Error',
        'Log mark: 4.',
      ].join('\n'),
    )
    expect(text(await pages.drive(id, { op: 'logs', since: 2, kind: 'all' }))).toContain('since 2 (2):')
    expect(text(await pages.drive(id, { op: 'logs', since: 0, kind: 'network' }))).toContain('Failed requests since 0 (2):')
    expect(text(await pages.drive(id, { op: 'logs', since: 4, kind: 'all' }))).toBe(
      'Console messages and failed requests: nothing new since 4. Log mark: 4.',
    )
  })

  it('keeps a request nobody owns, a worker’s, as its page’s', async () => {
    const { pages, id, contents } = await shown()
    const session = electron.sessions.get(`persist:task-${id.slice('task_'.length)}`)
    session?.errored?.({ method: 'GET', url: 'http://localhost:5173/sw', error: 'net::ERR_FAILED', webContentsId: undefined })
    expect(text(await pages.drive(id, { op: 'logs', since: 0, kind: 'network' }))).toContain('GET http://localhost:5173/sw failed')
    void contents
  })
})

describe('taking a picture of the page', () => {
  it('takes what is drawn beside the conversation, at 1×', async () => {
    const { pages, id, view, contents } = await shown()
    view.bounds = { x: 640, y: 120, width: 640, height: 700 }
    contents.shot = electron.picture(1_280, 1_400)
    const done = await pages.drive(id, { op: 'screenshot', target: null, fullPage: false })
    expect(text(done)).toBe(
      'A screenshot of http://localhost:5173/ (“Refunds”), as drawn beside the conversation, at viewport fit (the panel’s own size): 640×700 pixels, at 1×.',
    )
    expect(done.value?.picture).toEqual({ png: Buffer.from('png 640x700').toString('base64'), width: 640, height: 700 })
    expect(contents.captures).toEqual([undefined])
  })

  it('takes one element, the part of the viewport it is in, scrolled to', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.layout = () => ({ width: 640, height: 700, scrollX: 0, scrollY: 0, contentWidth: 640, contentHeight: 700 })
    contents.shot = electron.picture(80, 32)
    const done = await pages.drive(id, { op: 'screenshot', target: { selector: '.save' }, fullPage: false })
    expect(text(done)).toContain('the element `.save`')
    expect(text(done)).toContain('80×32 pixels, at 1×.')
    expect(contents.captures).toEqual([{ x: 10, y: 20, width: 80, height: 32 }])
    expect(contents.asks.find((ask) => ask.method === 'locate')?.args).toEqual([{ selector: '.save' }, true])
  })

  it('takes the whole page through the debugger, and the viewport where it can’t', async () => {
    const { pages, id, contents } = await shown()
    const png = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.writeUInt32BE(13, 8)
    png.write('IHDR', 12, 'ascii')
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(3_000, 20)
    contents.answers['Page.getLayoutMetrics'] = {
      cssContentSize: { width: 640, height: 3_000 },
      contentSize: { width: 640, height: 3_000 },
    }
    contents.answers['Page.captureScreenshot'] = { data: png.toString('base64') }
    const whole = await pages.drive(id, { op: 'screenshot', target: null, fullPage: true })
    expect(text(whole)).toContain('the whole page, at viewport fit')
    expect(text(whole)).toContain('640×3000 pixels, at 1×.')
    expect(contents.commands.find((command) => command.method === 'Page.captureScreenshot')?.params).toMatchObject({
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 640, height: 3_000, scale: 1 },
    })

    contents.answers['Page.captureScreenshot'] = new Error('Not allowed')
    const fallback = await pages.drive(id, { op: 'screenshot', target: null, fullPage: true })
    expect(text(fallback)).toContain('The whole page couldn’t be taken, so this is what shows.')
    expect(fallback.value?.picture).toBeDefined()
  })

  it('cuts the whole page where it is tallest', async () => {
    const { pages, id, contents } = await shown()
    contents.answers['Page.getLayoutMetrics'] = {
      cssContentSize: { width: 640, height: 90_000 },
      contentSize: { width: 640, height: 90_000 },
    }
    contents.answers['Page.captureScreenshot'] = { data: 'bm90IGEgcG5n' }
    await pages.drive(id, { op: 'screenshot', target: null, fullPage: true })
    expect(contents.commands.find((command) => command.method === 'Page.captureScreenshot')?.params.clip.height).toBe(16_000)
  })

  it('says a page that drew nothing, an element with no room, and an element that isn’t there', async () => {
    const { pages, id, contents } = await shown()
    contents.shot = electron.picture(0, 0)
    expect((await pages.drive(id, { op: 'screenshot', target: null, fullPage: false })).error).toContain('drew nothing')
    contents.driver.layout = () => ({ width: 640, height: 700, scrollX: 0, scrollY: 0, contentWidth: 640, contentHeight: 700 })
    contents.driver.locate = () => found({ rect: { x: 900, y: 900, width: 10, height: 10 } })
    expect((await pages.drive(id, { op: 'screenshot', target: { ref: 'e1' }, fullPage: false })).error).toContain(
      'takes up no space on the page, or none of it shows',
    )
    contents.driver.locate = () => ({ ok: false, why: 'Nothing on the page matches `.gone`.' })
    expect((await pages.drive(id, { op: 'screenshot', target: { selector: '.gone' }, fullPage: false })).error).toBe(
      'Nothing on the page matches `.gone`.',
    )
  })

  it('lays a page no window shows out at its own size to take it, whole', async () => {
    const { pages, id, window, view } = await shown()
    pages.show(window, id, null)
    view.bounds = { x: 0, y: 0, width: 1, height: 1 }
    const done = await pages.drive(id, { op: 'screenshot', target: null, fullPage: false })
    expect(text(done)).toContain('as drawn off screen')
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 1_280, height: 800 })
  })
})

describe('moving through the page and sizing it', () => {
  it('goes back, forward and again, and says when there is nowhere to go', async () => {
    const { pages, id, contents } = await shown()
    expect((await pages.drive(id, { op: 'move', move: 'back' })).error).toBe('There is no earlier page to go back to.')
    expect((await pages.drive(id, { op: 'move', move: 'forward' })).error).toBe('There is no later page to go forward to.')
    contents.history.back = true
    expect(text(await pages.drive(id, { op: 'move', move: 'back' }))).toContain('Went back to http://localhost:5173/ (“Refunds”).')
    expect(contents.goBack).toHaveBeenCalled()
    expect(text(await pages.drive(id, { op: 'move', move: 'reload' }))).toContain('Reloaded')
    expect(contents.reload).toHaveBeenCalled()
    expect(text(await pages.drive(id, { op: 'move', move: 'stop' }))).toContain('Stopped loading')
  })

  it('lays a page out as a device, on screen or off', async () => {
    const { pages, id, window, contents } = await shown()
    expect(text(await pages.drive(id, { op: 'viewport', viewport: 'phone' }))).toBe(
      'The page is laid out as phone (390×844, a touch screen with a mobile browser’s agent).',
    )
    expect(pages.states()[0]?.viewport).toBe('phone')
    expect(contents.commands.find((command) => command.method === 'Emulation.setDeviceMetricsOverride')?.params).toMatchObject({
      width: 390,
      height: 844,
      mobile: true,
    })
    pages.show(window, id, null)
    contents.commands.length = 0
    await pages.drive(id, { op: 'viewport', viewport: 'tablet' })
    expect(contents.commands.find((command) => command.method === 'Emulation.setDeviceMetricsOverride')?.params).toMatchObject({
      width: 820,
      height: 1_180,
      scale: 1,
    })
    expect(text(await pages.drive(id, { op: 'viewport', viewport: 'fit' }))).toContain('fit (the panel’s own size)')
    // Back to its own size, the emulation is cleared; the debugger stays for the agent, to hear of the page's dialogs.
    expect(contents.commands.some((command) => command.method === 'Emulation.clearDeviceMetricsOverride')).toBe(true)
    expect(contents.attached).toBe(true)
  })

  it('keeps the debugger the lead drives by when the viewport goes back to the panel’s own', async () => {
    const { pages, id, contents } = await shown()
    await pages.drive(id, { op: 'viewport', viewport: 'tablet' })
    await pages.drive(id, { op: 'click', target: { ref: 'e12' }, button: 'left', double: false })
    contents.commands.length = 0
    await pages.drive(id, { op: 'viewport', viewport: 'fit' })
    expect(contents.commands.map((command) => command.method)).toContain('Emulation.clearDeviceMetricsOverride')
    expect(contents.attached).toBe(true)
  })
})

describe('one thing at a time', () => {
  it('runs what an agent asks of a page in order, each after the one before ends', async () => {
    const { pages, id, contents } = await shown()
    const order: Array<string> = []
    contents.driver.locate = (target: { ref: string }) => {
      order.push(`locate ${target.ref}`)
      return found({ ref: target.ref })
    }
    await Promise.all([
      pages.drive(id, { op: 'click', target: { ref: 'e1' }, button: 'left', double: false }),
      pages.drive(id, { op: 'click', target: { ref: 'e2' }, button: 'left', double: false }),
    ])
    const presses = contents.commands
      .filter((command) => command.params.type === 'mousePressed' || command.params.type === 'mouseMoved')
      .map((command) => command.params.type)
    expect(order).toEqual(['locate e1', 'locate e2'])
    expect(presses).toEqual(['mouseMoved', 'mousePressed', 'mouseMoved', 'mousePressed'])
  })
})

const click: PageCall = { op: 'click', target: { ref: 'e12' }, button: 'left', double: false }
const snapshotted = { ok: true, text: '- button "Save" [ref=e12]', nodes: 1, truncated: false }
/** Something the page is asked that never answers, and the way to let it answer. */
const held = () => {
  let release: (value?: unknown) => void = () => undefined
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release: () => release({}) }
}

describe('the person pointing at the page to comment', () => {
  /** The person starts pointing; it lasts until `done` is called. */
  const pointing = (pages: ReturnType<typeof started>['pages'], id: string, contents: InstanceType<typeof electron.Contents>) => {
    const stop = held()
    const original = contents.executeJavaScriptInIsolatedWorld.bind(contents)
    contents.executeJavaScriptInIsolatedWorld = async (world, sources, gesture) =>
      sources[0]?.code.includes('__altharOverlay.point()') === true ? stop.promise.then(() => null) : original(world, sources, gesture)
    const ended = pages.point(id)
    return {
      done: async () => {
        stop.release()
        await ended
      },
    }
  }

  it('leaves the page alone to act on while the person points at it, and reads it all the same', async () => {
    const { pages, id, contents } = await shown()
    const person = pointing(pages, id, contents)
    expect((await pages.drive(id, click)).error).toBe(
      'The person is pointing at the page to comment on it, so Althar left the page alone. Try again once their comment is sent or closed.',
    )
    expect((await pages.drive(id, { op: 'open', url: 'http://localhost:5173/other' })).error).toContain('pointing at the page to comment')
    expect((await pages.drive(id, { op: 'evaluate', script: '1' })).error).toContain('pointing at the page to comment')
    expect(contents.commands.some((command) => command.params.type === 'mousePressed')).toBe(false)
    expect(contents.loaded).toEqual([BASE])
    expect((await pages.drive(id, { op: 'screenshot', target: null, fullPage: false })).value?.picture).toBeDefined()
    await person.done()
    expect(text(await pages.drive(id, click))).toContain('Clicked button “Save”.')
  })

  it('stops an action under way where the person starts pointing, before it presses', async () => {
    const { pages, id, contents } = await shown()
    contents.onCommand = (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') pointing(pages, id, contents)
      return undefined
    }
    expect((await pages.drive(id, click)).error).toContain('pointing at the page to comment')
    expect(contents.commands.some((command) => command.params.type === 'mousePressed')).toBe(false)
    expect(pages.states()[0]?.working).toBe(false)
  })
})

describe('a page an agent works on, as the person goes between conversations', () => {
  it('puts the one an agent used last to sleep last, and never one an agent is at work on', async () => {
    const { pages } = started()
    const window = windowOf()
    const lead = nextOwner()
    await pages.drive(lead, { op: 'open', url: 'http://localhost:5173/lead' })
    const others = [nextOwner(), nextOwner(), nextOwner()]
    const look = async (id: string, n: number) => {
      await pages.drive(id, { op: 'open', url: `http://localhost:5173/${n}` })
      pages.show(window, id, PLACE)
      pages.show(window, id, null)
    }
    await look(others[0] as string, 0)
    await look(others[1] as string, 1)
    // The lead reads its page, off screen, after the person looked at the first two.
    await pages.drive(lead, { op: 'logs', since: 0, kind: 'all' })
    await look(others[2] as string, 2)
    expect(viewOf('http://localhost:5173/0').webContents.destroyed).toBe(true)
    expect(viewOf('http://localhost:5173/lead').webContents.destroyed).toBe(false)

    // An action under way keeps its page awake, however long ago the agent began it.
    const contents = viewOf('http://localhost:5173/lead').webContents
    contents.driver = { locate: () => found(), input: () => 0 }
    const moving = held()
    contents.onCommand = (method, params) =>
      method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved' ? moving.promise : undefined
    const clicking = pages.drive(lead, click)
    await vi.waitFor(() => expect(contents.commands.some((command) => command.params.type === 'mouseMoved')).toBe(true))
    for (const n of [3, 4, 5]) await look(nextOwner(), n)
    expect(contents.destroyed).toBe(false)
    moving.release()
    expect(text(await clicking)).toContain('Clicked button “Save”.')
  })

  it('wakes a page with its log carried on, and the refs of the page as it was before it slept stale', async () => {
    const { pages } = started()
    const window = windowOf()
    const ids = [nextOwner(), nextOwner(), nextOwner(), nextOwner()]
    for (const [n, id] of ids.entries()) {
      await pages.drive(id, { op: 'open', url: `http://localhost:5173/${n}` })
      pages.show(window, id, PLACE)
      if (n === 0) {
        const first = viewOf('http://localhost:5173/0').webContents
        first.emit('console-message', { level: 'info', message: 'one', lineNumber: 0, sourceId: '', frame: { parent: null } })
        first.emit('console-message', { level: 'info', message: 'two', lineNumber: 0, sourceId: '', frame: { parent: null } })
        first.driver = { snapshot: () => snapshotted, locate: () => found(), input: () => 0 }
        await pages.drive(id, { op: 'snapshot', target: null })
      }
      pages.show(window, id, null)
    }
    const first = ids[0] as string
    expect(text(await pages.drive(first, { op: 'state' }))).toContain('Log mark: 2')
    expect(text(await pages.drive(first, { op: 'logs', since: 2, kind: 'all' }))).toContain('nothing new since 2')
    const revived = electron.views.findLast((view) => view.webContents.url === 'http://localhost:5173/0')?.webContents
    revived?.emit('console-message', { level: 'info', message: 'three', lineNumber: 0, sourceId: '', frame: { parent: null } })
    const read = text(await pages.drive(first, { op: 'logs', since: 2, kind: 'all' }))
    expect(read).toContain('three')
    expect(read).not.toContain('dropped')
    expect((await pages.drive(first, click)).error).toBe(
      'e12 is from a snapshot of the page as it was before it loaded again, so it may name something else now. Take a new snapshot and use its refs.',
    )
  })
})

describe('references, of one document at a time', () => {
  it('says a ref from before the page loaded again is stale, and takes the new snapshot’s', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.snapshot = () => snapshotted
    await pages.drive(id, { op: 'snapshot', target: null })
    expect(text(await pages.drive(id, click))).toContain('Clicked button “Save”.')
    // The dev server reloads the page: its new document's refs start again, and e12 may be anything in it.
    contents.emit('did-navigate', {}, BASE)
    for (const call of [
      click,
      { op: 'type', target: { ref: 'e12' }, text: 'x', replace: true, submit: false },
      { op: 'snapshot', target: { ref: 'e12' } },
      { op: 'wait', text: null, gone: null, target: { ref: 'e12' }, seconds: 1 },
    ] satisfies ReadonlyArray<PageCall>)
      expect((await pages.drive(id, call)).error, call.op).toContain('e12 is from a snapshot of the page as it was before it loaded again')
    // A selector names what is there now.
    expect(text(await pages.drive(id, { ...click, target: { selector: 'button.save' } }))).toContain('Clicked button “Save”.')
    await pages.drive(id, { op: 'snapshot', target: null })
    expect(text(await pages.drive(id, click))).toContain('Clicked button “Save”.')
  })

  it('reads again a snapshot taken as the page loaded, before its refs are used', async () => {
    const { pages, id, contents } = await shown()
    contents.driver.snapshot = () => {
      contents.emit('did-navigate', {}, BASE)
      return snapshotted
    }
    await pages.drive(id, { op: 'snapshot', target: null })
    expect((await pages.drive(id, click)).error).toContain('e12 is from a snapshot of the page as it was before it loaded again')
  })
})

describe('dialogs the page opens', () => {
  const confirm = { type: 'confirm', message: 'Delete it?', defaultPrompt: '' }
  /** The page opens `dialog` as the press is let go, and answers nothing more while it holds the page. */
  const opensOnPress = (contents: InstanceType<typeof electron.Contents>, dialog: Record<string, unknown>) => {
    contents.onCommand = (method, params) => {
      if (method !== 'Input.dispatchMouseEvent' || params.type !== 'mouseReleased') return undefined
      contents.tellsOf('Page.javascriptDialogOpening', dialog)
      return new Promise(() => undefined)
    }
  }

  it('stops an action at the dialog it opened, says what it asks, and answers it as the agent says', async () => {
    const { pages, id, contents } = await shown()
    opensOnPress(contents, confirm)
    expect(text(await pages.drive(id, click))).toBe(
      'As you acted, the page opened a confirm dialog saying “Delete it?”, and nothing in it runs until it is answered: page_dialog answers it, OK with accept or Cancel without. The person can answer it too.',
    )
    // What else is asked of the page hears of it at once, rather than waiting on a page that answers nothing.
    contents.onCommand = () => undefined
    for (const call of [click, { op: 'snapshot', target: null }, { op: 'open', url: BASE }] satisfies ReadonlyArray<PageCall>)
      expect((await pages.drive(id, call)).error, call.op).toContain('The page shows a confirm dialog saying “Delete it?”')
    expect(text(await pages.drive(id, { op: 'state' }))).toContain('The page shows a confirm dialog saying “Delete it?”')
    expect(text(await pages.drive(id, { op: 'logs', since: 0, kind: 'all' }))).toContain('nothing new')

    const sheet = vi.fn()
    contents.on('-cancel-dialogs', sheet)
    const answered = await pages.drive(id, { op: 'dialog', accept: false, text: null })
    expect(text(answered)).toContain('Answered Cancel to the confirm dialog “Delete it?”.')
    // Electron's own sheet of it on the window goes too.
    expect(sheet).toHaveBeenCalledTimes(1)
    expect(
      contents.commands.filter((command) => command.method === 'Page.handleJavaScriptDialog').map((command) => command.params),
    ).toEqual([{ accept: false }])
    expect((await pages.drive(id, { op: 'dialog', accept: true, text: null })).error).toBe('No dialog is open on the page now.')
    expect(text(await pages.drive(id, click))).toContain('Clicked button “Save”.')
  })

  it('answers a prompt with the agent’s words', async () => {
    const { pages, id, contents } = await shown()
    opensOnPress(contents, { type: 'prompt', message: 'Name?', defaultPrompt: 'Ada' })
    await pages.drive(id, click)
    contents.onCommand = () => undefined
    expect(text(await pages.drive(id, { op: 'dialog', accept: true, text: 'Grace' }))).toContain(
      'Answered the prompt “Name?” with “Grace”.',
    )
    expect(contents.commands.find((command) => command.method === 'Page.handleJavaScriptDialog')?.params).toEqual({
      accept: true,
      promptText: 'Grace',
    })
  })

  it('ends a call the page holds up with a dialog it opened, such as a script’s alert', async () => {
    const { pages, id, contents } = await shown()
    contents.evaluated = (code) => {
      if (!code.startsWith('(async () => (')) return true
      setTimeout(() => contents.tellsOf('Page.javascriptDialogOpening', { type: 'alert', message: 'Saved.' }), 1)
      return new Promise(() => undefined)
    }
    expect(text(await pages.drive(id, { op: 'evaluate', script: 'alert("Saved.")' }))).toContain(
      'As you acted, the page opened an alert saying “Saved.”',
    )
  })

  it('hears a dialog the page opened on its own, and that the person answered it', async () => {
    const { pages, id, contents } = await shown()
    contents.tellsOf('Page.javascriptDialogOpening', { type: 'alert', message: 'Session ending.' })
    expect((await pages.drive(id, { op: 'snapshot', target: null })).error).toContain('The page shows an alert saying “Session ending.”')
    contents.tellsOf('Page.javascriptDialogClosed', { result: true })
    contents.driver.snapshot = () => snapshotted
    expect(text(await pages.drive(id, { op: 'snapshot', target: null }))).toContain('button "Save" [ref=e12]')
    // A leave-page one never shows here, so it is no dialog to answer.
    contents.tellsOf('Page.javascriptDialogOpening', { type: 'beforeunload', message: '' })
    expect(text(await pages.drive(id, { op: 'snapshot', target: null }))).toContain('button "Save" [ref=e12]')
  })

  it('leaves a page that asks to stay as the lead’s action leaves it, and says so; the person’s own leaving stays the page’s to stop', async () => {
    const { pages, id, contents } = await shown()
    const asked: Array<{ preventDefault: ReturnType<typeof vi.fn> }> = []
    const unload = () => {
      const event = { preventDefault: vi.fn() }
      asked.push(event)
      contents.emit('will-prevent-unload', event)
    }
    contents.onCommand = (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') unload()
      return undefined
    }
    expect(text(await pages.drive(id, click))).toContain(
      'The page asked to stay, as a page does when something in it isn’t saved; it was left all the same.',
    )
    expect(asked[0]?.preventDefault).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, NOW.fade + 20))
    unload()
    expect(asked[1]?.preventDefault).not.toHaveBeenCalled()
    contents.onCommand = () => undefined
    expect(text(await pages.drive(id, click))).not.toContain('asked to stay')
  })
})

describe('what the page gets from Althar reading it', () => {
  it('reads it without a user gesture, so its scripts get no activation from it, and runs the agent’s own script with one', async () => {
    const { pages, id, contents } = await shown()
    await pages.drive(id, click)
    const reads = contents.gestures.filter((one) => one.world === 7_301)
    expect(reads.length).toBeGreaterThan(3)
    expect(reads.every((one) => !one.gesture)).toBe(true)
    contents.evaluated = (code) => (code.startsWith('(async () => (') ? 2 : true)
    await pages.drive(id, { op: 'evaluate', script: '1 + 1' })
    // The probe that only compiles it, then the script itself.
    expect(contents.gestures.filter((one) => one.world === 7_302).map((one) => one.gesture)).toEqual([false, true])
  })
})

describe('a call the runtime gave up on', () => {
  it('isn’t done where its turn comes after, and stops at its next step where it was under way', async () => {
    const { pages, id, contents } = await shown()
    const moving = held()
    contents.onCommand = (method, params) =>
      method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved' ? moving.promise : undefined
    const first = pages.drive(id, click)
    const given = new AbortController()
    const second = pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund', replace: true, submit: false }, given.signal)
    await vi.waitFor(() => expect(contents.commands.some((command) => command.params.type === 'mouseMoved')).toBe(true))
    given.abort()
    moving.release()
    expect(text(await first)).toContain('Clicked button “Save”.')
    expect((await second).error).toBe('This was stopped before it was done: the call it came with was over.')
    expect(contents.commands.some((command) => command.method === 'Input.insertText')).toBe(false)

    const under = new AbortController()
    contents.onCommand = (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') under.abort()
      return undefined
    }
    const presses = contents.commands.filter((command) => command.params.type === 'mousePressed').length
    expect((await pages.drive(id, click, under.signal)).error).toBe('This was stopped before it was done: the call it came with was over.')
    expect(contents.commands.filter((command) => command.params.type === 'mousePressed')).toHaveLength(presses)
  })

  it('does nothing of what waited its turn behind an action the person’s input stopped, and goes on after', async () => {
    const { pages, id, contents } = await shown()
    let n = 0
    const counts = [0, 2]
    contents.driver.input = () => counts[Math.min(n++, counts.length - 1)]
    const moving = held()
    contents.onCommand = (method, params) =>
      method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved' ? moving.promise : undefined
    const first = pages.drive(id, click)
    const second = pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund', replace: true, submit: false })
    await vi.waitFor(() => expect(contents.commands.some((command) => command.params.type === 'mouseMoved')).toBe(true))
    moving.release()
    expect((await first).error).toContain('so the action stopped')
    expect((await second).error).toBe(
      'The person clicked, typed or scrolled in the page while this waited its turn, so it wasn’t done. Take a new snapshot to see where the page is now.',
    )
    expect(contents.commands.some((command) => command.method === 'Input.insertText')).toBe(false)
    contents.onCommand = () => undefined
    expect(text(await pages.drive(id, click))).toContain('Clicked button “Save”.')
  })
})

describe('a page that doesn’t answer', () => {
  it('gives up on a picture the compositor never gives, and says so', async () => {
    const { pages, id, contents } = await shown()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    contents.capturing = () => new Promise(() => undefined)
    const shot = pages.drive(id, { op: 'screenshot', target: null, fullPage: false })
    await vi.advanceTimersByTimeAsync(16_000)
    expect((await shot).error).toBe('The page drew nothing to take a picture of. If it is loading or blank, wait a moment and try again.')
    // And what waited its turn behind it goes on.
    contents.capturing = async () => contents.shot
    const next = pages.drive(id, { op: 'screenshot', target: null, fullPage: false })
    await vi.advanceTimersByTimeAsync(100)
    expect((await next).value?.picture).toBeDefined()
  })

  it('keeps a wait to the time it was given, however long a look takes, and takes a look unanswered for neither there nor gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { pages, id, contents } = await shown()
    contents.driver.has = () => new Promise(() => undefined)
    const began = Date.now()
    const done = await finishing(pages.drive(id, { op: 'wait', text: null, gone: 'Loading…', target: null, seconds: 1 }))
    expect(done.error).toBe('After 1 second, the page didn’t answer when Althar looked.')
    expect(Date.now() - began).toBeLessThan(1_100)
    // A look that answers late, still in time, counts; the next one finds the words gone.
    let looks = 0
    contents.driver.has = () => (++looks === 1 ? new Promise((resolve) => setTimeout(() => resolve(true), 1_500)) : false)
    const from = Date.now()
    const slow = await finishing(pages.drive(id, { op: 'wait', text: null, gone: 'Loading…', target: null, seconds: 2 }))
    expect(text(slow)).toBe('It is there now.')
    expect(Date.now() - from).toBeLessThan(2_000)
  })
})

describe('a field that takes typing its own way', () => {
  it('leaves what a mask or an editor made of the typing as it is, and says so', async () => {
    const { pages, id, contents } = await shown()
    let value = ''
    contents.driver.locate = () => found({ role: 'textbox', name: 'Phone', editable: true })
    contents.driver.valueOf = () => value
    contents.onCommand = (method) => {
      if (method === 'Input.insertText') value = '(555) 123-4567'
      return undefined
    }
    const done = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: '5551234567', replace: true, submit: false })
    expect(text(done)).toContain(
      'The field changed what was typed as it took it (a mask, or an editor’s own formatting). page_snapshot shows what it holds now.',
    )
    expect(contents.asks.some((ask) => ask.method === 'fill')).toBe(false)
    // A field that already held exactly what is typed over it hasn't ignored the typing.
    value = 'refund'
    contents.onCommand = () => undefined
    const same = await pages.drive(id, { op: 'type', target: { ref: 'e3' }, text: 'refund', replace: true, submit: false })
    expect(text(same)).not.toContain('ignored typing')
    expect(contents.asks.some((ask) => ask.method === 'fill')).toBe(false)
  })
})

describe('a page beside the coordinator', () => {
  it('is a project’s own, in the project’s own session', async () => {
    const { pages } = started()
    const id = projectOwner()
    const done = await pages.drive(id, { op: 'open', url: BASE })
    expect(done.error).toBeUndefined()
    expect(electron.sessions.has(`persist:project-${id.slice('proj_'.length)}`)).toBe(true)
    expect(text(await pages.drive(id, { op: 'state' }))).toContain('Page beside this project’s conversation:')
  })
})
