import { contextBridge, ipcRenderer, webUtils } from 'electron'

/*
 * The window's bridge to the main process, and nothing more: the port to the
 * runtime, handed on to the page, folders the person chose, by the picker or
 * a drop, each as a grant, and the thread a notification they clicked opens. The page never sees or sends a path. It gets no
 * Node, no file system, no shell.
 */

ipcRenderer.on('althar:port', (event) => {
  window.postMessage('althar:port', '*', event.ports)
})

/* A thread a notification the person clicked opens: held until the page listens, as a window that just opened doesn't yet. */
let pending: string | undefined
const opening = new Set<(threadId: string) => void>()
ipcRenderer.on('althar:open', (_event, threadId: unknown) => {
  if (typeof threadId !== 'string') return
  if (opening.size === 0) pending = threadId
  for (const listener of opening) listener(threadId)
})

contextBridge.exposeInMainWorld('althar', {
  pickFolder: (purpose: 'project' | 'account' = 'project'): Promise<string | null> => ipcRenderer.invoke('althar:pick-folder', purpose),
  // Only a file the person dropped has a path; one the page made has none.
  grantDropped: (file: File): Promise<string | null> => {
    const path = webUtils.getPathForFile(file)
    return path === '' ? Promise.resolve(null) : ipcRenderer.invoke('althar:grant-dropped', path)
  },
  onOpen: (listener: (threadId: string) => void): (() => void) => {
    opening.add(listener)
    if (pending !== undefined) {
      listener(pending)
      pending = undefined
    }
    return () => void opening.delete(listener)
  },
})
