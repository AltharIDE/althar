import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  Brand,
  BrandMark,
  Button,
  Field,
  Icon,
  SetupPick,
  SetupPicks,
  SetupRepositories,
  type SetupWay,
  SetupZone,
  Spinner,
  LinkButton,
} from '@althar/ui'
import type { NewProjectFolder } from '@althar/ui/screens'

import setUp from '../../../src/renderer/features/homes/SetUp.module.css'
import {
  FOUND,
  type Found,
  HOME,
  HOSTS,
  type JobHandle,
  type Job,
  type NeedKey,
  On,
  on,
  pastedOf,
  REPOS,
  type Source,
  slugOf,
  whereOf,
  world,
  YOURS,
} from '../world'
import p from './parts.module.css'

/*
 * What the directions share: choosing where a project's code comes from on
 * the home (a clone from a code host, a folder found there, or a new
 * repository), and the home's job as it makes it, step by step, in Connect
 * a home's own steps.
 */

export interface Pick {
  readonly way: SetupWay
  readonly onWay: (way: SetupWay) => void
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly chosen: string | null
  readonly choose: (id: string) => void
  readonly folder: string | null
  readonly chooseFolder: (id: string) => void
  /** Folders typed by their path, on the home. */
  readonly typed: readonly Found[]
  readonly addPath: (path: string) => void
  readonly fresh: string
  readonly onFresh: (name: string) => void
  /** Where its code comes from, as chosen so far; null with nothing chosen. */
  readonly source: Source | null
}

/** A folder typed by its path on the home, as reading it would find it. */
const foundAt = (path: string): Found => {
  const name = path.replace(/\/+$/, '').split('/').at(-1) ?? path
  return {
    id: `typed:${path}`,
    name,
    where: path,
    facts: 'main · no remote',
    git: 'ready',
    remote: null,
    reads: 'Read as it’s made',
    ink: FOUND[0]!.ink,
  }
}

export const usePick = (start: SetupWay = 'clone'): Pick => {
  const [way, onWay] = useState<SetupWay>(start)
  const [query, onQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [typed, setTyped] = useState<readonly Found[]>([])
  const [fresh, onFresh] = useState('')
  const pasted = pastedOf(query)
  const repo = REPOS.find((one) => one.id === chosen) ?? (pasted?.id === chosen ? pasted : undefined)
  const found = [...FOUND, ...typed].find((one) => one.id === folder)
  const repoId = repo?.id
  // The same choice is the same source, so what follows it runs once a choice.
  const source = useMemo((): Source | null => {
    if (way === 'clone') return repo === undefined ? null : { kind: 'clone', repo }
    if (way === 'folder') return found === undefined ? null : { kind: 'folder', folder: found }
    return fresh.trim() === '' ? null : { kind: 'new', name: fresh.trim() }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- by what was chosen, not the objects read for it
  }, [way, repoId, found?.id, fresh])
  return {
    way,
    onWay,
    query,
    onQuery,
    chosen,
    choose: (id) => setChosen((was) => (was === id ? null : id)),
    folder,
    chooseFolder: setFolder,
    typed,
    addPath: (path) => {
      const one = foundAt(path.trim())
      setTyped((was) => (was.some((kept) => kept.id === one.id) ? was : [...was, one]))
      setFolder(one.id)
    },
    fresh,
    onFresh,
    source,
  }
}

/** The kit's folder row for what was chosen: what the project is made of, on its left. */
export const folderOf = (source: Source | null): readonly NewProjectFolder[] => {
  if (source === null) return []
  if (source.kind === 'clone')
    return [
      {
        id: source.repo.id,
        name: source.repo.name,
        where: whereOf(source),
        host: { name: 'GitHub', brand: Brand.GitHub },
        remote: `${source.repo.owner}/${source.repo.name}`,
      },
    ]
  if (source.kind === 'folder')
    return [
      {
        id: source.folder.id,
        name: source.folder.name,
        where: source.folder.where,
        host: source.folder.remote === null ? null : { name: 'GitHub', brand: Brand.GitHub },
        remote: source.folder.remote,
      },
    ]
  return [{ id: 'fresh', fresh: true, name: slugOf(source.name), where: whereOf(source) }]
}

/** What the way chosen holds: your repositories to clone, the folders found on the home, or a new repository's name. */
export function SourceBody({ pick, height, autoFocus }: { pick: Pick; height: number; autoFocus?: boolean }) {
  const pasted = pastedOf(pick.query)
  if (pick.way === 'clone')
    return (
      <SetupRepositories
        hosts={HOSTS}
        repositories={REPOS}
        query={pick.query}
        onQuery={pick.onQuery}
        pasted={pasted}
        chosen={pick.chosen}
        onChoose={pick.choose}
        onConnect={() => undefined}
        landing={pick.source?.kind === 'clone' ? `${whereOf(pick.source)} ${on}` : null}
        height={height}
      />
    )
  if (pick.way === 'folder') return <FolderPick pick={pick} height={height} autoFocus={autoFocus} />
  return (
    <SetupZone>
      <label className={p.freshRow}>
        <span className={p.freshLabel}>Its name</span>
        <Field
          value={pick.fresh}
          onChange={(event) => pick.onFresh(event.target.value)}
          placeholder="northwind-ops"
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
        />
      </label>
      <p className={p.freshNote}>
        <Icon name="branch" size={12} />
        {pick.fresh.trim() === ''
          ? `A new repository in ${HOME.place} ${on}, on main, with a first commit.`
          : `${whereOf({ kind: 'new', name: pick.fresh })} ${on}, on main, with a first commit.`}
      </p>
    </SetupZone>
  )
}

/** The folders found on the home, one chosen; and one typed by its path there. */
function FolderPick({ pick, height, autoFocus }: { pick: Pick; height: number; autoFocus?: boolean | undefined }) {
  const [path, setPath] = useState('')
  const all = [...FOUND, ...pick.typed]
  return (
    <div className={p.folders} style={{ minHeight: height }}>
      <p className={p.foundTitle}>Found {on}</p>
      <SetupPicks label={`Folders ${on}`}>
        {all.map((one) => (
          <SetupPick
            key={one.id}
            checked={pick.folder === one.id}
            onChoose={() => pick.chooseFolder(one.id)}
            mark={<Icon name="folder" size={15} />}
            title={one.name}
            note={
              <span className={p.foundNote}>
                <span className={p.mono}>{one.where}</span>
                <span>{one.git === 'none' ? 'No git yet' : one.remote === null ? 'No remote' : one.remote}</span>
              </span>
            }
          />
        ))}
      </SetupPicks>
      <form
        className={p.pathRow}
        onSubmit={(event) => {
          event.preventDefault()
          if (path.trim() === '') return
          pick.addPath(path)
          setPath('')
        }}
      >
        <Field
          className={p.path}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={HOME.remote ? '/srv/apps/billing' : '~/Code/billing'}
          aria-label={`A folder ${on}, by its path`}
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        <Button size="small" type="submit" disabled={path.trim() === ''}>
          Add
        </Button>
      </form>
    </div>
  )
}

/** The kit's ways, in this home's words. */
export const waysText = {
  folder: 'A folder',
  folderNote: On,
  fresh: 'Start empty',
  freshNote: `A new repository ${on}`,
}

/** A home's job, followed. */
export const useJob = (handle: JobHandle | null): Job | null =>
  useSyncExternalStore(
    (listener) => handle?.subscribe(listener) ?? (() => undefined),
    () => handle?.get() ?? null,
  )

/** The home's job as Connect a home says its own: each step as it goes, the clone with how much has come. */
export function HomeSteps({ job, label }: { job: Job; label: string }) {
  return (
    <ol className={setUp.steps} aria-live="polite" aria-label={label}>
      {job.steps.map((step) => {
        const state = step.state === 'doing' ? 'now' : step.state === 'waiting' ? 'later' : step.state
        const cloning = step.key === 'code' && step.state === 'doing' && job.progress !== null
        return (
          <li key={step.key} data-state={state}>
            <span className={setUp.tick}>
              {state === 'done' ? (
                <Icon name="check" size={10} />
              ) : state === 'failed' ? (
                <Icon name="close" size={10} />
              ) : state === 'now' ? (
                <Spinner size="small" />
              ) : null}
            </span>
            <span className={setUp.stepWords}>
              <span className={setUp.stepLabel}>{step.label}</span>
              {cloning && job.progress !== null ? (
                <>
                  <span className={setUp.stepDetail}>
                    {job.progress.done} of {job.progress.total} MB · {step.detail}
                  </span>
                  <span className={setUp.bar}>
                    <span style={{ transform: `scaleX(${job.progress.done / job.progress.total})` }} />
                  </span>
                </>
              ) : (
                step.detail !== undefined && state !== 'later' && <span className={setUp.stepDetail}>{step.detail}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Calls `then` once the job is done, with its project. */
export const useDone = (job: Job | null, then: (projectId: string) => void) => {
  const done = job?.phase === 'done' ? job.project?.id : undefined
  useEffect(() => {
    if (done !== undefined) then(done)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, as it is done
  }, [done])
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className={p.lede}>{children}</p>
}

/** Reads the home's needs again as they change: its state, in a word each, so the same is the same. */
export const useNeeds = () => {
  useSyncExternalStore(world.subscribe, () =>
    world
      .needs()
      .map((one) => one.state)
      .join(),
  )
  return world.needs()
}

/**
 * What the home has of what work needs, a row each: your settings, there as
 * on every home; then each sign-in and tool, there with a tick, or a press
 * that does it from this Mac (a sign-in approved in its browser, as a device
 * code is). `only` keeps the rows that matter where it shows.
 */
export function HomeReady({
  label,
  only,
  yours = true,
  onSettings,
  compact = false,
}: {
  label: string
  /** Narrow, as over Settings' side: each note under its name. */
  compact?: boolean
  only?: readonly NeedKey[]
  /** Your settings' row, first. */
  yours?: boolean
  onSettings?: () => void
}) {
  const needs = useNeeds().filter((one) => only === undefined || only.includes(one.key))
  return (
    <ul className={p.ready} aria-label={label} data-compact={compact || undefined}>
      {yours && (
        <li data-state="there">
          <span className={p.readyMark}>
            <Icon name="gear" size={14} />
          </span>
          <span className={p.readyName}>Your settings</span>
          <span className={p.readyNote}>
            Models, {YOURS.presets} presets, {YOURS.skills} skills, {YOURS.servers} MCP servers, as on every home
          </span>
          {onSettings === undefined ? (
            <Icon name="check" size={12} className={p.readyTick} />
          ) : (
            <LinkButton className={p.readyLink} onClick={onSettings}>
              Settings
            </LinkButton>
          )}
        </li>
      )}
      {needs.map((one) => (
        <li key={one.key} data-state={one.state}>
          <span className={p.readyMark}>
            {one.brand === null ? <Icon name="plug" size={14} /> : <BrandMark brand={one.brand} size={14} />}
          </span>
          <span className={p.readyName}>{one.name}</span>
          <span className={p.readyNote} title={one.state === 'doing' ? one.doing : one.note}>
            {one.state === 'doing' ? one.doing : one.note}
          </span>
          <span className={p.readyEnd}>
            {one.state === 'there' ? (
              <Icon name="check" size={12} className={p.readyTick} />
            ) : one.state === 'doing' ? (
              <Spinner size="small" />
            ) : (
              <Button size="small" onClick={() => void world.fix(one.key)}>
                {one.fix}
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
