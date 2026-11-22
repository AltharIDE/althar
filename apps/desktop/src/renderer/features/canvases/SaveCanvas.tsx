import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { ArtifactsHome, ArtifactsHow, CanvasDetail, CanvasSaved, CanvasSummary } from '@althar/contracts'
import { Button, Popover, Room, SaveToRepo } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Save to repo, in an artifact's head (ADR-104): the button says where it is
 * saved, or that it is saving or failed; pressed, it opens on the project's
 * place for artifacts (Althar's pick, before the first save) with the tree
 * for somewhere else. Saving shows at once, the canvas saying it is saving
 * before the runtime has read the press; its commit follows, and the canvas
 * says how it went. The project's place, how and when are its setting, a
 * press away in Settings.
 */

export const text = {
  save: 'Save to repo',
  saving: 'Saving…',
  inGit: 'In git',
  failed: 'Saving failed',
  label: 'Save to repo',
  pr: 'A pull request of its own',
  main: 'Straight to its default branch',
  follow: 'a commit each version',
  once: 'committed when you save',
} as const

/** The project's rule for its artifacts, in a few words: “A pull request of its own, a commit each version”. */
export const ruleOf = (how: ArtifactsHow, follow: boolean) => `${how === 'pr' ? text.pr : text.main}, ${follow ? text.follow : text.once}`

/** A canvas's summary as saving it makes it at once: saving to the place asked, the commit to follow. */
export const savingOf = (
  summary: CanvasSummary,
  to: Pick<CanvasSaved, 'repositoryId' | 'repository' | 'path' | 'how' | 'follow'>,
): CanvasSummary => ({
  ...summary,
  saved: {
    ...to,
    version: summary.saved?.version ?? null,
    commit: summary.saved?.commit ?? null,
    pullRequest: summary.saved?.pullRequest ?? null,
    state: 'saving',
    problem: null,
  },
})

export function SaveCanvas({ summary, version }: { summary: CanvasSummary; version: number }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tree, setTree] = useState<string | null>(null)
  const saved = summary.saved ?? null
  const projectId = summary.projectId
  // Read as it opens, and held after: a second open shows at once.
  const place = useQuery({ ...reads(client).artifactsPlace(projectId), enabled: open })
  const repositories = useQuery({ ...reads(client).repositories(projectId), enabled: open })
  const home: (ArtifactsHome & { readonly why?: string }) | null = place.data?.home ?? place.data?.guess ?? null
  const shownRepository = tree ?? saved?.repositoryId ?? home?.repositoryId ?? repositories.data?.[0]?.id ?? null
  const folders = useQuery({
    ...reads(client).repositoryFolders(projectId, shownRepository ?? ''),
    enabled: open && shownRepository !== null,
  })

  /** Shows the canvas as saving at once, in its panel and in the project's list; the runtime's word follows on the feed. */
  const show = (next: (summary: CanvasSummary) => CanvasSummary) => {
    cache.setQueryData<CanvasDetail>(keys.canvas(summary.id), (was) => (was === undefined ? was : { ...was, summary: next(was.summary) }))
    cache.setQueryData<ReadonlyArray<CanvasSummary>>(keys.canvases(projectId), (was) =>
      was?.map((one) => (one.id === summary.id ? next(one) : one)),
    )
  }
  // What failed comes back as the canvas was, read again, and the button says so.
  const settle = (done: Promise<void>) =>
    void done.catch(() => {
      void cache.invalidateQueries({ queryKey: keys.canvas(summary.id) })
      void cache.invalidateQueries({ queryKey: keys.canvases(projectId) })
    })

  const trigger =
    saved === null ? (
      <Button variant="quiet" size="small" icon="branch">
        {text.save}
      </Button>
    ) : saved.state === 'saving' ? (
      <Button variant="quiet" size="small" busy>
        {text.saving}
      </Button>
    ) : saved.state === 'failed' ? (
      <Button variant="quiet" size="small" icon="problem" title={saved.problem ?? undefined}>
        {text.failed}
      </Button>
    ) : (
      <Button variant="quiet" size="small" icon="commit" title={`${saved.repository}/${saved.path}`}>
        {text.inGit}
      </Button>
    )
  return (
    <Popover label={text.label} trigger={trigger} open={open} onOpenChange={setOpen} align="end" padded={false}>
      {open && (
        <SaveToRepo
          title={summary.latest.title}
          name={summary.name}
          version={version}
          repositories={(repositories.data ?? []).map((one) => ({ id: one.id, name: one.name }))}
          place={
            home === null
              ? null
              : { repositoryId: home.repositoryId, repository: home.repository, folder: home.folder, why: place.data?.guess?.why ?? null }
          }
          first={place.data !== undefined && place.data.home === null}
          rule={ruleOf(home?.how ?? 'pr', home?.follow ?? true)}
          saved={saved}
          folders={folders.data?.folders ?? null}
          onRepository={setTree}
          onSave={({ repositoryId, path, makeHome }) => {
            const how = home?.how ?? 'pr'
            const follow = home?.follow ?? true
            const repository = repositories.data?.find((one) => one.id === repositoryId)?.name ?? home?.repository ?? ''
            show((one) => savingOf(one, { repositoryId, repository, path, how, follow }))
            setOpen(false)
            settle(client.saveCanvas({ canvasId: summary.id, repositoryId, path, how, follow, makeHome }))
          }}
          onStop={() => {
            show((one) => ({ ...one, saved: null }))
            setOpen(false)
            settle(client.stopSavingCanvas(summary.id))
          }}
          onSettings={() => {
            setOpen(false)
            void navigate({ to: '/projects/$projectId', params: { projectId }, search: { room: Room.Settings, section: 'code' } })
          }}
        />
      )}
    </Popover>
  )
}
