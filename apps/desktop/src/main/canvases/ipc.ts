import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron'

import { rectOf } from '../browser/ipc'
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
  const { projectId, canvasId, version, manifest } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || !ID('proj').test(projectId)) return null
  if (typeof canvasId !== 'string' || !ID('cnv').test(canvasId)) return null
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null
  if (typeof manifest !== 'string' || !/^[0-9a-f]{64}$/.test(manifest)) return null
  return { projectId, canvasId, version, manifest }
}

/** The conversation a canvas view is beside, as the window keys it: a thread's id. */
export const keyOf = (value: unknown): string | null => (typeof value === 'string' && ID('thr').test(value) ? value : null)

export const handleCanvases = (canvases: Canvases, mine: (contents: WebContents) => boolean) => {
  const from = (event: IpcMainEvent) => {
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
  ipcMain.on('althar:canvas-reload', (event, key: unknown) => {
    from(event)
    const conversation = keyOf(key)
    if (conversation !== null) canvases.reload(conversation)
  })
}
