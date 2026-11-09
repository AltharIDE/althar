import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'

import { type Rect, isViewport } from './devices'
import { isPageMove, type PagePin } from './page'
import type { Pages } from './pages'

/*
 * How Althar's own windows reach the pages beside their conversations
 * (ADR-100): every call checked to come from one of Althar's windows, never
 * a page, and every argument checked for what it should be, as anything
 * crossing a process is. A page itself has no preload, so it has no way to
 * send anything here at all; the check holds even so. Nothing here lets a
 * window or a page drive a page as the lead does: that is `drive`, which only
 * the runtime's own process reaches (bridge.ts).
 */

const LONGEST_ADDRESS = 8_192
const SIDE = 100_000

const finite = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= SIDE

/** A place in the window, in its pixels, where every side is a number it can be; null for anything else. */
export const rectOf = (value: unknown): Rect | null => {
  if (typeof value !== 'object' || value === null) return null
  const { x, y, width, height } = value as Record<string, unknown>
  return finite(x, -SIDE) && finite(y, -SIDE) && finite(width, 0) && finite(height, 0) ? { x, y, width, height } : null
}

const textOf = (value: unknown, longest: number): string | null =>
  typeof value === 'string' && value.length <= longest && !value.includes('\u0000') ? value : null

/** Comments' pins as the window sends them, each whole, at most a hundred; null where any isn't. */
export const pinsOf = (value: unknown): ReadonlyArray<PagePin> | null => {
  if (!Array.isArray(value) || value.length > 100) return null
  const pins: Array<PagePin> = []
  for (const one of value as ReadonlyArray<unknown>) {
    if (typeof one !== 'object' || one === null) return null
    const { n, selector, address } = one as Record<string, unknown>
    const said = textOf(selector, 4_000)
    const at = textOf(address, LONGEST_ADDRESS)
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 999 || said === null || said === '' || at === null) return null
    pins.push({ n, selector: said, address: at })
  }
  return pins
}

export const handlePages = (pages: Pages, mine: (contents: WebContents) => boolean) => {
  const from = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    if (!mine(event.sender)) throw new Error('Only Althar’s own windows reach its pages.')
  }
  const ownerIn = (owner: unknown) => {
    if (typeof owner !== 'string') throw new Error('No page is named so.')
    return owner
  }

  ipcMain.handle('althar:page-open', (event, owner: unknown, address: unknown) => {
    from(event)
    const asked = textOf(address, LONGEST_ADDRESS)
    if (asked === null) throw new Error('That isn’t an address.')
    return pages.open(ownerIn(owner), asked)
  })
  ipcMain.handle('althar:pages-states', (event) => {
    from(event)
    return pages.states()
  })
  // Sent every frame while the person drags the workbench's edge: no answer is waited for.
  ipcMain.on('althar:page-show', (event, owner: unknown, panel: unknown, where: unknown) => {
    if (!mine(event.sender) || typeof owner !== 'string') return
    const window = BrowserWindow.fromWebContents(event.sender)
    // Where the window shows it, so an agent can say; anything else is left out.
    if (window !== null)
      pages.show(window, owner, panel === null ? null : rectOf(panel), where === 'beside' || where === 'tab' ? where : undefined)
  })
  ipcMain.handle('althar:page-move', (event, owner: unknown, move: unknown) => {
    from(event)
    if (!isPageMove(move)) throw new Error('A page can’t go there.')
    pages.move(ownerIn(owner), move)
  })
  ipcMain.handle('althar:page-viewport', (event, owner: unknown, viewport: unknown) => {
    from(event)
    if (!isViewport(viewport)) throw new Error('No viewport is named so.')
    pages.viewport(ownerIn(owner), viewport)
  })
  ipcMain.handle('althar:page-point', (event, owner: unknown) => {
    from(event)
    return pages.point(ownerIn(owner))
  })
  ipcMain.handle('althar:page-stop-pointing', (event, owner: unknown) => {
    from(event)
    pages.stopPointing(ownerIn(owner))
  })
  ipcMain.handle('althar:page-pins', (event, owner: unknown, pins: unknown) => {
    from(event)
    const list = pinsOf(pins)
    if (list === null) throw new Error('Those aren’t pins.')
    pages.pins(ownerIn(owner), list)
  })
  ipcMain.handle('althar:page-find', (event, owner: unknown, selector: unknown, address: unknown) => {
    from(event)
    const said = textOf(selector, 4_000)
    const at = textOf(address, LONGEST_ADDRESS)
    if (said === null || at === null) throw new Error('That isn’t an element on a page.')
    return pages.find(ownerIn(owner), said, at)
  })
  ipcMain.handle('althar:page-still', (event, owner: unknown) => {
    from(event)
    return pages.still(ownerIn(owner))
  })
  ipcMain.handle('althar:page-cover', (event, owner: unknown, covered: unknown) => {
    from(event)
    pages.cover(ownerIn(owner), covered === true)
  })
  ipcMain.handle('althar:page-outside', (event, owner: unknown, what: unknown) => {
    from(event)
    pages.outside(ownerIn(owner), what === 'download' ? 'download' : 'page')
  })
  ipcMain.handle('althar:page-dismiss', (event, owner: unknown) => {
    from(event)
    pages.dismiss(ownerIn(owner))
  })
  ipcMain.handle('althar:page-close', (event, owner: unknown) => {
    from(event)
    return pages.close(ownerIn(owner))
  })
  ipcMain.handle('althar:page-clear', (event, owner: unknown) => {
    from(event)
    return pages.clear(ownerIn(owner))
  })
  ipcMain.handle('althar:pages-clear', (event) => {
    from(event)
    return pages.clearAll()
  })
}
