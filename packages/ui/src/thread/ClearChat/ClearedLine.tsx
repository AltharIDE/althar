import { useEffect, useRef } from 'react'

import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { ThreadDivider } from '../Furniture/Furniture'

export interface ClearedLineText {
  cleared: string
  earlier: string
  showEarlier: string
  backToNow: string
  undo: string
}

export const clearedLineText: ClearedLineText = {
  cleared: 'Cleared',
  earlier: 'Earlier conversation',
  showEarlier: 'Show earlier',
  backToNow: 'Back to now',
  undo: 'Undo',
}

export interface ClearedLineProps {
  /** The conversation before the clear is read in the thread's place. */
  earlierOpen: boolean
  onShowEarlier: () => void
  onBackToNow: () => void
  onUndo: () => void
  text?: Partial<ClearedLineText>
}

/**
 * Where the thread's cleared view begins: the way to the conversation before
 * it, and the way back, and Undo, which brings the whole thread back. With the
 * earlier conversation open it brings itself into view, since that is where
 * the way back is.
 */
export function ClearedLine({ earlierOpen, onShowEarlier, onBackToNow, onUndo, text }: ClearedLineProps) {
  const t = { ...clearedLineText, ...text }
  const line = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!earlierOpen) return
    // Once the thread has drawn the conversation it is in: it follows its end until then.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => line.current?.scrollIntoView({ block: 'start' }))
    })
    return () => cancelAnimationFrame(frame)
  }, [earlierOpen])
  return (
    <ThreadDivider ref={line} icon={earlierOpen ? 'corner' : 'remove'}>
      {earlierOpen ? t.earlier : t.cleared}
      <span aria-hidden="true">{' · '}</span>
      <LinkButton onClick={earlierOpen ? onBackToNow : onShowEarlier}>{earlierOpen ? t.backToNow : t.showEarlier}</LinkButton>
      <span aria-hidden="true">{' · '}</span>
      <LinkButton onClick={onUndo}>{t.undo}</LinkButton>
    </ThreadDivider>
  )
}
