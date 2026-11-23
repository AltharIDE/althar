import { useQueries, useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'

import type { ArtifactDrawing, CanvasSummary, PlanStep } from '@althar/contracts'
import { type ArtifactRow, Artifacts, type ArtifactsFilter, type ArtifactsLayout } from '@althar/ui'

import { pictureUrl } from '../../../main/pictureAddress'
import { messageOf } from '../../data/client'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago } from '../../shared/time'
import { ArtifactRoom, byOf, type OpenArtifact } from './ArtifactRoom'
import { onAsked, takeAsked } from './opening'

/*
 * A project's Artifacts view (ADR-104): what its agents made to keep, every
 * lead's, the coordinator's and those drawn in their own chats, as cards or
 * one table, read again as one is published, commented on, saved or
 * archived. Today that is its canvases, and the artifacts whose own chat is
 * drawing their first version. One opened takes the view as the artifact
 * itself, with its own chat beside it ("Talking to an artifact"), never the
 * task or the conversation that drew it; Escape or its way back comes here.
 */

/** A canvas as its row shows it: who made its latest version, and when, apart, so they line up down the list. */
export const rowOf = (canvas: CanvasSummary, now = new Date()): ArtifactRow => ({
  id: canvas.id,
  name: canvas.name,
  title: canvas.latest.title,
  kind: canvas.latest.kind,
  version: canvas.latest.number,
  by: byOf(canvas),
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
const LEFT: { layout: ArtifactsLayout; filter: ArtifactsFilter } = { layout: 'cards', filter: { saved: false, commented: false } }
let kept = LEFT

/** Forgets how the view was last left, as a window opened afresh would: for tests. */
export const forgetArtifactsView = () => {
  kept = LEFT
}

/** An artifact its own chat is drawing the first version of, as its card and row show it. */
export const drawingRowOf = (one: ArtifactDrawing, now = new Date()): ArtifactRow => ({
  id: one.taskId,
  name: '',
  title: one.title,
  kind: 'boards',
  version: 0,
  by: '',
  when: ago(one.startedAt, now),
  at: one.startedAt,
  openComments: 0,
  drawing: true,
})

export function ArtifactsView({
  projectId,
  header = null,
  threadId,
  lead,
}: {
  projectId: string
  /** The project's top row, shown over every artifact; one opened has its own row in its place. */
  header?: ReactNode
  /** The coordinator's thread: what an artifact no one has talked to yet is shown by. */
  threadId: string | null
  /** Who answers in an artifact's chat started here: the coordinator's composer's pick. */
  lead: PlanStep | null
}) {
  const { client, host } = useServices()
  const views = host.canvases
  const list = useQuery(reads(client).canvases(projectId))
  const drawing = useQuery(reads(client).artifactsDrawing(projectId))
  // One asked to open from a canvas beside a conversation opens as itself, at once.
  const [open, setOpen] = useState<OpenArtifact | null>(() => {
    const asked = takeAsked(projectId)
    return asked === null ? null : { id: asked, version: null }
  })
  useEffect(
    () =>
      onAsked(() => {
        const asked = takeAsked(projectId)
        if (asked !== null) setOpen({ id: asked, version: null })
      }),
    [projectId],
  )
  const [shown, setShown] = useState(kept)
  // A page's and a canvas of boards' cards show the picture kept of them as they were last drawn, where one was.
  const drawn = (list.data ?? []).filter((one) => one.latest.kind === 'html' || one.latest.kind === 'boards')
  const pictures = useQueries({
    queries: drawn.map((one) => ({
      queryKey: ['canvasPicture', one.latest.manifest] as const,
      queryFn: async () => (await views?.picture?.(one.latest.manifest)) ?? null,
      enabled: views?.picture !== undefined,
      // A version's picture, once kept, never changes; one not kept yet is asked for again as the view comes back.
      staleTime: (query: { state: { data: unknown } }) => (query.state.data === null ? 0 : Number.POSITIVE_INFINITY),
    })),
  })
  const pictureOf = new Map(drawn.map((one, at) => [one.id, pictures[at]?.data ?? null]))
  // Escape, from anywhere but a field or something open over it, goes back to every artifact.
  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || event.target !== document.body) return
      event.preventDefault()
      setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      {open === null && header}
      <Artifacts
        canvases={[
          ...(drawing.data ?? []).map((one) => drawingRowOf(one)),
          ...(list.data ?? []).map((one) => {
            const row = rowOf(one)
            const picture = pictureOf.get(one.id)
            return picture === undefined || picture === null ? row : { ...row, picture }
          }),
        ]}
        layout={shown.layout}
        onLayout={(layout) => setShown((kept = { ...kept, layout }))}
        filter={shown.filter}
        onFilter={(filter) => setShown((kept = { ...kept, filter }))}
        onOpen={(row) => setOpen({ id: row.id, version: null })}
        {...(list.isError ? { error: messageOf(list.error) } : {})}
        open={
          open !== null && (
            <ArtifactRoom
              projectId={projectId}
              coordinatorThreadId={threadId}
              open={open}
              canvases={list.data ?? []}
              drawing={drawing.data ?? []}
              lead={lead}
              onOpen={setOpen}
              onBack={() => setOpen(null)}
            />
          )
        }
      />
    </>
  )
}
