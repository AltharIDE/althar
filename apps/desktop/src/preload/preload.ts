import { contextBridge, ipcRenderer, webUtils } from 'electron'

/*
 * The window's bridge to the main process, and nothing more: the port to the
 * runtime, handed on to the page, folders the person chose, by the picker or
 * a drop or among the repositories main found, each as a grant, the thread a notification they clicked opens,
 * the icon they gave the app, the app's own preferences, and where Althar
 * shows at the edge of the screen. The edge's own pages say through it where they draw, and what to
 * open in the window, and hear whether the pointer is on the island. And
 * dictation: where the speech model and the microphone stand, the model's
 * download, and what was said, sent to be written down. Reporting a problem, and the
 * page's own errors, for the log. The page never sees or sends a
 * path. It gets no Node, no file system, no shell.
 */

ipcRenderer.on('althar:port', (event) => {
  window.postMessage('althar:port', '*', event.ports)
})

/* Whether the pointer is on the island, as the main process watches it. */
const pointing = new Set<(on: boolean) => void>()
ipcRenderer.on('althar:edge-pointed', (_event, on: unknown) => {
  if (typeof on === 'boolean') for (const listener of pointing) listener(on)
})

/* Report a problem, asked from the page or from Help in the app's menu: the page opens the dialog, with what it is about. */
const reporting = new Set<(about: unknown) => void>()
const reportAsked = (about: unknown) => {
  for (const listener of reporting) listener(about)
}
ipcRenderer.on('althar:report', () => reportAsked({ kind: 'asked', from: 'menu' }))

/* A thread a notification the person clicked opens: held until the page listens, as a window that just opened doesn't yet. */
let pending: string | undefined
const opening = new Set<(threadId: string) => void>()
ipcRenderer.on('althar:open', (_event, threadId: unknown) => {
  if (typeof threadId !== 'string') return
  if (opening.size === 0) pending = threadId
  for (const listener of opening) listener(threadId)
})

/* Where dictation's speech engine (sherpa-onnx) has a binary; elsewhere the page gets no dictation, and shows no microphone. */
const SPEECH = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-ia32'])

/* How the speech model's download goes, as the main process says. */
const dictating = new Set<(event: unknown) => void>()
ipcRenderer.on('althar:dictation', (_event, message: unknown) => {
  for (const listener of dictating) listener(message)
})

contextBridge.exposeInMainWorld('althar', {
  // Which system it is, for the words the window uses: this Mac, this PC, this computer.
  platform: process.platform,
  pickFolder: (purpose: 'project' | 'account' = 'project'): Promise<string | null> => ipcRenderer.invoke('althar:pick-folder', purpose),
  // Only a file the person dropped has a path; one the page made has none.
  grantDropped: (file: File): Promise<string | null> => {
    const path = webUtils.getPathForFile(file)
    return path === '' ? Promise.resolve(null) : ipcRenderer.invoke('althar:grant-dropped', path)
  },
  appIcon: (): Promise<string | null> => ipcRenderer.invoke('althar:app-icon'),
  setAppIcon: (icon: string): Promise<void> => ipcRenderer.invoke('althar:set-app-icon', icon),
  preferences: (): Promise<unknown> => ipcRenderer.invoke('althar:preferences'),
  setPreference: (key: string, value: unknown): Promise<unknown> => ipcRenderer.invoke('althar:set-preference', key, value),
  sounds: (): Promise<ReadonlyArray<string>> => ipcRenderer.invoke('althar:sounds'),
  editorPicture: (id: string): Promise<string | null> => ipcRenderer.invoke('althar:editor-picture', id),
  findRepositories: (): Promise<unknown> => ipcRenderer.invoke('althar:find-repositories'),
  grantFound: (id: string): Promise<string | null> => ipcRenderer.invoke('althar:grant-found', id),
  playSound: (name: string): Promise<void> => ipcRenderer.invoke('althar:play-sound', name),
  edge: (): Promise<{ place: string; notch: boolean } | null> => ipcRenderer.invoke('althar:edge'),
  setEdge: (place: string): Promise<void> => ipcRenderer.invoke('althar:set-edge', place),
  edgeDrawn: (rect: { x: number; y: number; width: number; height: number }): void => ipcRenderer.send('althar:edge-drawn', rect),
  onEdgePointed: (listener: (on: boolean) => void): (() => void) => {
    pointing.add(listener)
    return () => void pointing.delete(listener)
  },
  edgeSize: (height: number): void => ipcRenderer.send('althar:edge-size', height),
  openInWindow: (threadId?: string): void => ipcRenderer.send('althar:edge-open', threadId ?? null),
  ...(SPEECH.has(`${process.platform}-${process.arch}`)
    ? {
        dictation: {
          state: (): Promise<unknown> => ipcRenderer.invoke('althar:dictation-state'),
          allow: (): Promise<boolean> => ipcRenderer.invoke('althar:dictation-allow'),
          download: (): Promise<void> => ipcRenderer.invoke('althar:dictation-download'),
          cancel: (): Promise<void> => ipcRenderer.invoke('althar:dictation-cancel'),
          prepare: (): Promise<void> => ipcRenderer.invoke('althar:dictation-prepare'),
          transcribe: (samples: Float32Array, sampleRate: number): Promise<string> =>
            ipcRenderer.invoke('althar:dictation-transcribe', samples, sampleRate),
          openSettings: (pane: 'privacy' | 'sound'): Promise<boolean> => ipcRenderer.invoke('althar:dictation-settings', pane),
          onEvent: (listener: (event: unknown) => void): (() => void) => {
            dictating.add(listener)
            return () => void dictating.delete(listener)
          },
        },
      }
    : {}),
  // Report a problem (DEV-61): the page's dialog opens, about what it was asked from; main takes the screenshot as it opens, gathers the rest, and sends or saves it.
  reportProblem: (about: unknown): void => reportAsked(about),
  report: {
    open: (context: unknown): Promise<unknown> => ipcRenderer.invoke('althar:report-open', context),
    preview: (reportId: string): Promise<unknown> => ipcRenderer.invoke('althar:report-preview', reportId),
    send: (reportId: string, choices: unknown): Promise<unknown> => ipcRenderer.invoke('althar:report-send', reportId, choices),
    close: (reportId: string): void => ipcRenderer.send('althar:report-close', reportId),
    onAsked: (listener: (about: unknown) => void): (() => void) => {
      reporting.add(listener)
      return () => void reporting.delete(listener)
    },
  },
  // What the page couldn't handle, for main's log: its message and stack, nothing else.
  logError: (error: { kind: 'error' | 'rejection'; message: string; stack: string; source?: string }): void =>
    ipcRenderer.send('althar:window-error', error),
  onOpen: (listener: (threadId: string) => void): (() => void) => {
    opening.add(listener)
    if (pending !== undefined) {
      listener(pending)
      pending = undefined
    }
    return () => void opening.delete(listener)
  },
})
