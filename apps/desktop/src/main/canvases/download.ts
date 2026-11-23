import { setTimeout as delay } from 'node:timers/promises'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

import { app, BrowserWindow, dialog, type WebContents } from 'electron'

import { CANVAS_LIMITS, canvasAddress, type CanvasDownload, type CanvasDownloaded, type CanvasFile, canvasKindOf } from '@althar/contracts'
import { artifactPath, isDigest } from '@althar/runtime/artifacts'

import { BOARD_PRINT, boardOutputs, reserveFolder, safeName, safeStoredPath, storedBoards } from './downloadFiles'
import { fileIn, manifestAt } from './serve'
import { canvasNavigation, type Canvases } from './views'

const PAGE_WIDTH = 1440
const PAGE_HEIGHT = 900
const TALLEST = 20_000
const DRAW_TIME = 30_000
const DOWNLOAD_WORLD = 1130

class DownloadProblem extends Error {}

const cancelled = { kind: 'cancelled' } as const

const saveAs = async (
  window: BrowserWindow,
  name: string,
  extension: string,
  write: (path: string) => Promise<void>,
): Promise<CanvasDownloaded> => {
  const chosen = await dialog.showSaveDialog(window, {
    defaultPath: join(app.getPath('downloads'), `${safeName(name)}.${extension}`),
    filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }],
  })
  if (chosen.canceled || chosen.filePath === undefined) return cancelled
  // Stage on the same filesystem so a failed write cannot replace a file the person already had.
  let staged: string | undefined
  try {
    staged = await mkdtemp(join(dirname(chosen.filePath), '.althar-download-'))
    const file = join(staged, 'download')
    await write(file)
    await rename(file, chosen.filePath)
    return { kind: 'saved', path: chosen.filePath }
  } catch (error) {
    if (error instanceof DownloadProblem) throw error
    throw new DownloadProblem('Couldn’t save that file.')
  } finally {
    if (staged !== undefined) await rm(staged, { recursive: true, force: true }).catch(() => undefined)
  }
}

const saveFolder = async (window: BrowserWindow, name: string, write: (path: string) => Promise<void>): Promise<CanvasDownloaded> => {
  const chosen = await dialog.showOpenDialog(window, {
    defaultPath: app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  })
  const parent = chosen.filePaths[0]
  if (chosen.canceled || parent === undefined) return cancelled
  let folder: string | undefined
  try {
    folder = await reserveFolder(parent, name)
    await write(folder)
    return { kind: 'saved', path: folder }
  } catch (error) {
    if (folder !== undefined) await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    if (error instanceof DownloadProblem) throw error
    throw new DownloadProblem('Couldn’t write to that folder.')
  }
}

const localFile = (root: string, file: CanvasFile) => {
  if (!isDigest(file.sha256)) throw new DownloadProblem('A file from this version is missing.')
  return artifactPath(root, file.sha256)
}

const exportFiles = async (root: string, window: BrowserWindow, name: string, files: ReadonlyArray<CanvasFile>) => {
  const plan = files.map((file) => {
    if (!safeStoredPath(file.path)) throw new DownloadProblem('A file in this canvas has a name that can’t be saved safely.')
    return { source: localFile(root, file), parts: file.path.split('/') }
  })
  return saveFolder(window, name, async (folder) => {
    for (const { source, parts } of plan) {
      const target = join(folder, ...parts)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target, constants.COPYFILE_EXCL)
    }
  })
}

const evaluate = (contents: WebContents, code: string): Promise<unknown> =>
  contents.executeJavaScriptInIsolatedWorld(DOWNLOAD_WORLD, [{ code }], false)

const cdp = <T>(contents: WebContents, method: string, params: Record<string, unknown>): Promise<T> => {
  if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
  return contents.debugger.sendCommand(method, params) as Promise<T>
}

const viewport = async (contents: WebContents, width: number, height: number, scale = 1) => {
  await cdp(contents, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  await cdp(contents, 'Emulation.setScrollbarsHidden', { hidden: true })
}

const screenshot = async (contents: WebContents, width: number, height: number) => {
  const shot = await cdp<{ data: string }>(contents, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  return Buffer.from(shot.data, 'base64')
}

/** This runs in the drawing window so the main process never parses an SVG or lays one out. */
const svgInWindow = async (text: string, draw: boolean) => {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = parsed.documentElement as unknown as SVGSVGElement
  if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' || parsed.querySelector('parsererror')) return null
  if (!draw) return { width: 0, height: 0 }
  // The image decoder keeps scripts and links in the SVG inert, as in the workbench.
  const image = new Image()
  image.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  await image.decode()
  const box = svg.viewBox.baseVal
  const ratio = box.width > 0 && box.height > 0 ? box.width / box.height : 0
  const sized = (name: string) => {
    const value = svg.getAttribute(name)?.trim()
    return value !== undefined && value !== '' && !value.endsWith('%')
  }
  const width = Math.ceil(sized('width') || ratio === 0 ? image.naturalWidth : sized('height') ? image.naturalHeight * ratio : box.width)
  const height = Math.ceil(sized('height') || ratio === 0 ? image.naturalHeight : sized('width') ? image.naturalWidth / ratio : box.height)
  image.style.cssText = `display:block;width:${width}px;height:${height}px`
  document.body.style.margin = '0'
  document.body.replaceChildren(image)
  return { width, height }
}

const svgSize = async (contents: WebContents, svg: string, draw: boolean) => {
  await contents.loadURL('about:blank')
  const size = (await evaluate(contents, `(${svgInWindow.toString()})(${JSON.stringify(svg)}, ${draw})`)) as {
    width: number
    height: number
  } | null
  if (size === null) throw new DownloadProblem('This diagram isn’t an SVG drawing.')
  return size
}

const waitForPage = async (boards: number) => {
  const ready = async (doc: Document) => {
    for (const image of doc.images) image.loading = 'eager'
    await Promise.allSettled([doc.fonts.ready, ...Array.from(doc.images, (image) => image.decode())])
  }
  // loadURL waits for the frames to load. Give their fonts and images time to draw, too.
  const documents = [document]
  if (boards > 0) {
    const pieces = document.querySelectorAll('body > section > :is(iframe, img)')
    if (pieces.length !== boards) return false
    for (const piece of pieces) {
      if (piece instanceof HTMLImageElement) {
        try {
          await piece.decode()
        } catch {
          return false
        }
      } else if (piece instanceof HTMLIFrameElement) {
        const inside = piece.contentDocument
        if (inside === null || inside.URL === 'about:blank') return false
        documents.push(inside)
      }
    }
  }
  await Promise.all(documents.map(ready))
  return true
}

const loadPage = async (contents: WebContents, address: string, boards = 0) => {
  await contents.loadURL(address)
  if ((await evaluate(contents, `(${waitForPage.toString()})(${boards})`)) !== true) throw new DownloadProblem('A board couldn’t load.')
}

const draw = async <T>(
  canvases: Pick<Canvases, 'serveDownload'>,
  request: CanvasDownload,
  render: (contents: WebContents) => Promise<T>,
  transparent = false,
): Promise<T> => {
  const held = canvases.serveDownload(request)
  let drawing: BrowserWindow | undefined
  const waiting = new AbortController()
  try {
    drawing = new BrowserWindow({
      show: false,
      useContentSize: true,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      transparent,
      backgroundColor: transparent ? '#00000000' : '#ffffff',
      webPreferences: {
        session: held.session,
        offscreen: true,
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        disableDialogs: true,
        navigateOnDragDrop: false,
        spellcheck: false,
        autoplayPolicy: 'document-user-activation-required',
      },
    })
    const contents = drawing.webContents
    const steer = (event: { preventDefault(): void; readonly url: string }) => {
      if (canvasNavigation(event.url, request) !== 'go') event.preventDefault()
    }
    contents.on('will-frame-navigate', steer)
    contents.on('will-navigate', steer)
    contents.on('will-redirect', steer)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // A page first: Electron's main process crashes on a debugger command sent to a window that has loaded nothing yet. The
    // size set on it holds for the pages it loads after.
    await contents.loadURL('about:blank')
    return await Promise.race([
      render(contents),
      delay(DRAW_TIME, undefined, { signal: waiting.signal }).then(() => {
        throw new DownloadProblem('The page took too long to draw.')
      }),
    ])
  } catch (error) {
    if (error instanceof DownloadProblem) throw error
    throw new DownloadProblem('Couldn’t draw this canvas.')
  } finally {
    waiting.abort()
    try {
      if (drawing !== undefined && !drawing.isDestroyed()) drawing.destroy()
    } finally {
      held.release()
    }
  }
}

const DRAWN_PDF = { printBackground: true, preferCSSPageSize: true }

export const downloadCanvas =
  (root: string, canvases: Pick<Canvases, 'serveDownload'>) =>
  async (window: BrowserWindow, request: CanvasDownload): Promise<CanvasDownloaded> => {
    try {
      const manifest = await manifestAt(root, request.manifest)
      const entry = manifest === null ? null : fileIn(manifest, '')
      if (manifest === null || entry === null || canvasKindOf(manifest.entry) !== request.kind)
        throw new DownloadProblem('Couldn’t find this version of the canvas.')
      const { name, kind, format } = request
      const address = (path: string) => canvasAddress(request.canvasId, request.version, path)
      if (format === 'source') {
        const source = localFile(root, entry)
        return await saveAs(window, name, extname(entry.path).slice(1), (path) => copyFile(source, path))
      }
      if (format === 'files') return await exportFiles(root, window, name, manifest.files)

      if (kind === 'svg' || kind === 'mermaid') {
        return await saveAs(window, name, format, async (path) => {
          if (kind === 'svg' && entry.size > CANVAS_LIMITS.text) throw new DownloadProblem('This SVG is too large to draw.')
          const svg = kind === 'svg' ? await readFile(localFile(root, entry), 'utf8') : request.svg
          if (svg === undefined) throw new DownloadProblem('The diagram hasn’t been drawn yet.')
          if (kind === 'svg' && Buffer.byteLength(svg) > CANVAS_LIMITS.text) throw new DownloadProblem('This SVG is too large to draw.')
          const bytes = await draw(
            canvases,
            request,
            async (contents) => {
              const { width, height } = await svgSize(contents, svg, format === 'png')
              if (format === 'svg') return svg
              if (width < 1 || height < 1 || width * 2 > TALLEST || height * 2 > TALLEST || width * height > 25_000_000)
                throw new DownloadProblem('This SVG is too large to draw.')
              await viewport(contents, width, height, 2)
              return screenshot(contents, width, height)
            },
            true,
          )
          await writeFile(path, bytes)
        })
      }

      if (kind === 'html') {
        return await saveAs(window, name, format, async (path) => {
          const bytes = await draw(canvases, request, async (contents) => {
            await viewport(contents, PAGE_WIDTH, PAGE_HEIGHT)
            await access(localFile(root, entry)).catch(() => {
              throw new DownloadProblem('The page from this version is missing.')
            })
            await loadPage(contents, address(''))
            if (format === 'pdf') return contents.printToPDF(DRAWN_PDF)
            const { cssContentSize } = await cdp<{ cssContentSize: { height: number } }>(contents, 'Page.getLayoutMetrics', {})
            return screenshot(contents, PAGE_WIDTH, Math.max(1, Math.min(TALLEST, Math.ceil(cssContentSize.height))))
          })
          await writeFile(path, bytes)
        })
      }

      const boards = await storedBoards(root, manifest)
      if (boards === null) throw new DownloadProblem('Couldn’t read the boards in this canvas.')
      const print = address(BOARD_PRINT)
      const outputs = boardOutputs(boards)
      if (format === 'pdf') {
        return await saveAs(window, name, format, async (path) => {
          const bytes = await draw(canvases, request, async (contents) => {
            await loadPage(contents, print, outputs.length)
            return contents.printToPDF({ ...DRAWN_PDF, margins: { top: 0, left: 0, bottom: 0, right: 0 } })
          })
          await writeFile(path, bytes)
        })
      }

      const png = (index: number, width: number, height: number) =>
        draw(canvases, request, async (contents) => {
          await viewport(contents, width, height)
          await loadPage(contents, `${print}?board=${index}`, 1)
          return screenshot(contents, width, height)
        })
      if (outputs.length === 1) {
        const { board } = outputs[0]!
        return await saveAs(window, name, 'png', async (path) => writeFile(path, await png(0, board.width, board.height)))
      }
      return await saveFolder(window, name, async (folder) => {
        for (const [index, { page, name, board }] of outputs.entries()) {
          const directory = join(folder, page)
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, name), await png(index, board.width, board.height), { flag: 'wx' })
        }
      })
    } catch (error) {
      return { kind: 'failed', why: error instanceof DownloadProblem ? error.message : 'Couldn’t download this canvas.' }
    }
  }
