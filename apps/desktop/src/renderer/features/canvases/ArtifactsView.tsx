import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { CanvasSummary } from '@althar/contracts'
import { type ArtifactRow, Artifacts, type ArtifactsFilter, type ArtifactsLayout } from '@althar/ui'

import { pictureUrl } from '../../../main/pictureAddress'
import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'
import { CanvasHost } from './CanvasHost'

/*
 * A project's Artifacts view (ADR-104): what its agents made to keep, every
 * lead's and the coordinator's, as cards or one table, read again as one is
 * published, commented on, saved or archived. Today that is its canvases.
 * One opened goes beside the conversation that drew it, where it is talked
 * about and changed, with a way back here; one that names no conversation
 * takes the view, and what is said on it goes to the coordinator's.
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
  at: canvas.latest.at,
  openComments: canvas.openComments,
  // A picture is its own picture; the rest show a drawing of their kind until a picture of them as drawn is kept.
  picture: canvas.latest.kind === 'picture' ? pictureUrl(canvas.latest.entrySha256, true) : null,
  saved:
    canvas.saved === undefined || canvas.saved === null
      ? null
      : { repository: canvas.saved.repository, path: canvas.saved.path, state: canvas.saved.state },
})

/* How the view was last left, cards or the table and what Filter kept: coming back, it shows as it was. */
let kept: { layout: ArtifactsLayout; filter: ArtifactsFilter } = { layout: 'cards', filter: { saved: false, commented: false } }

export function ArtifactsView({
  projectId,
  threadId,
  draft,
  onBeside,
}: {
  projectId: string
  /** The coordinator's thread: where an artifact opened here is beside, for its comments and its page's view. */
  threadId: string | null
  draft: string | null
  /** Opens a canvas beside the conversation that drew it, by that conversation's thread and its task where it has one. */
  onBeside?: (canvasId: string, threadId: string, taskId: string | null) => void
}) {
  const { client } = useServices()
  const list = useQuery(reads(client).canvases(projectId))
  const [open, setOpen] = useState<{ readonly canvasId: string; readonly version: number | null } | null>(null)
  const [shown, setShown] = useState(kept)
  return (
    <Artifacts
      canvases={(list.data ?? []).map((one) => rowOf(one))}
      layout={shown.layout}
      onLayout={(layout) => setShown((kept = { ...kept, layout }))}
      filter={shown.filter}
      onFilter={(filter) => setShown((kept = { ...kept, filter }))}
      onOpen={(row) => {
        const by = list.data?.find((one) => one.id === row.id)?.latest.by
        if (onBeside !== undefined && by?.threadId !== undefined) return onBeside(row.id, by.threadId, by.taskId)
        setOpen({ canvasId: row.id, version: null })
      }}
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
