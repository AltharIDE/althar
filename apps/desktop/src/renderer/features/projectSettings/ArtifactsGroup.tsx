import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ArtifactsHome, ArtifactsHow, ArtifactsPlace } from '@althar/contracts'
import { Select, SettingGroup, SettingList, SettingRow, SettingSwitch } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { HEADING } from './sections'

/*
 * Where the project's artifacts go in git (ADR-104), beside its repositories:
 * the folder Save to repo puts one in unless someone picks somewhere else,
 * how they go in, and whether each new version is committed. The first save
 * sets it; here it changes, as any setting does, at once.
 */

export const text = {
  title: 'Artifacts',
  note: 'Where Save to repo puts an artifact unless someone picks somewhere else. The first one saved sets it.',
  savedIn: 'Saved in',
  unset: 'Set by the first save',
  how: 'How they go in',
  pr: 'A pull request of its own',
  main: 'Straight to its default branch',
  prNote: 'Each on a branch of its own, with a pull request',
  mainNote: 'Committed to the repository’s default branch',
  follow: 'Commit each new version',
  followNote: 'Otherwise only the version someone saves',
} as const

/** A folder in a repository as the list of places names it, and back. */
const valueOf = (repositoryId: string, folder: string) => `${repositoryId}:${folder}`
const placeOf = (value: string) => {
  const cut = value.indexOf(':')
  return { repositoryId: value.slice(0, cut), folder: value.slice(cut + 1) }
}

/** The folders an artifact could go in: each repository's root and its folders two deep, as `kiln/design/`. */
export const placesOf = (
  repositories: ReadonlyArray<{ readonly id: string; readonly name: string; readonly folders: ReadonlyArray<string> }>,
) =>
  repositories.flatMap((repository) => [
    { value: valueOf(repository.id, ''), label: `${repository.name}/` },
    ...repository.folders
      .filter((folder) => folder.split('/').filter(Boolean).length <= 2)
      .map((folder) => ({ value: valueOf(repository.id, folder), label: `${repository.name}/${folder}` })),
  ])

export function ArtifactsGroup({ projectId }: { projectId: string }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const place = useQuery(reads(client).artifactsPlace(projectId))
  const repositories = useQuery(reads(client).repositories(projectId))
  const folders = useQueries({
    queries: (repositories.data ?? []).map((one) => reads(client).repositoryFolders(projectId, one.id)),
  })
  const home = place.data?.home ?? null
  const shown = home ?? place.data?.guess ?? null
  const options = placesOf(
    (repositories.data ?? []).map((one, at) => ({ id: one.id, name: one.name, folders: folders[at]?.data?.folders ?? [] })),
  )

  /** Sets the place at once; the runtime's word follows, and what fails is read again. */
  const set = (change: Partial<Pick<ArtifactsHome, 'repositoryId' | 'folder' | 'how' | 'follow'>>) => {
    const base = home ?? shown
    if (base === null && (change.repositoryId === undefined || change.folder === undefined)) return
    const next = {
      repositoryId: change.repositoryId ?? base?.repositoryId ?? '',
      folder: change.folder ?? base?.folder ?? '',
      how: change.how ?? base?.how ?? 'pr',
      follow: change.follow ?? base?.follow ?? true,
    }
    const repository = repositories.data?.find((one) => one.id === next.repositoryId)?.name ?? base?.repository ?? ''
    cache.setQueryData<ArtifactsPlace>(keys.artifactsPlace(projectId), (was) => ({
      home: { ...next, repository },
      guess: was?.guess ?? null,
    }))
    void client.setArtifactsHome(projectId, next).catch(() => cache.invalidateQueries({ queryKey: keys.artifactsPlace(projectId) }))
  }
  const how: ArtifactsHow = shown?.how ?? 'pr'
  return (
    <SettingGroup title={text.title} headingLevel={HEADING.part} note={text.note}>
      <SettingList>
        <SettingRow title={text.savedIn}>
          {() => (
            <Select
              label={text.savedIn}
              options={options}
              value={home === null ? null : valueOf(home.repositoryId, home.folder)}
              placeholder={text.unset}
              searchable
              width={240}
              onChange={(value) => set(placeOf(value))}
            />
          )}
        </SettingRow>
        <SettingRow title={text.how} note={how === 'pr' ? text.prNote : text.mainNote}>
          {() => (
            <Select
              label={text.how}
              options={[
                { value: 'pr', label: text.pr },
                { value: 'main', label: text.main },
              ]}
              value={how}
              width={240}
              disabled={shown === null}
              onChange={(value) => set({ how: value })}
            />
          )}
        </SettingRow>
        <SettingSwitch
          title={text.follow}
          note={text.followNote}
          checked={shown?.follow ?? true}
          disabled={shown === null}
          onChange={(follow) => set({ follow })}
        />
      </SettingList>
    </SettingGroup>
  )
}
