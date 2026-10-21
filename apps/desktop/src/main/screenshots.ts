import type { Screenshot, Shot } from '@althar/runtime'

/*
 * A screenshot an agent asked Althar for, taken here, where Chromium is
 * (packages/runtime, screenshots.ts): a page drawn in a window no one sees,
 * offscreen, at the viewport asked, in a session of its own that keeps
 * nothing and is granted nothing, then captured, the whole page or one
 * element, and sent back at 1×. The runtime has checked the page is served on
 * this computer; a page it goes on to fetch from elsewhere is drawn as a
 * browser would.
 */

/** How long a page may take to load and draw before Althar gives up on it. */
export const WITHIN_MS = 30_000
/** The tallest a whole page is taken: a page longer than this is cut there. */
export const TALLEST = 16_000

/** What of a window a screenshot needs, as Electron's BrowserWindow has it; a test gives its own. */
export interface PageWindow {
  load(url: string): Promise<void>
  run<T>(script: string): Promise<T>
  resize(width: number, height: number): void
  capture(rect?: { x: number; y: number; width: number; height: number }): Promise<Picture>
  title(): string
  close(): void
}

/** A captured picture, as Electron's NativeImage has it. */
export interface Picture {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number }): Picture
  toPNG(): Uint8Array
}

/** Waits for the page's fonts and two frames, so what it draws as it loads is drawn. */
const SETTLED = `(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))`

/** The first element a selector finds, scrolled to, as where it is in the viewport; null where it finds none, a string where it can't read. */
const ELEMENT = (selector: string) => `(() => {
  let found
  try { found = document.querySelector(${JSON.stringify(selector)}) } catch (error) { return String(error && error.message || error) }
  if (!found) return null
  found.scrollIntoView({ block: 'start', inline: 'start' })
  const box = found.getBoundingClientRect()
  return { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)), width: Math.ceil(box.width), height: Math.ceil(box.height) }
})()`

const HEIGHT = 'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)'

/** Why a page didn't load, in words for the agent, from Electron's error. */
const loadFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const code = /\b(ERR_[A-Z_]+)\b/.exec(message)?.[1]
  return code === undefined ? `the page didn't load: ${message}` : `the page didn't load: ${code}`
}

const timedOut = <T>(promise: Promise<T>, ms: number, why: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(why)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })

/** Takes a screenshot in a window `open` makes at the viewport's size; it rejects with why, in words for the agent. */
export const takeScreenshot = async (
  shot: Shot,
  open: (width: number, height: number) => PageWindow,
  within = WITHIN_MS,
): Promise<Screenshot> => {
  const window = open(shot.width, shot.height)
  try {
    const drawn = async () => {
      try {
        await window.load(shot.url)
      } catch (error) {
        throw new Error(loadFailure(error))
      }
      await window.run(SETTLED)
      if (shot.fullPage) {
        const height = Math.min(TALLEST, Math.max(shot.height, Math.ceil(await window.run<number>(HEIGHT))))
        if (height !== shot.height) {
          window.resize(shot.width, height)
          await window.run(SETTLED)
        }
      }
      let rect: { x: number; y: number; width: number; height: number } | undefined
      if (shot.selector !== null) {
        const found = await window.run<{ x: number; y: number; width: number; height: number } | string | null>(ELEMENT(shot.selector))
        if (found === null) throw new Error(`nothing on the page matches ${shot.selector}`)
        if (typeof found === 'string') throw new Error(`${shot.selector} isn't a selector the page can read: ${found}`)
        if (found.width === 0 || found.height === 0) throw new Error(`${shot.selector} takes up no space on the page`)
        await window.run(SETTLED)
        rect = found
      }
      return { picture: await window.capture(rect), wanted: rect?.width ?? shot.width }
    }
    const { picture, wanted } = await timedOut(drawn(), within, `the page took longer than ${Math.round(within / 1000)} seconds to draw`)
    if (picture.isEmpty()) throw new Error('the page drew nothing')
    // At 1×: a screen at 2× draws twice as many pixels, which the agent would read for nothing.
    const sized = picture.getSize().width > wanted ? picture.resize({ width: wanted }) : picture
    const { width, height } = sized.getSize()
    return { png: Buffer.from(sized.toPNG()).toString('base64'), width, height, title: window.title() }
  } finally {
    window.close()
  }
}
