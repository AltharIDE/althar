import { type DragEvent, useRef, useState } from 'react'

/**
 * Folders held over a part of the page, and dropped on it: whether some are
 * held over it now, counting a drag's enters and leaves over what is inside,
 * and the handlers to spread on it. Without `onDrop`, it takes no drops.
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
