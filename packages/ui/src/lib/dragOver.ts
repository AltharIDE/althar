import { type DragEvent, useRef, useState } from 'react'

/**
 * Folders held over a screen that takes them: whether some are, with the
 * counting a drag's enters and leaves over its children need, and the
 * handlers for its root. Without `onDrop`, a drop does nothing and nothing
 * shows it would.
 */
export function useDragOver(onDrop: ((files: readonly File[]) => void) | undefined) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  if (onDrop === undefined) return { over: false, handlers: {} }
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        depth.current += 1
        setOver(true)
      },
      onDragOver: (event: DragEvent) => {
        if (carriesFiles(event)) event.preventDefault()
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        depth.current = 0
        setOver(false)
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onDrop(files)
      },
    },
  }
}
