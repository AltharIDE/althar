/** The set is kept in focus order, with the most recently focused window last. */
export const focusedLast = <T>(windows: Set<T>, window: T) => {
  if (!windows.delete(window)) return
  windows.add(window)
}

export const openFromEdge = (open: () => void, settle: () => void) => {
  open()
  settle()
}

export const bringForward = <
  T extends {
    isMinimized: () => boolean
    restore: () => void
    showInactive: () => void
    show: () => void
    focus: () => void
  },
>(
  windows: Set<T>,
  open: () => T,
  activate: () => void,
  quiet: boolean,
) => {
  const existing = [...windows].at(-1)
  const window = existing ?? open()
  if (window.isMinimized()) window.restore()
  if (quiet) window.showInactive()
  else {
    activate()
    window.show()
    window.focus()
  }
  return { window, fresh: existing === undefined }
}
