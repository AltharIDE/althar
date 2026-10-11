import { useEffect, useRef, useState } from 'react'

/**
 * What a checkpoint folds to takes focus when focus went with what folded:
 * the button you pressed, or the one that vanished as the time ran out. Only
 * after a fold this component saw happen, so a sheet of folded lines never
 * pulls focus as it loads.
 */
export function useFocusAfterFold<T extends HTMLElement>(folded: boolean) {
  const ref = useRef<T>(null)
  const [wasOpen] = useState(!folded)
  useEffect(() => {
    if (!folded || !wasOpen) return
    const lost = document.activeElement === null || document.activeElement === document.body
    if (lost) ref.current?.focus()
  }, [folded, wasOpen])
  return ref
}
