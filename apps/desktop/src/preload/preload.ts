import { contextBridge, ipcRenderer, webUtils } from 'electron'

/*
 * The window's bridge to the main process, and nothing more: the port to the
 * runtime, handed on to the page, the folder picker, which only the main
 * process can open, and where a dropped folder is. The page gets no Node, no
 * file system, no shell.
 */

ipcRenderer.on('charrette:port', (event) => {
  window.postMessage('charrette:port', '*', event.ports)
})

contextBridge.exposeInMainWorld('charrette', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('charrette:pick-folder'),
  pathOf: (file: File): string => webUtils.getPathForFile(file),
})
