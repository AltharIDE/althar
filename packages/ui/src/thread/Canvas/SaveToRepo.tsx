import { type ReactNode, useId, useMemo, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Select } from '../../primitives/Select/Select'
import { Switch } from '../../primitives/Switch/Switch'
import s from './SaveToRepo.module.css'

/*
 * Saving an artifact to a repository (ADR-104), from its panel's head: the
 * project keeps one place for its artifacts, so this opens on that place,
 * with the artifact's folder named in place, and Save. Somewhere else opens
 * the repository's folders as a tree, to put it anywhere, and can make the
 * folder picked the place from now on. The first save in a project is
 * Althar's pick, with why, and makes it the place. How it goes in (a pull
 * request of its own, or straight to the default branch) and when it is
 * committed are the project's setting, said in a line with Settings beside
 * it. Saved, it opens where it is: to move it, commit its newest version, or
 * stop saving it.
 */

export interface SaveToRepoText {
  saveTo: (title: string, repository: string) => string
  inGit: (title: string) => string
  at: (version: number, repository: string, commit: string) => string
  saving: string
  stop: string
  newTag: string
  inGitTag: string
  movesTag: string
  home: string
  pick: (why: string) => string
  fromNow: string
  settings: string
  elsewhere: string
  back: string
  repository: string
  find: string
  folders: (repository: string) => string
  loading: string
  none: string
  name: string
  save: (repository: string) => string
  move: string
  commit: (version: number) => string
  again: string
  pullRequest: (n: number) => string
}

export const saveToRepoText: SaveToRepoText = {
  saveTo: (title, repository) => `Save ${title} to ${repository}`,
  inGit: (title) => `${title} in git`,
  at: (version, repository, commit) => `v${version} in ${repository} at ${commit}`,
  saving: 'Saving…',
  stop: 'Stop saving',
  newTag: 'New',
  inGitTag: 'In git',
  movesTag: 'Moves here',
  home: 'The project’s place for artifacts',
  pick: (why) => `Althar’s pick: ${why.charAt(0).toLowerCase()}${why.slice(1)}`,
  fromNow: 'Save artifacts here from now on',
  settings: 'Settings',
  elsewhere: 'Somewhere else',
  back: 'Back',
  repository: 'Repository',
  find: 'Find a folder',
  folders: (repository) => `Folders in ${repository}`,
  loading: 'Reading its folders…',
  none: 'No folder has those words.',
  name: 'Its folder’s name',
  save: (repository) => `Save to ${repository}`,
  move: 'Move it',
  commit: (version) => `Commit v${version}`,
  again: 'Try again',
  pullRequest: (n) => `#${n}`,
}

/** A folder in one of the project's repositories, with a trailing slash; empty for its root. */
export interface SaveToRepoPlace {
  readonly repositoryId: string
  readonly repository: string
  readonly folder: string
}

/** Where the artifact is saved, and how its last save went. */
export interface SaveToRepoSaved {
  readonly repositoryId: string
  readonly repository: string
  /** Its own folder, with a trailing slash: `design/gift-a-class/`. */
  readonly path: string
  readonly version: number | null
  readonly commit: string | null
  readonly pullRequest: { readonly number: number; readonly url: string } | null
  readonly state: 'saving' | 'saved' | 'failed'
  readonly problem: string | null
}

export interface SaveToRepoProps {
  /** The artifact's title, and the name its folder takes unless the person changes it. */
  title: string
  name: string
  /** Its newest version. */
  version: number
  repositories: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Where it goes unless picked elsewhere: the project's place; or, before its first save, Althar's pick with why. */
  place: (SaveToRepoPlace & { readonly why: string | null }) | null
  /** Whether the project has its place yet: the first save makes it. */
  first: boolean
  /** How it goes in and when it is committed, as the project's setting says, in a few words. */
  rule: string
  saved: SaveToRepoSaved | null
  /** The folders of the repository the tree shows, or null while they are read. */
  folders: ReadonlyArray<string> | null
  /** The tree is to show another repository's folders. */
  onRepository: (repositoryId: string) => void
  onSave: (to: { readonly repositoryId: string; readonly path: string; readonly makeHome: boolean }) => void
  onStop: () => void
  onSettings: () => void
  text?: Partial<SaveToRepoText>
}

/** The folder a path is in, with its trailing slash, and its own name. */
const split = (path: string) => {
  const trimmed = path.replace(/\/$/, '')
  const cut = trimmed.lastIndexOf('/')
  return cut === -1 ? { folder: '', name: trimmed } : { folder: `${trimmed.slice(0, cut)}/`, name: trimmed.slice(cut + 1) }
}

/** A name a folder can take on every OS: letters, digits, dots, dashes and underscores, not only dots. */
export const isFolderName = (name: string) => /^[A-Za-z0-9._-]{1,80}$/.test(name) && !/^\.+$/.test(name)

/** The folders right inside `folder`, in order. */
const inside = (folders: ReadonlyArray<string>, folder: string) =>
  folders.filter((one) => one.startsWith(folder) && one !== folder && !one.slice(folder.length, -1).includes('/'))

/** Every folder a path is in, from the top: `a/b/` gives `a/`, `a/b/`. */
const above = (folder: string) => {
  const parts = folder.split('/').filter(Boolean)
  return parts.map((_, at) => `${parts.slice(0, at + 1).join('/')}/`)
}

export function SaveToRepo({
  title,
  name: defaultName,
  version,
  repositories,
  place,
  first,
  rule,
  saved,
  folders,
  onRepository,
  onSave,
  onStop,
  onSettings,
  text,
}: SaveToRepoProps) {
  const t = { ...saveToRepoText, ...text }
  const switchId = useId()
  const was = saved === null ? null : { repositoryId: saved.repositoryId, repository: saved.repository, ...split(saved.path) }
  const start: SaveToRepoPlace & { readonly name: string } = was ?? {
    repositoryId: place?.repositoryId ?? repositories[0]?.id ?? '',
    repository: place?.repository ?? repositories[0]?.name ?? '',
    folder: place?.folder ?? '',
    name: defaultName,
  }
  const [chosen, setChosen] = useState(start)
  const [elsewhere, setElsewhere] = useState(false)
  // The first save makes the project's place; somewhere else becomes it only when asked.
  const [makeHome, setMakeHome] = useState(first)
  const path = `${chosen.folder}${chosen.name}/`
  const atPlace = place !== null && chosen.repositoryId === place.repositoryId && chosen.folder === place.folder
  const moved = saved !== null && (saved.repositoryId !== chosen.repositoryId || saved.path !== path)
  const tag = saved === null ? t.newTag : moved ? t.movesTag : t.inGitTag
  const why = atPlace ? (first && place.why !== null ? t.pick(place.why) : first ? null : t.home) : null
  const asks = first || (elsewhere && !atPlace)
  const saving = saved?.state === 'saving'
  const failed = saved?.state === 'failed' && !moved
  const action =
    saved === null
      ? t.save(chosen.repository)
      : moved
        ? t.move
        : failed
          ? t.again
          : saved.version !== null && saved.version < version
            ? t.commit(version)
            : null
  const pick = (folder: string) => setChosen((now) => ({ ...now, folder }))
  return (
    <div className={s.save}>
      <div className={s.head}>
        <span className={s.headWords}>
          <span className={s.title}>{saved === null ? t.saveTo(title, chosen.repository) : t.inGit(title)}</span>
          {saved !== null && saved.version !== null && saved.commit !== null && (
            <span className={s.now}>
              <Icon name="commit" size={12} />
              {t.at(saved.version, saved.repository, saved.commit.slice(0, 7))}
              {saved.pullRequest !== null && (
                <>
                  {' · '}
                  <a className={s.link} href={saved.pullRequest.url} target="_blank" rel="noreferrer">
                    {t.pullRequest(saved.pullRequest.number)}
                  </a>
                </>
              )}
            </span>
          )}
        </span>
        {saved !== null && (
          <button type="button" className={s.stop} onClick={onStop}>
            {t.stop}
          </button>
        )}
      </div>
      {elsewhere ? (
        <Tree
          t={t}
          repositories={repositories}
          chosen={chosen}
          folders={folders}
          onRepository={(repositoryId) => {
            const repository = repositories.find((one) => one.id === repositoryId)?.name ?? ''
            setChosen((now) => ({ ...now, repositoryId, repository, folder: '' }))
            onRepository(repositoryId)
          }}
          onPick={pick}
          name={<NameField t={t} value={chosen.name} onChange={(name) => setChosen((now) => ({ ...now, name }))} tag={tag} />}
        />
      ) : (
        <div className={s.body}>
          <div className={s.spot}>
            <span className={s.spotGlyph}>
              <Icon name="folder" size={15} />
            </span>
            <span className={s.spotWords}>
              <span className={s.path}>
                <span className={s.trail}>
                  {chosen.repository}
                  {above(chosen.folder).map((one) => (
                    <span key={one}>
                      <span className={s.slash}>/</span>
                      {one.slice(0, -1).split('/').at(-1)}
                    </span>
                  ))}
                  <span className={s.slash}>/</span>
                </span>
                <NameField t={t} value={chosen.name} onChange={(name) => setChosen((now) => ({ ...now, name }))} tag={tag} />
              </span>
              {why !== null && <span className={s.why}>{why}</span>}
            </span>
          </div>
        </div>
      )}
      <div className={s.rules}>
        {failed && saved?.problem !== null && saved?.problem !== undefined && <p className={s.problem}>{saved.problem}</p>}
        {asks && (
          <span className={s.fromNow}>
            <Switch checked={makeHome} onChange={setMakeHome} labelledBy={switchId} />
            <span id={switchId}>{t.fromNow}</span>
          </span>
        )}
        <span className={s.rule}>
          {rule}
          <span className={s.sep}>·</span>
          <LinkButton onClick={onSettings}>{t.settings}</LinkButton>
        </span>
      </div>
      <div className={s.foot}>
        <Button
          variant="quiet"
          size="small"
          icon={elsewhere ? 'chevronL' : 'folder'}
          onClick={() => {
            // Back from the tree is back where it was, with the name as typed.
            if (elsewhere) setChosen((now) => ({ ...start, name: now.name }))
            setElsewhere(!elsewhere)
          }}
        >
          {elsewhere ? t.back : t.elsewhere}
        </Button>
        <span className={s.gap} />
        {saving && !moved ? (
          <Button variant="signal" size="small" busy disabled>
            {t.saving}
          </Button>
        ) : (
          action !== null && (
            <Button
              variant="signal"
              size="small"
              disabled={!isFolderName(chosen.name) || chosen.repositoryId === ''}
              onClick={() => onSave({ repositoryId: chosen.repositoryId, path, makeHome: asks && makeHome })}
            >
              {action}
            </Button>
          )
        )}
      </div>
    </div>
  )
}

/** The artifact's own folder's name, typed in place, with what saving does to it. */
function NameField({ t, value, onChange, tag }: { t: SaveToRepoText; value: string; onChange: (name: string) => void; tag: string }) {
  return (
    <span className={s.name}>
      <input
        className={cx(s.nameInput, !isFolderName(value) && s.nameWrong)}
        value={value}
        aria-label={t.name}
        aria-invalid={!isFolderName(value)}
        spellCheck={false}
        size={Math.max(4, value.length)}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className={s.slash}>/</span>
      <span className={s.tag} data-tag={tag === t.newTag ? 'new' : tag === t.movesTag ? 'moves' : 'git'}>
        {tag}
      </span>
    </span>
  )
}

/** A repository's folders as a tree: open one to go in, press one to put the artifact there, find one by its words. */
function Tree({
  t,
  repositories,
  chosen,
  folders,
  onRepository,
  onPick,
  name,
}: {
  t: SaveToRepoText
  repositories: ReadonlyArray<{ readonly id: string; readonly name: string }>
  chosen: SaveToRepoPlace
  folders: ReadonlyArray<string> | null
  onRepository: (repositoryId: string) => void
  onPick: (folder: string) => void
  name: ReactNode
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(above(chosen.folder)))
  const [find, setFind] = useState('')
  const q = find.trim().toLowerCase()
  const all = useMemo(() => folders ?? [], [folders])
  const shows = (path: string) => q === '' || all.some((one) => one.startsWith(path) && one.toLowerCase().includes(q))
  const toggle = (path: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const rows = (folder: string, depth: number): Array<ReactNode> => [
    ...(folder === chosen.folder
      ? [
          <div key="new" className={s.row} data-new="" style={{ paddingLeft: 10 + depth * 14 }} role="treeitem" aria-selected="true">
            <Icon name="folder" size={13} />
            {name}
          </div>,
        ]
      : []),
    ...inside(all, folder)
      .filter(shows)
      .flatMap((path) => {
        const label = path.slice(folder.length, -1)
        const deeper = inside(all, path).length > 0
        const isOpen = q !== '' || open.has(path) || chosen.folder.startsWith(path)
        return [
          <div key={path} className={cx(s.row, path === chosen.folder && s.here)} style={{ paddingLeft: 10 + depth * 14 }}>
            {deeper ? (
              <button type="button" className={s.twist} aria-label={`${isOpen ? 'Close' : 'Open'} ${label}`} onClick={() => toggle(path)}>
                <Icon name={isOpen ? 'chevronD' : 'chevron'} size={10} />
              </button>
            ) : (
              <span className={s.twistSpace} />
            )}
            <button type="button" role="treeitem" aria-selected={path === chosen.folder} className={s.folder} onClick={() => onPick(path)}>
              <Icon name="folder" size={13} />
              <span className={s.folderName}>{label}</span>
            </button>
          </div>,
          ...(isOpen ? rows(path, depth + 1) : []),
        ]
      }),
  ]
  return (
    <div className={s.body}>
      <div className={s.treeBar}>
        {repositories.length > 1 && (
          <Select
            label={t.repository}
            options={repositories.map((one) => ({ value: one.id, label: one.name }))}
            value={chosen.repositoryId}
            onChange={onRepository}
            width={140}
          />
        )}
        <label className={s.find}>
          <Icon name="search" size={13} />
          <input
            value={find}
            placeholder={t.find}
            aria-label={t.find}
            spellCheck={false}
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && find !== '') {
                event.preventDefault()
                event.stopPropagation()
                setFind('')
              }
            }}
          />
        </label>
      </div>
      <div className={s.tree} role="tree" aria-label={t.folders(chosen.repository)} aria-busy={folders === null}>
        <div className={cx(s.row, chosen.folder === '' && s.here)} style={{ paddingLeft: 10 }}>
          <span className={s.twistSpace} />
          <button type="button" role="treeitem" aria-selected={chosen.folder === ''} className={s.folder} onClick={() => onPick('')}>
            <Icon name="branch" size={13} />
            <span className={s.folderName}>{chosen.repository}</span>
          </button>
        </div>
        {folders === null ? (
          <p className={s.quiet}>{t.loading}</p>
        ) : (
          <>
            {rows('', 1)}
            {q !== '' && !all.some((one) => one.toLowerCase().includes(q)) && <p className={s.quiet}>{t.none}</p>}
          </>
        )}
      </div>
    </div>
  )
}
