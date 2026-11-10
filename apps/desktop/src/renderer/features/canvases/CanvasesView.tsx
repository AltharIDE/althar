import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { CanvasSummary } from '@althar/contracts'
import { type CanvasCard, Canvases } from '@althar/ui'

import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { byWords, CanvasHost } from './CanvasHost'

/*
 * A project's Canvases view (ADR-104): every lead's canvases and the
 * coordinator's, newest first, read again as one is published, commented on
 * or archived. One opened takes the view; what is said on it goes to the
 * coordinator's conversation, the project's own, as a comment made beside
 * it would.
 */

/** A canvas as its card shows it. */
export const cardOf = (canvas: CanvasSummary, now = new Date()): CanvasCard => ({
  id: canvas.id,
  name: canvas.name,
  title: canvas.latest.title,
  kind: canvas.latest.kind,
  version: canvas.latest.number,
  by: byWords(canvas.latest, now),
  openComments: canvas.openComments,
})

export function CanvasesView({
  projectId,
  threadId,
  draft,
}: {
  projectId: string
  /** The coordinator's thread: where a canvas opened here is beside, for its comments and its page's view. */
  threadId: string | null
  draft: string | null
}) {
  const { client } = useServices()
  const list = useQuery(reads(client).canvases(projectId))
  const [open, setOpen] = useState<{ readonly canvasId: string; readonly version: number | null } | null>(null)
  return (
    <Canvases
      canvases={(list.data ?? []).map((one) => cardOf(one))}
      onOpen={(card) => setOpen({ canvasId: card.id, version: null })}
      {...(list.isError ? { error: messageOf(list.error) } : {})}
      open={
        open !== null &&
        threadId !== null && (
          <CanvasHost
            key={open.canvasId}
            threadId={threadId}
            open={{ ...open, follow: open.version === null }}
            draft={draft}
            onVersion={(version) => setOpen({ ...open, version })}
            onClose={() => setOpen(null)}
          />
        )
      }
    />
  )
}
