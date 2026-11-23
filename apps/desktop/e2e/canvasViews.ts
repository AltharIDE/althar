import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test'

import { still } from './support'

/*
 * A canvas's view in the built app, for the specs that draw canvases
 * (ADR-104): its place and address, a script run in its page, and a picture
 * of the window with the view laid where it shows, which the window's own
 * screenshot leaves out.
 */

/** The canvas view's metadata; only a screenshot needs its composited picture, at 1×. */
export const canvasView = (electronApp: ElectronApplication, capture = false) =>
  electronApp.evaluate(async ({ BrowserWindow }, capture) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
    const view = window?.contentView.children.find(
      (child): child is Electron.WebContentsView =>
        'webContents' in child &&
        (child as Electron.WebContentsView).webContents.getURL().startsWith('althar-canvas://') &&
        child.getVisible(),
    )
    if (view === undefined) return null
    const bounds = view.getBounds()
    // A view can have its address before its compositor has a frame. Metadata polling must not request a screenshot.
    const picture = capture ? await view.webContents.capturePage() : null
    const sized = picture !== null && picture.getSize().width > bounds.width ? picture.resize({ width: bounds.width }) : picture
    return {
      bounds,
      address: view.webContents.getURL(),
      png: sized?.toPNG().toString('base64') ?? null,
      partition: view.webContents.session.storagePath ?? '',
    }
  }, capture)

/** Runs a script in the canvas's own page, as its scripts run. */
export const inCanvas = <T>(electronApp: ElectronApplication, code: string) =>
  electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find((one) => one.getURL().startsWith('althar-canvas://'))
    if (contents === undefined) throw new Error('No canvas view.')
    return (await contents.executeJavaScript(script, true)) as unknown
  }, code) as Promise<T>

/**
 * Waits until the canvas's page and each board in it have loaded, with their pictures and fonts, nothing in them is
 * moving but what never ends, and a frame has been drawn since. A frame not yet given its own page still holds the
 * blank one it starts with, already complete; one from another origin can't be seen into, and isn't waited for.
 */
const canvasStill = (electronApp: ElectronApplication) =>
  expect
    .poll(() =>
      inCanvas<boolean>(
        electronApp,
        `(async () => {
          const docs = [document]
          for (const frame of document.querySelectorAll('iframe')) {
            const doc = frame.contentDocument
            if (doc === null) continue
            if (doc.URL === 'about:blank' || doc.readyState !== 'complete') return false
            docs.push(doc)
          }
          for (const doc of docs) {
            if (doc.fonts.status !== 'loaded' || [...doc.images].some((one) => !one.complete)) return false
            const moving = doc.getAnimations().some((one) => one.playState === 'running' && one.effect?.getComputedTiming().endTime !== Infinity)
            if (moving) return false
          }
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
          return true
        })()`,
      ),
    )
    .toBe(true)

/**
 * A picture of a part of the window as the person sees it: the canvas is a view of its own over the window, which the
 * window's own screenshot leaves out, so its picture is laid where it is first, once it is still.
 */
export const shoot = async (page: Page, electronApp: ElectronApplication, of: Locator | Page, path: string) => {
  if ((await canvasView(electronApp)) !== null) await canvasStill(electronApp)
  const view = await canvasView(electronApp, true)
  if (view !== null)
    await page.evaluate((drawn) => {
      const picture = document.createElement('img')
      picture.src = `data:image/png;base64,${drawn.png}`
      picture.dataset.drawn = ''
      Object.assign(picture.style, {
        position: 'fixed',
        left: `${drawn.bounds.x}px`,
        top: `${drawn.bounds.y}px`,
        width: `${drawn.bounds.width}px`,
        height: `${drawn.bounds.height}px`,
        pointerEvents: 'none',
        zIndex: '2147483647',
      })
      document.getElementById('root')?.append(picture)
    }, view)
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[data-drawn]')].every((one) => one.complete))
  await still(page)
  await of.screenshot({ path, animations: 'disabled', scale: 'css' })
  await page.evaluate(() => {
    for (const one of document.querySelectorAll('img[data-drawn]')) one.remove()
  })
}

/** A press in the canvas's view, as the person's mouse makes one. */
export const pressIn = (electronApp: ElectronApplication, at: { readonly x: number; readonly y: number }) =>
  electronApp.evaluate(({ webContents }, point) => {
    const contents = webContents.getAllWebContents().find((one) => one.getURL().startsWith('althar-canvas://'))
    if (contents === undefined) throw new Error('No canvas view.')
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }, at)
