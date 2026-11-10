import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { CanvasSummary } from '@althar/contracts'
import { type ArtifactRow, Artifacts } from '@althar/ui'

import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'
import { CanvasHost } from './CanvasHost'

/*
 * A project's Artifacts view (ADR-104): what its agents made to keep, every
 * lead's and the coordinator's, newest first, read again as one is
 * published, commented on or archived. Today that is its canvases. One
 * opened takes the view; what is said on it goes to the coordinator's
 * conversation, the project's own, as a comment made beside it would.
 */

/** A canvas as its row shows it: who made its latest version, and when, apart, so they line up down the list. */
export const rowOf = (canvas: CanvasSummary, now = new Date()): ArtifactRow => ({
  id: canvas.id,
  name: canvas.name,
  title: canvas.latest.title,
  kind: canvas.latest.kind,
  version: canvas.latest.number,
  by: canvas.latest.by.role === 'coordinator' ? 'Coordinator' : `Lead of ${canvas.latest.by.taskTitle ?? 'a task'}`,
  when: ago(canvas.latest.at, now),
  openComments: canvas.openComments,
})

export function ArtifactsView({
  projectId,
  threadId,
  draft,
}: {
  projectId: string
  /** The coordinator's thread: where an artifact opened here is beside, for its comments and its page's view. */
  threadId: string | null
  draft: string | null
}) {
  const { client } = useServices()
  const list = useQuery(reads(client).canvases(projectId))
  const [open, setOpen] = useState<{ readonly canvasId: string; readonly version: number | null } | null>(null)
  return (
    <Artifacts
      canvases={(list.data ?? []).map((one) => rowOf(one))}
      onOpen={(row) => setOpen({ canvasId: row.id, version: null })}
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
