import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'

import {
  CANVAS_DOWNLOADS,
  CanvasDownloadFormat,
  CanvasKind,
  isCanvasName,
  type CanvasDownload,
  type CanvasDownloaded,
} from '@althar/contracts'

import { rectOf } from '../browser/ipc'
import { groundChangeOf, groundPartOf, groundPinsOf } from './boards'
import type { CanvasTarget, Canvases } from './views'

/*
 * How Althar's own windows show the canvases beside their conversations
 * (ADR-104): every call checked to come from one of Althar's windows, never a
 * canvas or a page, and every argument checked for what it should be. A
 * canvas view has no preload, so it can send nothing here at all.
 */

const ID = (prefix: string) => new RegExp(`^${prefix}_[0-9a-f]{32}$`)

/** A version the window asks to show, each part what it should be; null for anything else. */
export const targetOf = (value: unknown): CanvasTarget | null => {
  if (typeof value !== 'object' || value === null) return null
  const { projectId, canvasId, version, manifest, boards } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || !ID('proj').test(projectId)) return null
  if (typeof canvasId !== 'string' || !ID('cnv').test(canvasId)) return null
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 999_999_999) return null
  if (typeof manifest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest)) return null
  if (boards !== undefined && typeof boards !== 'boolean') return null
  return { projectId, canvasId, version, manifest, ...(boards === true ? { boards } : {}) }
}

const MAX_SVG = 4 * 1024 * 1024

export const downloadOf = (value: unknown): CanvasDownload | null => {
  const target = targetOf(value)
  if (target === null) return null
  const { name, kind, format, svg } = value as Record<string, unknown>
  if (typeof name !== 'string' || !isCanvasName(name)) return null
  if (!CanvasKind.literals.includes(kind as CanvasKind) || !CanvasDownloadFormat.literals.includes(format as CanvasDownloadFormat))
    return null
  if (!CANVAS_DOWNLOADS[kind as CanvasKind].includes(format as CanvasDownloadFormat)) return null
  if (svg !== undefined && (typeof svg !== 'string' || svg.length > MAX_SVG || Buffer.byteLength(svg) > MAX_SVG)) return null
  if (kind === 'mermaid' && format !== 'source' && !svg) return null
  return { ...target, name, kind: kind as CanvasKind, format: format as CanvasDownloadFormat, ...(svg === undefined ? {} : { svg }) }
}

/** The conversation a canvas view is beside, as the window keys it: a thread's id. */
export const keyOf = (value: unknown): string | null => (typeof value === 'string' && ID('thr').test(value) ? value : null)

export const handleCanvases = (
  canvases: Pick<Canvases, 'show' | 'close' | 'still' | 'cover' | 'reload' | 'change' | 'chip' | 'pins' | 'find' | 'clear' | 'picture'>,
  mine: (contents: WebContents) => boolean,
  download: (window: BrowserWindow, request: CanvasDownload) => Promise<CanvasDownloaded>,
) => {
  const from = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (!mine(event.sender)) throw new Error('Only Althar’s own windows show its canvases.')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) throw new Error('No window asked.')
    return window
  }
  ipcMain.on('althar:canvas-show', (event, key: unknown, target: unknown, panel: unknown) => {
    const window = from(event)
    const conversation = keyOf(key)
    const shown = targetOf(target)
    if (conversation === null || shown === null) return
    canvases.show(window, conversation, shown, panel === null ? null : rectOf(panel))
  })
  ipcMain.on('althar:canvas-close', (event, key: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation !== null) canvases.close(conversation)
  })
  ipcMain.handle('althar:canvas-still', (event, key: unknown) => {
    from(event)
    const conversation = keyOf(key)
    return conversation === null ? null : canvases.still(conversation)
  })
  ipcMain.handle('althar:canvas-cover', (event, key: unknown, covered: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation !== null) canvases.cover(conversation, covered === true)
  })
  ipcMain.on('althar:canvas-reload', (event, key: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation !== null) canvases.reload(conversation)
  })
  // A canvas of boards: how it shows, the comments' pins on it, a part found again, and the outline of one taken.
  ipcMain.on('althar:canvas-ground', (event, key: unknown, change: unknown) => {
    from(event)
    const conversation = keyOf(key)
    const asked = groundChangeOf(change)
    if (conversation !== null && asked !== null) canvases.change(conversation, asked)
  })
  ipcMain.on('althar:canvas-chip', (event, key: unknown, title: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation === null || (title !== null && typeof title !== 'string')) return
    canvases.chip(conversation, title === null ? null : title.slice(0, 200))
  })
  ipcMain.handle('althar:canvas-pins', (event, key: unknown, pins: unknown) => {
    from(event)
    const conversation = keyOf(key)
    const asked = groundPinsOf(pins)
    return conversation === null || asked === null ? null : canvases.pins(conversation, asked)
  })
  ipcMain.handle('althar:canvas-find', (event, key: unknown, part: unknown) => {
    from(event)
    const conversation = keyOf(key)
    const asked = groundPartOf(part)
    return conversation === null || asked === null ? null : canvases.find(conversation, asked)
  })
  // The picture kept of a version as drawn, for its card in the project's Artifacts view.
  ipcMain.handle('althar:canvas-picture', (event, manifest: unknown) => {
    from(event)
    return typeof manifest === 'string' && /^[0-9a-f]{64}$/.test(manifest) ? canvases.picture(manifest) : null
  })
  ipcMain.on('althar:canvas-clear', (event, key: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation !== null) canvases.clear(conversation)
  })
  ipcMain.handle('althar:canvas-download', async (event, value: unknown): Promise<CanvasDownloaded> => {
    try {
      const window = from(event)
      const request = downloadOf(value)
      if (request === null) return { kind: 'failed', why: 'This canvas can’t be downloaded in that format.' }
      return await download(window, request)
    } catch {
      return { kind: 'failed', why: 'Couldn’t download this canvas.' }
    }
  })
}
