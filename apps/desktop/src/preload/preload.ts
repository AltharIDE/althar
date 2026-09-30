import { contextBridge, ipcRenderer, webUtils } from 'electron'

/*
 * The window's bridge to the main process, and nothing more: the port to the
 * runtime, handed on to the page, and folders the person chose, by the picker
 * or a drop, each as a grant. The page never sees or sends a path. It gets no
 * Node, no file system, no shell.
 */

ipcRenderer.on('charrette:port', (event) => {
  window.postMessage('charrette:port', '*', event.ports)
})

contextBridge.exposeInMainWorld('charrette', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('charrette:pick-folder'),
  // Only a file the person dropped has a path; one the page made has none.
  grantDropped: (file: File): Promise<string | null> => {
    const path = webUtils.getPathForFile(file)
    return path === '' ? Promise.resolve(null) : ipcRenderer.invoke('charrette:grant-dropped', path)
  },
})
