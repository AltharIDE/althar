import { type RefObject, useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  Icon,
  IconButton,
  LinkButton,
  ListMotion,
  LiveDot,
  Menu,
  MenuItem,
  MenuSeparator,
  Problem,
  ProjectMark,
  Spinner,
} from '@althar/ui'

import type { HomeProjects, HomeState, HomesHost, HomesOverview, RemoteHome } from '../../../homes'
import { kitInk } from '../../shared/inks'
import { ConnectionFields, useEdit } from './EditConnection'
import { Identity } from './ConnectHome'
import { type ExperimentalStore, useExperimental } from './Experimental'
import { homeProblem, homesUi, keyOf, type Liveness, livenessOf, openedAgo } from './useHomes'
import s from './ManageHomes.module.css'

/*
 * Manage homes, by their projects. A home is known by what's on it, so each
 * shows its projects as the app shows projects everywhere, by their marks:
 * a cobalt arc where work runs and a violet dot where something waits on
 * the person, while a window on it is connected; quiet otherwise, as a window
 * on it last read them. Pressing a project opens it on its home. This
 * computer is the first home. What changes a home (its name, its
 * connection, Forget) is in its ⋯ menu, and acts in place; Forget at once,
 * with Undo, which main holds for a little while.
 */

/** How long Undo stays after Forget. Main holds the home a while longer. */
const UNDO_FOR = 8_000

type Editing = { readonly id: string; readonly what: 'name' | 'connection' } | null

export interface ManageProps {
  readonly homes: HomesHost
  readonly overview: HomesOverview | null
  /** This window's home. */
  readonly here: HomeState | null
  readonly onClose: () => void
  readonly onConnect: () => void
  /** Where Homes being experimental is kept as said, once for every window. Without it, it isn't said. */
  readonly said?: ExperimentalStore | undefined
}

/**
 * The dialog itself takes focus as it opens, not its first project: opening Manage mustn't put a project under Enter. Only
 * where the person hasn't pressed or pointed at anything yet: a menu opened in that moment keeps its focus.
 */
const useQuietFocus = (inside: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    let touched = false
    const touch = () => {
      touched = true
    }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    const frame = requestAnimationFrame(() => {
      const dialog = inside.current?.closest('[role=dialog]')
      if (!touched && dialog instanceof HTMLElement && dialog.contains(document.activeElement)) dialog.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('keydown', touch, true)
    }
  }, [inside])
}

/**
 * The saved homes as the person sees them: a rename and a Forget show at
 * once, and main catches up behind; Undo puts a forgotten home back where
 * it was, at once too.
 */
const useSaved = (homes: HomesHost, overview: HomesOverview | null) => {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [back, setBack] = useState<ReadonlyArray<{ home: RemoteHome; at: number }>>([])
  const [last, setLast] = useState<{ home: RemoteHome; at: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const listed = overview?.homes ?? []
  // What main says now settles what was shown ahead of it.
  const settledNames = [...names].filter(([id, name]) => listed.find((home) => home.id === id)?.name !== name)
  if (settledNames.length !== names.size) setNames(new Map(settledNames))
  const settledBack = back.filter(({ home }) => !listed.some((one) => one.id === home.id))
  if (settledBack.length !== back.length) setBack(settledBack)
  const shown = listed
    .filter((home) => !hidden.has(home.id))
    .map((home) => {
      const name = names.get(home.id)
      return name === undefined ? home : { ...home, name }
    })
  for (const { home, at } of settledBack) shown.splice(Math.min(at, shown.length), 0, home)
  const unhide = (id: string) =>
    setHidden((was) => {
      const next = new Set(was)
      next.delete(id)
      return next
    })
  return {
    shown,
    last,
    problem,
    settled: () => pending.current,
    rename: (home: RemoteHome, name: string) => {
      const trimmed = name.trim()
      if (trimmed === '' || trimmed === home.name) return
      setNames((was) => new Map(was).set(home.id, trimmed))
      setProblem(null)
      void homes.rename(home.id, trimmed).catch((error: unknown) => {
        if (!live.current) return
        setNames((was) => {
          const next = new Map(was)
          next.delete(home.id)
          return next
        })
        setProblem(homeProblem(error))
      })
    },
    forget: (home: RemoteHome) => {
      const at = listed.findIndex((one) => one.id === home.id)
      setHidden((was) => new Set(was).add(home.id))
      setLast({ home, at })
      setProblem(null)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setLast(null), UNDO_FOR)
      pending.current = pending.current
        .then(() => homes.forget(home.id))
        .catch((error: unknown) => {
          if (!live.current) return
          unhide(home.id)
          setLast(null)
          setProblem(homeProblem(error))
        })
    },
    undo: () => {
      if (last === null) return
      const { home, at } = last
      setLast(null)
      clearTimeout(timer.current)
      unhide(home.id)
      setBack((was) => [...was, { home, at }])
      pending.current = pending.current
        .then(() => homes.restore(home.id))
        .catch((error: unknown) => {
          if (!live.current) return
          setBack((was) => was.filter((one) => one.home.id !== home.id))
          setProblem(homeProblem(error))
        })
    },
  }
}

export function ManageHomes({ homes, overview, here, onClose, onConnect, said }: ManageProps) {
  const saved = useSaved(homes, overview)
  const [editing, setEditing] = useState<Editing>(null)
  const list = useRef<HTMLUListElement>(null)
  useQuietFocus(list)
  const ownKey = here !== null && here.current.kind !== 'local' ? here.current.home.homeId : 'local'
  const experimental = useExperimental(said, s.experimental)
  const open = (id: string, projectId?: string) => {
    onClose()
    void saved
      .settled()
      .then(() => homes.open(id, projectId))
      .catch(() => undefined)
  }
  /** Its window, on New project. */
  const openNew = (id: string) => {
    onClose()
    void saved
      .settled()
      .then(() => homes.openNew(id))
      .catch(() => undefined)
  }
  return (
    <Dialog
      title="Homes"
      width={600}
      tall
      onClose={onClose}
      onEscapeKeyDown={(event) => {
        if (editing === null) return
        event.preventDefault()
        setEditing(null)
      }}
      actions={<Button onClick={onClose}>Done</Button>}
    >
      {experimental}
      <ListMotion within={list} enter="grow">
        <ul className={s.homes} ref={list}>
          <li data-move="local" className={s.home}>
            <div className={s.head}>
              <span className={s.glyph}>
                <Icon name="computer" size={15} />
              </span>
              <span className={s.words}>
                <span className={s.name}>This computer</span>
              </span>
              {ownKey === 'local' && (
                <span className={s.status}>
                  <LiveDot />
                  This window
                </span>
              )}
            </div>
            <Shelf
              projects={overview?.projects.local}
              local
              onOpen={(projectId) => open('local', projectId)}
              onWelcome={() => open('local')}
              onNew={() => openNew('local')}
            />
          </li>
          {saved.shown.map((home) => (
            <Home
              key={home.id}
              home={home}
              homes={homes}
              here={here}
              overview={overview}
              editing={editing?.id === home.id ? editing.what : null}
              onEdit={(what) => setEditing(what === null ? null : { id: home.id, what })}
              onRename={(name) => saved.rename(home, name)}
              onOpen={(projectId) => open(home.id, projectId)}
              onNew={() => openNew(home.id)}
              onForget={() => {
                setEditing(null)
                saved.forget(home)
              }}
            />
          ))}
          <li data-move="add" className={s.home}>
            <button type="button" className={s.add} onClick={onConnect}>
              <span className={s.glyph}>
                <Icon name="plus" size={15} />
              </span>
              Connect a home
            </button>
          </li>
        </ul>
      </ListMotion>
      {saved.problem !== null && <Problem size="small">{saved.problem}</Problem>}
      {saved.last !== null && (
        <output className={s.undo}>
          <span className={s.undoWords}>Forgot {saved.last.home.name}.</span>
          <Button size="small" variant="quiet" onClick={saved.undo}>
            Undo
          </Button>
        </output>
      )}
    </Dialog>
  )
}

/** Setting up a security key for a home: in its menu, and the line under it while the browser has it. */
export const keyText = {
  setUp: 'Set up a security key…',
  opening: 'Opening your browser…',
  opened: 'Finish setting up the key in your browser.',
  again: 'Try again',
}

/** Where a home stands, in a word or two: this window, its window and how it is connected, or when it was last opened. */
const statusOf = (home: RemoteHome, live: Liveness, here: HomeState | null, overview: HomesOverview | null) => {
  if (live === 'down') return 'Disconnected'
  if (live === 'connecting') return 'Connecting…'
  if (live === 'live')
    return here !== null && here.current.kind !== 'local' && here.current.home.homeId === home.homeId ? 'This window' : 'Open'
  return openedAgo(overview?.opened[home.id])
}

function Home({
  home,
  homes,
  here,
  overview,
  editing,
  onEdit,
  onRename,
  onOpen,
  onNew,
  onForget,
}: {
  home: RemoteHome
  homes: HomesHost
  here: HomeState | null
  overview: HomesOverview | null
  editing: 'name' | 'connection' | null
  onEdit: (what: 'name' | 'connection' | null) => void
  onRename: (name: string) => void
  onOpen: (projectId?: string) => void
  /** Its window, on New project. */
  onNew: () => void
  onForget: () => void
}) {
  const live = livenessOf(overview, home)
  const own = here !== null && here.current.kind !== 'local' && here.current.home.homeId === home.homeId
  const enrollKey = own && home.https !== undefined && live === 'live' ? homes.enrollApprovalKey : undefined
  const [copied, setCopied] = useState(false)
  // A security key for this home's permission answers (ADR-089): set up in the browser, from a page the home serves.
  const [keySetup, setKeySetup] = useState<{ state: 'opening' | 'opened' | 'failed'; message: string } | null>(null)
  const setUpKey =
    enrollKey === undefined
      ? undefined
      : () => {
          setKeySetup({ state: 'opening', message: keyText.opening })
          void enrollKey().then(
            () => setKeySetup({ state: 'opened', message: keyText.opened }),
            (error: unknown) => setKeySetup({ state: 'failed', message: homeProblem(error) }),
          )
        }
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <li data-move={home.id} className={s.home} data-editing={editing ?? undefined}>
      <div className={s.head}>
        <span className={s.glyph} data-down={live === 'down' || undefined}>
          <Icon name={live === 'down' ? 'unlinked' : 'home'} size={15} />
        </span>
        <span className={s.words}>
          {editing === 'name' ? (
            <NameField name={home.name} onDone={(name) => (name === null ? onEdit(null) : (onRename(name), onEdit(null)))} />
          ) : (
            <span className={s.name} title={home.name}>
              {home.name}
            </span>
          )}
          <span className={s.host} title={home.ssh?.target ?? home.https?.origin ?? ''} role={copied ? 'status' : undefined}>
            {copied ? 'Identity copied' : (home.ssh?.target ?? home.https?.origin ?? '')}
          </span>
        </span>
        <span className={s.status} data-down={live === 'down' || undefined}>
          {live === 'live' && <LiveDot />}
          {live === 'connecting' && <LiveDot ping />}
          {live === 'down' && <span className={s.dropped} aria-hidden="true" />}
          {statusOf(home, live, here, overview)}
        </span>
        <Menu
          label={home.name}
          align="end"
          trigger={<IconButton icon="more" label={`${home.name}, more`} size="small" className={s.more} />}
        >
          {!own && (
            <MenuItem icon="external" onSelect={() => onOpen()}>
              Open
            </MenuItem>
          )}
          <MenuItem icon="pencil" onSelect={() => onEdit('name')}>
            Rename
          </MenuItem>
          <MenuItem icon="plug" onSelect={() => onEdit('connection')}>
            Edit connection
          </MenuItem>
          {setUpKey !== undefined && (
            <MenuItem icon="lock" disabled={keySetup?.state === 'opening'} onSelect={setUpKey}>
              {keyText.setUp}
            </MenuItem>
          )}
          <MenuItem
            icon="copy"
            onSelect={() => {
              setCopied(true)
              void navigator.clipboard?.writeText(home.homeId).catch(() => setCopied(false))
            }}
          >
            Copy identity
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="remove" tone="danger" onSelect={onForget}>
            Forget
          </MenuItem>
        </Menu>
      </div>
      {keySetup?.state === 'failed' ? (
        <Problem
          size="small"
          className={s.keyProblem}
          {...(setUpKey === undefined
            ? {}
            : {
                action: (
                  <LinkButton onClick={setUpKey} className={s.keyAction}>
                    {keyText.again}
                  </LinkButton>
                ),
              })}
        >
          {keySetup.message}
        </Problem>
      ) : (
        keySetup !== null && (
          <output className={s.keyLine}>
            {keySetup.state === 'opening' ? <Spinner size="small" /> : <Icon name="external" size={12} className={s.keyMark} />}
            <span>{keySetup.message}</span>
          </output>
        )
      )}
      {editing === 'connection' ? (
        <Connection home={home} homes={homes} onDone={() => onEdit(null)} />
      ) : (
        <Shelf projects={overview?.projects[keyOf(home)]} live={live === 'live'} onOpen={onOpen} onWelcome={() => onOpen()} onNew={onNew} />
      )}
    </li>
  )
}

/** A name changed in place: kept as it's left (Enter, or moving away), put back with Escape. */
function NameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (kept: string | null) => {
    if (done.current) return
    done.current = true
    onDone(kept === null || kept.trim() === '' ? null : kept)
  }
  return (
    <input
      className={s.nameField}
      value={value}
      maxLength={120}
      aria-label="Name"
      data-own-escape
      spellCheck={false}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename was pressed to type the name; the field takes the keys.
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}

/** What a project is doing, in a few words; known only while a window on its home is connected. */
const doing = (working: number, yours: number) => {
  if (yours > 0) return working > 0 ? `${working} running, needs you` : 'Needs you'
  return working > 0 ? `${working} running` : 'Nothing running'
}

/**
 * The projects on a home, each a press from being opened there, and New
 * project after them, opening its window on it; with none, a press opens its
 * window on its welcome, to make one.
 */
function Shelf({
  projects,
  live = projects?.live === true,
  local = false,
  onOpen,
  onWelcome,
  onNew,
}: {
  projects: HomeProjects | undefined
  live?: boolean
  local?: boolean
  onOpen: (projectId: string) => void
  onWelcome: () => void
  onNew: () => void
}) {
  if (projects === undefined)
    return <p className={s.empty}>{local ? 'Its projects show here once a window on it opens.' : 'Open it to see its projects here.'}</p>
  if (projects.list.length === 0)
    return (
      <p className={s.empty}>
        No projects yet. <LinkButton onClick={onWelcome}>New project</LinkButton>
      </p>
    )
  const alive = live && projects.live
  return (
    <ul className={s.shelf} data-rest={!alive || undefined}>
      {projects.list.map((project) => (
        <li key={project.id}>
          <button type="button" className={s.project} title={project.name} onClick={() => onOpen(project.id)}>
            <ProjectMark
              seed={project.id}
              ink={kitInk(project.ink as Parameters<typeof kitInk>[0])}
              size={28}
              running={alive && project.working > 0}
              yours={alive && project.yours > 0}
              quiet={!alive}
              className={s.mark}
            />
            <span className={s.projectName}>{project.name}</span>
            {alive && <span className={s.doing}>{doing(project.working, project.yours)}</span>}
          </button>
        </li>
      ))}
      <li>
        <button type="button" className={`${s.project} ${s.adding}`} onClick={onNew}>
          <span className={s.addMark} aria-hidden="true">
            <Icon name="plus" size={14} />
          </span>
          <span className={s.projectName}>New project</span>
        </button>
      </li>
    </ul>
  )
}

/** A home's connection, changed in place of its projects: checked before it's kept, with its identity beneath. */
function Connection({ home, homes, onDone }: { home: RemoteHome; homes: HomesHost; onDone: () => void }) {
  if (home.ssh === undefined)
    return (
      <div className={s.edit}>
        <p>To change this secure connection, pair a new connection with a code from the host.</p>
        <Identity homeId={home.homeId} />
        <div className={s.done}>
          <Button size="small" variant="quiet" onClick={onDone}>
            Close
          </Button>
          <Button size="small" onClick={() => homesUi.set({ dialog: 'connect' })}>
            Pair a new connection…
          </Button>
        </div>
      </div>
    )
  return <SshConnection home={home} homes={homes} onDone={onDone} />
}

function SshConnection({ home, homes, onDone }: { home: import('../../../homes').SshRemoteHome; homes: HomesHost; onDone: () => void }) {
  const edit = useEdit(homes, home)
  return (
    <div className={s.edit}>
      <ConnectionFields edit={edit} home={home} />
      {!edit.dirty && !edit.checking && (
        <span className={s.done}>
          <Button size="small" variant="quiet" onClick={onDone}>
            Close
          </Button>
        </span>
      )}
    </div>
  )
}
