import { type Artifact, ARTIFACTS, type ArtifactKind } from './artifacts'
import { live } from './live'

/*
 * What's in the project's repositories, as the Save to repo pickers browse
 * it: their folders (made up, as kiln's code and the team's designs might
 * be), with the artifacts already saved in them laid over, wherever they
 * are now. Building it for real, Althar reads the folders from git at the
 * default branch's head, in a worker, and keeps them as the file index.
 */

export interface Folder {
  readonly name: string
  readonly kids?: ReadonlyArray<Folder>
}

const f = (name: string, ...kids: Folder[]): Folder => (kids.length > 0 ? { name, kids } : { name })

const TREES: Readonly<Record<string, ReadonlyArray<Folder>>> = {
  kiln: [
    f(
      'apps',
      f('admin', f('src')),
      f('web', f('public'), f('src', f('components'), f('features', f('bookings'), f('checkout'), f('classes'), f('gift')), f('styles'))),
    ),
    f('design', f('tokens')),
    f('docs', f('decisions'), f('flows')),
    f('packages', f('ui', f('src'))),
  ],
  'kiln-design': [f('archive'), f('brand', f('logo'), f('type')), f('explorations', f('2026-autumn'), f('2026-summer'))],
}

/** Where a place is in a repository: a folder (`design/`, or the root, ``) and its name there. */
export interface Place {
  readonly repo: string
  readonly folder: string
  readonly name: string
}

const SUFFIX: Readonly<Record<ArtifactKind, string>> = { design: '', document: '.md', diagram: '.mmd', chart: '.svg' }
/** A design is a folder; a document, a diagram or a chart is one file. */
export const isFolder = (artifact: Artifact) => artifact.kind === 'design'
export const nameFor = (artifact: Artifact) => `${artifact.name}${SUFFIX[artifact.kind]}`
export const pathOf = (place: Place, artifact: Artifact) => `${place.folder}${place.name}${isFolder(artifact) ? '/' : ''}`
/** `design/calmer-checkout/` is calmer-checkout in design/; `docs/flows/booking.mmd`, booking.mmd in docs/flows/. */
export const placeOfPath = (repo: string, path: string): Place => {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop() ?? ''
  return { repo, folder: parts.length > 0 ? `${parts.join('/')}/` : '', name }
}

const at = (repo: string, folder: string): ReadonlyArray<Folder> | null => {
  let here = TREES[repo] ?? []
  for (const part of folder.split('/').filter(Boolean)) {
    const next = here.find((one) => one.name === part)
    if (next === undefined) return null
    here = next.kids ?? []
  }
  return here
}

/** What's in a folder: its folders, and the artifacts saved there (but the one being placed). */
export type Entry =
  | { readonly kind: 'folder'; readonly name: string; readonly path: string; readonly deeper: boolean }
  | { readonly kind: 'artifact'; readonly name: string; readonly artifact: Artifact; readonly folder: boolean }

export const entriesOf = (repo: string, folder: string, but: Artifact): ReadonlyArray<Entry> => {
  const folders: Entry[] = (at(repo, folder) ?? []).map((one) => ({
    kind: 'folder',
    name: one.name,
    path: `${folder}${one.name}/`,
    deeper: (one.kids?.length ?? 0) > 0,
  }))
  const saved: Entry[] = ARTIFACTS.filter((one) => one.id !== but.id).flatMap((one) => {
    const kept = live.keptOf(one)
    if (kept === null || kept.repo !== repo) return []
    const place = placeOfPath(repo, kept.path)
    return place.folder === folder ? [{ kind: 'artifact' as const, name: place.name, artifact: one, folder: isFolder(one) }] : []
  })
  return [...folders, ...saved].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every folder in a repository, for finding one by its words. */
export const foldersIn = (repo: string): ReadonlyArray<string> => {
  const out: string[] = ['']
  const walk = (kids: ReadonlyArray<Folder>, at: string) => {
    for (const one of kids) {
      out.push(`${at}${one.name}/`)
      walk(one.kids ?? [], `${at}${one.name}/`)
    }
  }
  walk(TREES[repo] ?? [], '')
  return out
}

/** The folders above a folder, and it: `apps/web/` is `apps/`, `apps/web/`. */
export const above = (folder: string): ReadonlyArray<string> => {
  const parts = folder.split('/').filter(Boolean)
  return parts.map((_, i) => `${parts.slice(0, i + 1).join('/')}/`)
}

/** The code each task changes: where its designs could sit beside it. */
const TASK_FOLDER: Readonly<Record<string, string>> = {
  'Gift a class': 'apps/web/src/features/gift/',
  'A calmer checkout': 'apps/web/src/features/checkout/',
  'Bigger photos on Classes': 'apps/web/src/features/classes/',
}

export interface Suggestion {
  readonly key: string
  readonly title: string
  readonly why: string
  readonly repo: string
  readonly folder: string
}

/**
 * Where Althar would put an artifact, and why: beside what's like it in the
 * project's repository, beside the code its task changes, or with the team's
 * designs. Building it for real, the lead picks these as it saves, from
 * where the project keeps such things.
 */
export const suggestionsFor = (artifact: Artifact): ReadonlyArray<Suggestion> => {
  const home = artifact.kind === 'design' ? 'design/' : artifact.kind === 'diagram' ? 'docs/flows/' : 'docs/'
  const near = entriesOf('kiln', home, artifact).find((one) => one.kind === 'artifact')
  const code = artifact.task === null ? undefined : TASK_FOLDER[artifact.task]
  const team = entriesOf('kiln-design', '', artifact).find((one) => one.kind === 'artifact')
  return [
    {
      key: 'home',
      title: artifact.kind === 'design' ? 'With kiln’s designs' : 'With kiln’s docs',
      why: near?.kind === 'artifact' ? `Beside ${near.artifact.title}` : 'Where kiln keeps them',
      repo: 'kiln',
      folder: home,
    },
    ...(code === undefined
      ? []
      : [
          {
            key: 'code',
            title: 'Beside the code it designs',
            why: `${artifact.task ?? ''}’s change is in this folder`,
            repo: 'kiln',
            folder: code,
          },
        ]),
    {
      key: 'team',
      title: 'With the team’s designs',
      why:
        team?.kind === 'artifact' ? `Where ${team.artifact.by} keeps ${team.artifact.title}` : 'The repository the team keeps for designs',
      repo: 'kiln-design',
      folder: '',
    },
  ]
}
