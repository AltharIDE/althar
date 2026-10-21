import { Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { type PageWindow, type Picture, TALLEST, takeScreenshot } from '../src/main/screenshots'
import { screenshotsWith } from '../src/runtime/screenshots'

/** A picture of a size, as Electron's capture gives one: at 2× where the screen draws so. */
const picture = (width: number, height: number): Picture => ({
  isEmpty: () => width === 0,
  getSize: () => ({ width, height }),
  resize: ({ width: to }) => picture(to, Math.round((height * to) / width)),
  toPNG: () => new TextEncoder().encode(`png ${width}x${height}`),
})

/** A window that draws a page `tall` pixels high, finds `element` where asked, and keeps what it was asked. */
const windowOf = (options: { tall?: number; element?: unknown; scale?: number; fails?: Error; hangs?: boolean; strays?: string } = {}) => {
  const asked: Array<string> = []
  let size = { width: 0, height: 0 }
  const scale = options.scale ?? 1
  const window: PageWindow = {
    load: vi.fn(async (url: string) => {
      asked.push(`load ${url}`)
      if (options.fails !== undefined) throw options.fails
      if (options.hangs === true) await new Promise(() => {})
    }),
    run: async <T>(script: string) => {
      if (script.includes('scrollHeight')) return (options.tall ?? size.height) as T
      if (script.includes('querySelector')) return (options.element ?? null) as T
      return true as T
    },
    resize: vi.fn((width: number, height: number) => {
      asked.push(`resize ${width}x${height}`)
      size = { width, height }
    }),
    capture: vi.fn(async (rect) => {
      asked.push(rect === undefined ? 'capture' : `capture ${rect.x},${rect.y} ${rect.width}x${rect.height}`)
      return rect === undefined ? picture(size.width * scale, size.height * scale) : picture(rect.width * scale, rect.height * scale)
    }),
    title: () => 'Meridian',
    strayed: () => options.strays ?? null,
    close: () => void asked.push('close'),
  }
  let allowed: (url: string) => boolean = () => false
  const open = (width: number, height: number, allows: (url: string) => boolean) => {
    allowed = allows
    size = { width, height }
    asked.push(`open ${width}x${height}`)
    return window
  }
  const closed = () => asked.filter((one) => one === 'close').length
  return { open, window, asked, closed, allows: (url: string) => allowed(url) }
}

const shot = { url: 'http://localhost:5173/', width: 800, height: 600, fullPage: false, selector: null, origins: [] }

describe('a screenshot drawn offscreen', () => {
  it('takes the viewport at 1×, on a screen that draws at 2× too, and closes its window', async () => {
    const { open, asked } = windowOf({ scale: 2 })
    const taken = await takeScreenshot(shot, open)
    expect(taken).toEqual({
      png: Buffer.from('png 800x600').toString('base64'),
      width: 800,
      height: 600,
      title: 'Meridian',
    })
    expect(asked).toEqual(['open 800x600', 'load http://localhost:5173/', 'capture', 'close'])
  })

  it('takes the whole page as tall as it is, cut at the tallest it takes', async () => {
    const whole = windowOf({ tall: 2400 })
    expect((await takeScreenshot({ ...shot, fullPage: true }, whole.open)).height).toBe(2400)
    expect(whole.asked).toContain('resize 800x2400')
    // A page no taller than the viewport is taken as it is.
    const short = windowOf({ tall: 300 })
    await takeScreenshot({ ...shot, fullPage: true }, short.open)
    expect(short.asked).not.toContain('resize 800x300')
    const endless = windowOf({ tall: 90_000 })
    expect((await takeScreenshot({ ...shot, fullPage: true }, endless.open)).height).toBe(TALLEST)
  })

  it('takes one element, where it is once scrolled to, and says where none is, or the selector is wrong', async () => {
    const card = windowOf({ element: { x: 64, y: 0, width: 336, height: 104 }, scale: 2 })
    const taken = await takeScreenshot({ ...shot, selector: '#card' }, card.open)
    expect(card.asked).toContain('capture 64,0 336x104')
    expect([taken.width, taken.height]).toEqual([336, 104])
    await expect(takeScreenshot({ ...shot, selector: '#nope' }, windowOf().open)).rejects.toThrow('nothing on the page matches #nope')
    await expect(takeScreenshot({ ...shot, selector: 'div[' }, windowOf({ element: 'not a valid selector' }).open)).rejects.toThrow(
      "div[ isn't a selector the page can read: not a valid selector",
    )
    await expect(
      takeScreenshot({ ...shot, selector: '#hidden' }, windowOf({ element: { x: 0, y: 0, width: 0, height: 0 } }).open),
    ).rejects.toThrow('#hidden takes up no space on the page')
  })

  it('says why a page didn’t load or draw, in a few words, and closes its window all the same', async () => {
    const refused = windowOf({ fails: new Error("ERR_CONNECTION_REFUSED (-102) loading 'http://localhost:5173/'") })
    await expect(takeScreenshot(shot, refused.open)).rejects.toThrow("the page didn't load: ERR_CONNECTION_REFUSED")
    expect(refused.closed()).toBe(1)
    await expect(takeScreenshot(shot, windowOf({ fails: new Error('no reason') }).open)).rejects.toThrow("the page didn't load: no reason")
    const slow = windowOf({ hangs: true })
    await expect(takeScreenshot(shot, slow.open, 50)).rejects.toThrow('the page took longer than 0 seconds to draw')
    expect(slow.closed()).toBe(1)
    const blank = windowOf()
    blank.window.capture = async () => picture(0, 0)
    await expect(takeScreenshot(shot, blank.open)).rejects.toThrow('the page drew nothing')
  })

  it('lets the page go only where the shot may be of, and says where it went instead of loading', async () => {
    const window = windowOf({ fails: new Error('ERR_ABORTED (-3)'), strays: 'https://example.com/' })
    await expect(takeScreenshot({ ...shot, origins: ['http://studio.lan:3000'] }, window.open)).rejects.toThrow(
      "the page went on to https://example.com/, which isn't served on this computer, so Althar didn't follow it",
    )
    expect(window.closed()).toBe(1)
    for (const url of [
      'http://localhost:6006/',
      'http://127.0.0.1/a',
      'http://studio.lan:3000/b',
      'about:blank',
      'about:srcdoc',
      'data:text/html,hi',
    ])
      expect(window.allows(url), url).toBe(true)
    for (const url of ['https://example.com/', 'http://studio.lan:4000/', 'file:///etc/passwd', 'ftp://localhost/'])
      expect(window.allows(url), url).toBe(false)
  })
})

describe('a screenshot the runtime asks the main process for', () => {
  it('posts the shot, and takes back the picture, or why not', async () => {
    const posted: Array<{ readonly requestId: string; readonly shot: unknown }> = []
    const { ask, answer } = screenshotsWith((message) => posted.push(message))
    const taking = Effect.runPromise(ask(shot))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const value = { png: 'cG5n', width: 800, height: 600, title: 'Meridian' }
    answer(posted[0]?.requestId ?? '', { value })
    expect(await taking).toEqual(value)
    expect(posted[0]?.shot).toEqual(shot)

    const failing = Effect.runPromiseExit(ask(shot))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    answer(posted[1]?.requestId ?? '', { error: 'nothing on the page matches #nope' })
    const exit = await failing
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('nothing on the page matches #nope')
    // An answer for nothing asked is let go.
    answer('gone', {})
  })
})
