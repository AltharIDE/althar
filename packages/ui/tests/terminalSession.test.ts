import { afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalSession, type TerminalSessionOptions, themeOf } from '../src/chrome/TerminalView/session'

const sessions: TerminalSession[] = []
const FIND = { caseSensitive: false, wholeWord: false, regex: false }

const make = (over: Partial<Omit<TerminalSessionOptions, 'onData' | 'onResize'>> = {}) => {
  const options = { onData: vi.fn(), onResize: vi.fn(), ...over }
  const session = new TerminalSession(options)
  sessions.push(session)
  return { session, options }
}

const press = (session: TerminalSession, key: string, mods: Partial<KeyboardEventInit> = {}, type = 'keydown') => {
  const event = new KeyboardEvent(type, { key, cancelable: true, ...mods })
  const keep = (session as unknown as { key: (event: KeyboardEvent) => boolean }).key(event)
  return { keep, event }
}

const setFonts = (value: unknown) => Object.defineProperty(document, 'fonts', { value, configurable: true, writable: true })

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts')
  for (const session of sessions.splice(0)) session.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('a terminal session’s keys', () => {
  it('leaves key releases and the window’s own toggle alone', () => {
    const { session } = make({ platform: 'linux' })
    expect(press(session, 'a', {}, 'keyup').keep).toBe(true)
    expect(press(session, '`', { ctrlKey: true }).keep).toBe(false)
    expect(press(session, 'a').keep).toBe(true)
  })

  it('answers a Mac’s editing keys itself, and keeps ⌘ with anything else from the shell', () => {
    const { session, options } = make({ platform: 'darwin' })
    const left = press(session, 'ArrowLeft', { metaKey: true })
    expect(left.keep).toBe(false)
    expect(left.event.defaultPrevented).toBe(true)
    expect(options.onData).toHaveBeenCalledWith('\x01')
    expect(press(session, 'w', { metaKey: true }).keep).toBe(false)
    expect(press(session, 'a').keep).toBe(true)
  })

  it('runs a shortcut’s action instead of sending the key', () => {
    const { session } = make({ platform: 'darwin' })
    const onFind = vi.fn()
    session.onFind = onFind
    const found = press(session, 'f', { metaKey: true })
    expect(found.keep).toBe(false)
    expect(found.event.defaultPrevented).toBe(true)
    expect(onFind).toHaveBeenCalledOnce()
  })
})

describe('a terminal session’s actions', () => {
  it('copies what is chosen, and nothing when nothing is', () => {
    const { session } = make()
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    session.act('copy')
    expect(writeText).not.toHaveBeenCalled()
    session.write('hello\r\n')
    session.act('selectAll')
    vi.spyOn(session.term, 'getSelection').mockReturnValue('hello')
    session.act('copy')
    expect(writeText).toHaveBeenCalledWith('hello')
    vi.unstubAllGlobals()
  })

  it('pastes through the Edit menu where it has one, else from the clipboard', async () => {
    const onPaste = vi.fn()
    const { session } = make({ onPaste })
    session.act('paste')
    expect(onPaste).toHaveBeenCalledOnce()

    const { session: bare } = make()
    const paste = vi.spyOn(bare.term, 'paste').mockImplementation(() => {})
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve('text') } })
    bare.act('paste')
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith('text'))
    vi.stubGlobal('navigator', {})
    expect(() => bare.act('paste')).not.toThrow()
    expect(() => bare.act('copy')).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('clears, and says nothing where nobody listens for find', () => {
    const { session } = make()
    const clear = vi.spyOn(session.term, 'clear')
    session.act('clear')
    expect(clear).toHaveBeenCalledOnce()
    expect(() => session.act('find')).not.toThrow()
  })
})

describe('a terminal session’s place', () => {
  it('opens once mounted, keeps its size, moves between places, and is gone once disposed', async () => {
    const { session, options } = make()
    const one = document.createElement('div')
    const two = document.createElement('div')
    document.body.append(one, two)
    session.mount(one)
    session.mount(one)
    session.mount(two)
    expect(session.element.parentElement).toBe(two)
    session.unmount()
    expect(session.element.isConnected).toBe(false)
    session.fit()
    expect(options.onResize.mock.calls.length).toBeLessThanOrEqual(1)
    expect(typeof session.cols).toBe('number')
    expect(typeof session.rows).toBe('number')
    session.dispose()
    session.dispose()
    session.mount(one)
    session.write('ignored')
    expect(session.element.isConnected).toBe(false)
  })

  it('waits for its type to load before drawing, and draws all the same if it fails', async () => {
    for (const load of [() => Promise.resolve([]), () => Promise.reject(new Error('no'))]) {
      const { session } = make()
      setFonts({ check: () => false, load })
      const host = document.createElement('div')
      document.body.append(host)
      session.mount(host)
      await expect(
        Promise.race([session.drawn.then(() => 'drawn'), new Promise((r) => setTimeout(() => r('undrawn'), 50))]),
      ).resolves.toBeTypeOf('string')
      vi.restoreAllMocks()
    }
  })

  it('draws at once with no fonts api', () => {
    const { session } = make()
    setFonts(undefined)
    const open = vi.spyOn(session.term, 'open').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.append(host)
    session.mount(host)
    expect(open).toHaveBeenCalledOnce()
  })

  it('stays undrawn where the page cannot draw it', async () => {
    const { session } = make()
    vi.spyOn(session.term, 'open').mockImplementation(() => {
      throw new Error('no canvas')
    })
    setFonts({ check: () => true })
    const host = document.createElement('div')
    document.body.append(host)
    session.mount(host)
    expect(session.element.parentElement).toBe(host)
  })

  it('fits to where it is, and tells its size once', () => {
    const { session, options } = make()
    const host = document.createElement('div')
    document.body.append(host)
    session.mount(host)
    Object.defineProperty(session.element, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(session.element, 'clientHeight', { value: 200, configurable: true })
    const internals = session as unknown as { fitter: { fit: () => void } }
    vi.spyOn(session.term, 'element', 'get').mockReturnValue(document.createElement('div'))
    const fit = vi.spyOn(internals.fitter, 'fit').mockImplementation(() => {
      throw new Error('not measurable')
    })
    session.fit()
    session.fit()
    expect(fit).toHaveBeenCalledTimes(2)
    expect(options.onResize).toHaveBeenCalledTimes(1)
    session.term.resize(100, 30)
    expect(options.onResize).toHaveBeenLastCalledWith(100, 30)
  })
})

describe('a terminal session’s find', () => {
  it('finds by what is typed, goes on and back, and ends with its marks gone', () => {
    const { session } = make()
    const results = vi.fn()
    session.onFindResults = results
    expect(session.findAgain(FIND, false)).toBe(false)
    expect(session.find('', FIND)).toBe(false)
    expect(results).toHaveBeenCalledWith({ index: -1, count: 0 })
    session.write('one two one\r\n')
    expect(typeof session.find('one', FIND)).toBe('boolean')
    expect(typeof session.findAgain(FIND, false)).toBe('boolean')
    expect(typeof session.findAgain(FIND, true)).toBe('boolean')
    session.endFind()
    expect(session.findAgain(FIND, false)).toBe(false)
  })

  it('follows a press only with the primary key held', () => {
    const onLink = vi.fn()
    const mac = make({ platform: 'darwin', onLink }).session
    const other = make({ platform: 'linux', onLink }).session
    const primary = (s: TerminalSession, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>) =>
      (s as unknown as { primary: (e: typeof event) => boolean }).primary(event)
    expect(primary(mac, { metaKey: true, ctrlKey: false })).toBe(true)
    expect(primary(mac, { metaKey: false, ctrlKey: true })).toBe(false)
    expect(primary(other, { metaKey: false, ctrlKey: true })).toBe(true)
  })
})

describe('a file dropped on a terminal', () => {
  const drop = (session: TerminalSession, type: string, files: File[]) => {
    const event = new Event(type, { cancelable: true }) as Event & { dataTransfer?: unknown }
    event.dataTransfer = { files, types: files.length > 0 ? ['Files'] : [] }
    session.element.dispatchEvent(event)
    return event
  }

  it('types its path, quoted, and does nothing without a way to read it', () => {
    const file = new File([''], 'a b.txt')
    const { session } = make({ platform: 'linux', pathOf: (f) => (f === file ? '/x/a b.txt' : '') })
    const paste = vi.spyOn(session.term, 'paste').mockImplementation(() => {})
    expect(drop(session, 'dragover', [file]).defaultPrevented).toBe(true)
    expect(drop(session, 'dragover', []).defaultPrevented).toBe(false)
    expect(drop(session, 'drop', [file]).defaultPrevented).toBe(true)
    expect(paste).toHaveBeenCalledWith("'/x/a b.txt' ")
    paste.mockClear()
    drop(session, 'drop', [new File([''], 'other')])
    expect(paste).not.toHaveBeenCalled()
    drop(session, 'drop', [])
    const none = make().session
    expect(drop(none, 'dragover', [file]).defaultPrevented).toBe(false)
    expect(drop(none, 'drop', [file]).defaultPrevented).toBe(false)
  })
})

describe('a terminal’s colours', () => {
  it('take the kit’s tokens where the page has them, and fall back where it does not', () => {
    const bare = themeOf(document.documentElement)
    expect(bare.background).toBe('#ffffff')
    expect(bare.red).toBe(bare.foreground)
    document.documentElement.style.setProperty('--terminal-paper', '#101010')
    document.documentElement.style.setProperty('--ansi-bright-red', '#ff0000')
    const set = themeOf(document.documentElement)
    expect(set.background).toBe('#101010')
    expect(set.brightRed).toBe('#ff0000')
    document.documentElement.removeAttribute('style')
  })
})
