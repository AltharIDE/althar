import { isStartupStage, type StartupStage } from '../startup'
import {
  isHomeSetup,
  isHomesOverview,
  NO_SETUP_ARG,
  isHomeState,
  type HomeProject,
  type HomeSetup,
  type HomesOverview,
  type HomeState,
  type SetupAction,
} from '../homes'
import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type { CanvasDownload, CanvasDownloaded } from '@althar/contracts'

import { doNotTrack } from '../main/appPreferences'
import { chromeFromArgs, type DesktopChrome, isDesktopChrome } from '../main/desktop'
import type { WindowAction } from '../renderer/data/services'
import type { PageKey, PageState } from '../main/browser/page'
import type { CanvasGroundNews, CanvasPointed } from '../main/canvases/boards'
import type { GroundChange, GroundPin } from '../overlay/ground'

/*
 * The window's bridge to the main process, and nothing more: the port to the
 * runtime, handed on to the page, folders the person chose, by the picker or
 * a drop or among the repositories main found, each as a grant, and files and folders added to a message, each
 * as a grant with its name and size, the thread a notification they clicked opens,
 * the icon they gave the app, the app's own preferences, where Althar
 * shows at the edge of the screen, which platform the window runs on, and the window's own buttons
 * (close, minimize, maximize), with the desktop they're drawn for. The edge's own pages say through it where they draw, and what to
 * open in the window, and hear whether the pointer is on the island. And
 * dictation: where the speech model and the microphone stand, the model's
 * download, and what was said, sent to be written down. A token on the
 * clipboard, while connecting a service asks for one. An update ready to
 * install, and restarting into it. An update that couldn't move the
 * store, with where its copy is as the person knows the place, which main
 * shows in the file manager when asked. Quit with work under way, asking what to do. Whether DO_NOT_TRACK is set, which
 * keeps usage data off. And reporting a problem, and the page's own errors
 * and slow frames, for the log. And the pages beside the conversations (ADR-100): opening,
 * placing and pointing at one, as main holds it, and how each stands. The page never sees or sends a path. It gets no Node, no
 * file system, no shell.
 */

ipcRenderer.on('althar:port', (event) => {
  window.postMessage('althar:port', '*', event.ports)
})

let startupStage: StartupStage = 'data'
const startupStages = new Set<(stage: StartupStage) => void>()
ipcRenderer.on('althar:startup-stage', (_event, stage: unknown) => {
  if (!isStartupStage(stage)) return
  startupStage = stage
  for (const listener of startupStages) listener(stage)
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
/* Whether the window is maximized, on the window's own buttons' account. */
const maximized = new Set<(maximized: boolean) => void>()
ipcRenderer.on('althar:maximized', (_event, on: unknown) => {
  if (typeof on === 'boolean') for (const listener of maximized) listener(on)
})

/* The desktop the window sits on and what it says of the window's own buttons and accent: as main handed it, then as it changes. */
let chrome = chromeFromArgs(process.argv)
const chromes = new Set<(chrome: DesktopChrome) => void>()
ipcRenderer.on('althar:chrome', (_event, next: unknown) => {
  if (!isDesktopChrome(next)) return
  chrome = next
  for (const listener of chromes) listener(next)
})

/* A thread a notification the person clicked opens: held until the page listens, as a window that just opened doesn't yet. */
let pending: string | undefined
const opening = new Set<(threadId: string) => void>()
ipcRenderer.on('althar:open', (_event, threadId: unknown) => {
  if (typeof threadId !== 'string') return
  if (opening.size === 0) pending = threadId
  for (const listener of opening) listener(threadId)
})

/* A store the runtime can't serve (an update that couldn't move it, a profile in use), as the main process says: held for a page that listens later. */
let storeFailure: unknown
const storeFailed = new Set<(failure: unknown) => void>()
ipcRenderer.on('althar:store-failed', (_event, failure: unknown) => {
  storeFailure = failure
  for (const listener of storeFailed) listener(failure)
})

/* Where dictation's speech engine (sherpa-onnx) has a binary; elsewhere the page gets no dictation, and shows no microphone. */
const SPEECH = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-ia32'])

/* How the speech model's download goes, as the main process says. */
const dictating = new Set<(event: unknown) => void>()
ipcRenderer.on('althar:dictation', (_event, message: unknown) => {
  for (const listener of dictating) listener(message)
})

/* An update ready to install, as the main process says it changes. */
const updating = new Set<(glance: unknown) => void>()
ipcRenderer.on('althar:update', (_event, glance: unknown) => {
  for (const listener of updating) listener(glance)
})

/* Quit with work under way asks the person what to do (DEV-118): held for a page that listens later, and cleared when main says it is answered. */
let quitQuestion: unknown = null
const quitAsked = new Set<(question: unknown) => void>()
ipcRenderer.on('althar:quit-ask', (_event, question: unknown) => {
  quitQuestion = question
  for (const listener of quitAsked) listener(question)
})

/* How each page beside a conversation stands, and what the person pressed in one that the window acts on, as main says. */
const paging = new Set<(state: PageState) => void>()
ipcRenderer.on('althar:page', (_event, state: PageState) => {
  for (const listener of paging) listener(state)
})
const pageKeys = new Set<(owner: string, key: PageKey) => void>()
ipcRenderer.on('althar:page-key', (_event, owner: string, key: PageKey) => {
  for (const listener of pageKeys) listener(owner, key)
})
const pagesClosed = new Set<(owner: string) => void>()
ipcRenderer.on('althar:page-closed', (_event, owner: string) => {
  for (const listener of pagesClosed) listener(owner)
})
/* What a canvas of boards' ground said: how it stands, a part pointed at, a pin or a key pressed (ADR-104). */
const canvasGround = new Set<(threadId: string, news: CanvasGroundNews) => void>()
ipcRenderer.on('althar:canvas-ground', (_event, threadId: string, news: CanvasGroundNews) => {
  for (const listener of canvasGround) listener(threadId, news)
})
/* A page a lead opened (or woke) that no window shows yet: the window places it beside the conversation. */
const pagesOpened = new Set<(owner: string) => void>()
ipcRenderer.on('althar:page-opened', (_event, owner: string) => {
  for (const listener of pagesOpened) listener(owner)
})

const homeStates = new Set<(state: HomeState) => void>()
const homeDialogs = new Set<() => void>()
ipcRenderer.on('althar:home-state', (_event, value: unknown) => {
  if (isHomeState(value)) for (const listener of homeStates) listener(value)
})
ipcRenderer.on('althar:homes-open', () => {
  for (const listener of homeDialogs) listener()
})
/* A home being set up over SSH, as it goes: for Connect a home and the chip. */
const setups = new Set<(setup: HomeSetup | null) => void>()
ipcRenderer.on('althar:home-setup', (_event, value: unknown) => {
  if (isHomeSetup(value)) for (const listener of setups) listener(value)
})
/* What main knows of every home, as it changes: for the chip's menu and Manage homes. */
const overviews = new Set<(overview: HomesOverview) => void>()
ipcRenderer.on('althar:homes-overview', (_event, value: unknown) => {
  if (isHomesOverview(value)) for (const listener of overviews) listener(value)
})
/* A project to show, from another window's Manage homes: held until the page listens, as a window that just opened doesn't yet. */
let pendingProject: string | undefined
const projectShown = new Set<(projectId: string) => void>()
ipcRenderer.on('althar:homes-project', (_event, projectId: unknown) => {
  if (typeof projectId !== 'string') return
  if (projectShown.size === 0) pendingProject = projectId
  for (const listener of projectShown) listener(projectId)
})

contextBridge.exposeInMainWorld('althar', {
  homes: {
    state: () => ipcRenderer.invoke('althar:homes-state'),
    list: () => ipcRenderer.invoke('althar:homes-list'),
    pairingInfo: (code: string) => ipcRenderer.invoke('althar:homes-pairing-info', code),
    pair: (code: string, name: string) => ipcRenderer.invoke('althar:homes-pair', code, name),
    answerPermission: (answer: unknown) => ipcRenderer.invoke('althar:homes-answer-permission', answer),
    enrollApprovalKey: () => ipcRenderer.invoke('althar:homes-enroll-approval-key'),
    overview: () => ipcRenderer.invoke('althar:homes-overview'),
    inspect: (target: unknown) => ipcRenderer.invoke('althar:homes-inspect', target),
    connect: (checkId: string, name: string) => ipcRenderer.invoke('althar:homes-connect', checkId, name),
    save: (checkId: string, name: string) => ipcRenderer.invoke('althar:homes-save', checkId, name),
    open: (id: string, projectId?: string) => ipcRenderer.invoke('althar:homes-open', id, projectId),
    rename: (id: string, name: string) => ipcRenderer.invoke('althar:homes-rename', id, name),
    change: (id: string, checkId: string) => ipcRenderer.invoke('althar:homes-change', id, checkId),
    forget: (id: string) => ipcRenderer.invoke('althar:homes-forget', id),
    restore: (id: string) => ipcRenderer.invoke('althar:homes-restore', id),
    report: (projects: ReadonlyArray<HomeProject>): void => ipcRenderer.send('althar:homes-report', projects),
    cancelCheck: () => ipcRenderer.invoke('althar:homes-cancel'),
    setup: () => ipcRenderer.invoke('althar:homes-setup'),
    // Not where this build can't set a home up (the Flatpak): the dialog offers setting it up by hand instead.
    ...(process.argv.includes(NO_SETUP_ARG) ? {} : { setUp: (target: unknown) => ipcRenderer.invoke('althar:homes-set-up', target) }),
    setupAct: (action: SetupAction) => ipcRenderer.invoke('althar:homes-setup-act', action),
    onSetup: (listener: (setup: HomeSetup | null) => void) => {
      setups.add(listener)
      return () => {
        setups.delete(listener)
      }
    },
    reconnect: () => ipcRenderer.invoke('althar:homes-reconnect'),
    onState: (listener: (state: HomeState) => void) => {
      homeStates.add(listener)
      return () => {
        homeStates.delete(listener)
      }
    },
    onOpen: (listener: () => void) => {
      homeDialogs.add(listener)
      return () => {
        homeDialogs.delete(listener)
      }
    },
    onOverview: (listener: (overview: HomesOverview) => void) => {
      overviews.add(listener)
      return () => {
        overviews.delete(listener)
      }
    },
    onProject: (listener: (projectId: string) => void) => {
      projectShown.add(listener)
      if (pendingProject !== undefined) {
        listener(pendingProject)
        pendingProject = undefined
      }
      return () => {
        projectShown.delete(listener)
      }
    },
  },
  // Which system it is, for the words the window uses (this Mac, this PC, this computer) and for its own chrome: on macOS the system draws the lights.
  platform: process.platform,
  startup: (stage: string, duration?: number): void => ipcRenderer.send('althar:startup', stage, duration),
  onStartupStage: (listener: (stage: StartupStage) => void): (() => void) => {
    startupStages.add(listener)
    listener(startupStage)
    return () => void startupStages.delete(listener)
  },
  // Usage data stays off while it is set, whatever its switch says; the switch shows so.
  doNotTrack: doNotTrack(process.env),
  window: (action: WindowAction): void => ipcRenderer.send('althar:window', action),
  // Which desktop, and where its window buttons go, in its own manner (ADR-098); absent on an edge page, which draws none.
  chrome: (): DesktopChrome | undefined => chrome,
  onChrome: (listener: (chrome: DesktopChrome) => void): (() => void) => {
    chromes.add(listener)
    return () => void chromes.delete(listener)
  },
  maximized: (): Promise<boolean> => ipcRenderer.invoke('althar:maximized'),
  onMaximized: (listener: (maximized: boolean) => void): (() => void) => {
    maximized.add(listener)
    return () => void maximized.delete(listener)
  },
  pickFolder: (purpose: 'project' | 'account' = 'project'): Promise<string | null> => ipcRenderer.invoke('althar:pick-folder', purpose),
  pickFolders: (): Promise<ReadonlyArray<string>> => ipcRenderer.invoke('althar:pick-folders'),
  pickPlace: (name: string): Promise<string | null> => ipcRenderer.invoke('althar:pick-place', name),
  // Only a file the person dropped has a path; one the page made has none.
  grantDropped: (file: File): Promise<string | null> => {
    const path = webUtils.getPathForFile(file)
    return path === '' ? Promise.resolve(null) : ipcRenderer.invoke('althar:grant-dropped', path)
  },
  // A file or folder added to a message: measured and granted by main; one the page made, as a pasted picture, has no path, and gets null.
  attach: (file: File): Promise<unknown> => {
    const path = webUtils.getPathForFile(file)
    return path === '' ? Promise.resolve(null) : ipcRenderer.invoke('althar:attach', path)
  },
  // A dropped file's path on disk, which a terminal types; one the page made has none, and gets ''.
  pathOfFile: (file: File): string => webUtils.getPathForFile(file),
  // Pastes the clipboard where the window's focus is, as the Edit menu does: a terminal's own paste key. The page never reads the clipboard.
  paste: (): void => ipcRenderer.send('althar:paste'),
  // The files copied in the file manager, pasted into a message: as main reads them off the clipboard.
  attachPasted: (): Promise<unknown> => ipcRenderer.invoke('althar:attach-pasted'),
  appIcon: (): Promise<string | null> => ipcRenderer.invoke('althar:app-icon'),
  setAppIcon: (icon: string): Promise<void> => ipcRenderer.invoke('althar:set-app-icon', icon),
  preferences: (): Promise<unknown> => ipcRenderer.invoke('althar:preferences'),
  setPreference: (key: string, value: unknown): Promise<unknown> => ipcRenderer.invoke('althar:set-preference', key, value),
  sounds: (): Promise<ReadonlyArray<string>> => ipcRenderer.invoke('althar:sounds'),
  saveWorkerSnapshot: (request: { readonly projectId: string; readonly taskId: string }): Promise<void> =>
    ipcRenderer.invoke('althar:save-worker-snapshot', request),
  editorPicture: (id: string): Promise<string | null> => ipcRenderer.invoke('althar:editor-picture', id),
  findRepositories: (): Promise<unknown> => ipcRenderer.invoke('althar:find-repositories'),
  clonePlace: (): Promise<unknown> => ipcRenderer.invoke('althar:clone-place'),
  openFolderAccess: (): Promise<boolean> => ipcRenderer.invoke('althar:open-folder-access'),
  pickClonePlace: (): Promise<unknown> => ipcRenderer.invoke('althar:pick-clone-place'),
  grantFound: (id: string): Promise<string | null> => ipcRenderer.invoke('althar:grant-found', id),
  playSound: (name: string): Promise<void> => ipcRenderer.invoke('althar:play-sound', name),
  edge: (): Promise<{ place: string; notch: boolean; platform: string; tray: boolean } | null> => ipcRenderer.invoke('althar:edge'),
  setEdge: (place: string): Promise<void> => ipcRenderer.invoke('althar:set-edge', place),
  edgeDrawn: (rect: { x: number; y: number; width: number; height: number }): void => ipcRenderer.send('althar:edge-drawn', rect),
  onEdgePointed: (listener: (on: boolean) => void): (() => void) => {
    pointing.add(listener)
    return () => void pointing.delete(listener)
  },
  edgeSize: (height: number): void => ipcRenderer.send('althar:edge-size', height),
  openInWindow: (threadId?: string): void => ipcRenderer.send('althar:edge-open', threadId ?? null),
  // Only text that looks like a token; anything else the person copied never reaches the page.
  clipboardToken: (): Promise<string | null> => ipcRenderer.invoke('althar:clipboard-token'),
  update: {
    glance: (): Promise<unknown> => ipcRenderer.invoke('althar:update'),
    restart: (): Promise<boolean> => ipcRenderer.invoke('althar:update-restart'),
    check: (): Promise<void> => ipcRenderer.invoke('althar:update-check'),
    onChange: (listener: (glance: unknown) => void): (() => void) => {
      updating.add(listener)
      return () => void updating.delete(listener)
    },
  },
  ...(SPEECH.has(`${process.platform}-${process.arch}`)
    ? {
        dictation: {
          state: (): Promise<unknown> => ipcRenderer.invoke('althar:dictation-state'),
          allow: (): Promise<boolean> => ipcRenderer.invoke('althar:dictation-allow'),
          download: (): Promise<void> => ipcRenderer.invoke('althar:dictation-download'),
          cancel: (): Promise<void> => ipcRenderer.invoke('althar:dictation-cancel'),
          remove: (): Promise<void> => ipcRenderer.invoke('althar:dictation-remove'),
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
  onStoreFailed: (listener: (failure: unknown) => void): (() => void) => {
    storeFailed.add(listener)
    if (storeFailure !== undefined) listener(storeFailure)
    return () => void storeFailed.delete(listener)
  },
  showBackup: (): Promise<void> => ipcRenderer.invoke('althar:show-backup'),
  storage: {
    places: (): Promise<Record<string, string>> => ipcRenderer.invoke('althar:storage-places'),
    show: (place: string): Promise<void> => ipcRenderer.invoke('althar:storage-show', place),
  },
  tryAgain: (): Promise<void> => ipcRenderer.invoke('althar:try-again'),
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
  // Quit with work under way: what it would stop, as main asks; the answer is quit, background or cancel.
  quit: {
    onAsk: (listener: (question: unknown) => void): (() => void) => {
      quitAsked.add(listener)
      if (quitQuestion !== null) listener(quitQuestion)
      return () => void quitAsked.delete(listener)
    },
    answer: (answer: string): void => ipcRenderer.send('althar:quit-answer', answer),
  },
  // The pages beside the conversations: each by its owner, a task's id or a project's (ADR-100).
  pages: {
    open: (owner: string, address: string): Promise<unknown> => ipcRenderer.invoke('althar:page-open', owner, address),
    states: (): Promise<unknown> => ipcRenderer.invoke('althar:pages-states'),
    show: (owner: string, panel: { x: number; y: number; width: number; height: number } | null, where?: 'beside' | 'tab'): void =>
      ipcRenderer.send('althar:page-show', owner, panel, where),
    move: (owner: string, move: string): Promise<void> => ipcRenderer.invoke('althar:page-move', owner, move),
    viewport: (owner: string, viewport: string): Promise<void> => ipcRenderer.invoke('althar:page-viewport', owner, viewport),
    point: (owner: string): Promise<unknown> => ipcRenderer.invoke('althar:page-point', owner),
    stopPointing: (owner: string): Promise<void> => ipcRenderer.invoke('althar:page-stop-pointing', owner),
    pins: (owner: string, pins: unknown): Promise<{ address: string; found: ReadonlyArray<number> } | null> =>
      ipcRenderer.invoke('althar:page-pins', owner, pins),
    find: (owner: string, selector: string, address: string): Promise<unknown> =>
      ipcRenderer.invoke('althar:page-find', owner, selector, address),
    still: (owner: string): Promise<string | null> => ipcRenderer.invoke('althar:page-still', owner),
    cover: (owner: string, covered: boolean): Promise<void> => ipcRenderer.invoke('althar:page-cover', owner, covered),
    outside: (owner: string, what: 'page' | 'download'): Promise<void> => ipcRenderer.invoke('althar:page-outside', owner, what),
    dismiss: (owner: string): Promise<void> => ipcRenderer.invoke('althar:page-dismiss', owner),
    close: (owner: string): Promise<void> => ipcRenderer.invoke('althar:page-close', owner),
    clear: (owner: string): Promise<void> => ipcRenderer.invoke('althar:page-clear', owner),
    clearAll: (): Promise<void> => ipcRenderer.invoke('althar:pages-clear'),
    onState: (listener: (state: PageState) => void): (() => void) => {
      paging.add(listener)
      return () => void paging.delete(listener)
    },
    onKey: (listener: (owner: string, key: PageKey) => void): (() => void) => {
      pageKeys.add(listener)
      return () => void pageKeys.delete(listener)
    },
    onClosed: (listener: (owner: string) => void): (() => void) => {
      pagesClosed.add(listener)
      return () => void pagesClosed.delete(listener)
    },
    onOpened: (listener: (owner: string) => void): (() => void) => {
      pagesOpened.add(listener)
      return () => void pagesOpened.delete(listener)
    },
  },
  // The HTML canvases beside the conversations: each by the thread it is beside, at a version's address (ADR-104).
  canvases: {
    show: (
      threadId: string,
      target: { projectId: string; canvasId: string; version: number; manifest: string; boards?: boolean },
      panel: { x: number; y: number; width: number; height: number } | null,
    ): void => ipcRenderer.send('althar:canvas-show', threadId, target, panel),
    close: (threadId: string): void => ipcRenderer.send('althar:canvas-close', threadId),
    reload: (threadId: string): void => ipcRenderer.send('althar:canvas-reload', threadId),
    still: (threadId: string): Promise<string | null> => ipcRenderer.invoke('althar:canvas-still', threadId),
    cover: (threadId: string, covered: boolean): Promise<void> => ipcRenderer.invoke('althar:canvas-cover', threadId, covered),
    ground: (threadId: string, change: GroundChange): void => ipcRenderer.send('althar:canvas-ground', threadId, change),
    pins: (threadId: string, pins: ReadonlyArray<GroundPin>): Promise<ReadonlyArray<number> | null> =>
      ipcRenderer.invoke('althar:canvas-pins', threadId, pins),
    find: (threadId: string, part: { page: string; board: string; selector: string }): Promise<CanvasPointed | null> =>
      ipcRenderer.invoke('althar:canvas-find', threadId, part),
    clear: (threadId: string): void => ipcRenderer.send('althar:canvas-clear', threadId),
    picture: (manifest: string): Promise<string | null> => ipcRenderer.invoke('althar:canvas-picture', manifest),
    onGround: (listener: (threadId: string, news: CanvasGroundNews) => void): (() => void) => {
      canvasGround.add(listener)
      return () => void canvasGround.delete(listener)
    },
    download: (request: CanvasDownload): Promise<CanvasDownloaded> => ipcRenderer.invoke('althar:canvas-download', request),
  },
  // What the page couldn't handle, for main's log: its message and stack, nothing else.
  logError: (error: { kind: 'error' | 'rejection'; message: string; stack: string; source?: string }): void =>
    ipcRenderer.send('althar:window-error', error),
  // What made the page slow, for main's log: its long frames and slow presses, by what they were on, never what it shows.
  logFrames: (frames: unknown): void => ipcRenderer.send('althar:window-frames', frames),
  onOpen: (listener: (threadId: string) => void): (() => void) => {
    opening.add(listener)
    if (pending !== undefined) {
      listener(pending)
      pending = undefined
    }
    return () => void opening.delete(listener)
  },
})
