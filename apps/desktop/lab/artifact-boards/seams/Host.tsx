import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { artifactOf } from '../artifacts'
import { chat, useChat } from '../chat'
import { momentOf, type Moment } from '../moments'
import { ArtifactCanvas } from '../parts/ArtifactCanvas'
import { roundOf, useLab } from '../state'
import h from './host.module.css'

/*
 * The lab's canvas beside a conversation (in place of
 * features/canvases/CanvasHost, for ThreadHost): an artifact as a canvas of
 * boards, edge to edge. What's for the whole artifact (which it is, who sees
 * it, its versions, git, Share) is in the chat's top row (seams/ui.tsx); the
 * canvas keeps its pages and the view, zoom and the tool bar. What is said
 * on it goes to the conversation beside it (A), or stays on a pin on the
 * part (D). It can have the window to itself, the conversation out of the way.
 */

export interface OpenCanvas {
  readonly canvasId: string
  readonly version: number | null
  readonly follow: boolean
}

export interface CanvasHostProps {
  readonly threadId: string
  readonly open: OpenCanvas
  readonly draft: string | null
  readonly onVersion: (version: number) => void
  readonly onClose: () => void
}

export function CanvasHost({ open }: CanvasHostProps) {
  const { d, m } = useLab()
  // The moment's opening is for the canvas the moment opens with; one opened from the thread opens as it is.
  return (
    <Panel
      key={`${open.canvasId}|${roundOf()}`}
      canvasId={open.canvasId}
      talk={d === 'd' ? 'pin' : 'conversation'}
      moment={momentOf(d, m)}
    />
  )
}

export function Panel({ canvasId, talk, moment }: { canvasId: string; talk: 'conversation' | 'pin'; moment: Moment }) {
  const { beside, wide } = useChat()
  // The chat is on what was opened from its conversation, until its top row picks another.
  useEffect(() => chat.beside(canvasId), [canvasId])
  const artifact = artifactOf(beside)
  const panel = useRef<HTMLElement>(null)
  const [over, setOver] = useState<CSSProperties | null>(null)
  // The canvas on its own: over the conversation, from the top row down to where the panel ends.
  useLayoutEffect(() => {
    if (!wide) return setOver(null)
    const box = panel.current?.getBoundingClientRect()
    if (box !== undefined) setOver({ position: 'fixed', left: 0, right: 0, top: box.top, height: box.height, zIndex: 20 })
  }, [wide])
  return (
    <section ref={panel} className={h.panel} style={over ?? undefined} data-wide={wide || undefined} aria-label={artifact.title}>
      <ArtifactCanvas key={artifact.id} artifact={artifact} talk={talk} opening={artifact.id === canvasId ? moment.opening : {}} />
    </section>
  )
}
