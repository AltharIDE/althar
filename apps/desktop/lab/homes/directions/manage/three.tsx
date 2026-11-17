import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Icon, IconButton, ListMotion, Menu, MenuItem, MenuSeparator, ProjectMark, type ProjectInk } from '@althar/ui'

import type { HomesHost } from '../../../../src/homes'
import { projectsOn } from '../../data'
import { opening } from '../../state'
import type { LabHome } from '../../world'
import { Glyph, useHomes } from '../parts'
import s from './three.module.css'
import {
  ConnectionFields,
  Forgotten,
  HomeDot,
  Identity,
  type Liveness,
  type ManageProps,
  NameField,
  openFrom,
  useEdit,
  useForget,
  useLiveness,
  useQuietFocus,
  useStatus,
} from './shared'

/*
 * Manage 3 · By their projects. A home is known by what's on it, so each
 * shows its projects as the app shows projects everywhere: by their marks,
 * a cobalt arc round one where work runs and a violet dot where something
 * waits on you, while its window is connected; quiet while it rests, when
 * what runs there isn't known. Pressing a project opens it on its home.
 * This computer is one of the homes, first. What changes a home (rename,
 * its connection, its identity, Forget) is in its ⋯ menu, shown as it's
 * pointed at, and acts in place.
 */

type Editing = { readonly id: string; readonly what: 'name' | 'connection' } | null

export function ProjectsManage({ homes, windowId, onClose, onConnect }: ManageProps) {
  const saved = useHomes()
  const forgetting = useForget(homes)
  const shown = saved.filter((home) => !forgetting.hidden.has(home.id))
  const [editing, setEditing] = useState<Editing>(opening.pick === null ? null : { id: opening.pick, what: 'connection' })
  const list = useRef<HTMLUListElement>(null)
  useQuietFocus(list)
  return (
    <Dialog title="Homes" width={600} tall onClose={onClose} actions={<Button onClick={onClose}>Done</Button>}>
      <ListMotion within={list} enter="grow">
        <ul className={s.homes} ref={list}>
          <li data-move="local" className={s.home}>
            <div className={s.head}>
              <span className={s.glyph}>
                <Glyph kind="local" size={15} />
              </span>
              <span className={s.words}>
                <span className={s.name}>This computer</span>
              </span>
              {windowId === 'local' && (
                <span className={s.status}>
                  <HomeDot state="live" />
                  This window
                </span>
              )}
            </div>
            <Shelf on="local" live="live" onOpen={() => openFrom(homes, 'local', onClose)} />
          </li>
          {shown.map((home) => (
            <Home
              key={home.id}
              home={home}
              homes={homes}
              windowId={windowId}
              editing={editing?.id === home.id ? editing.what : null}
              onEdit={(what) => setEditing(what === null ? null : { id: home.id, what })}
              onClose={onClose}
              onForget={() => {
                setEditing(null)
                forgetting.forget(home, saved.indexOf(home))
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
      <Forgotten forgetting={forgetting} className={s.undo} />
    </Dialog>
  )
}

function Home({
  home,
  homes,
  windowId,
  editing,
  onEdit,
  onClose,
  onForget,
}: {
  home: LabHome
  homes: HomesHost
  windowId: string
  editing: 'name' | 'connection' | null
  onEdit: (what: 'name' | 'connection' | null) => void
  onClose: () => void
  onForget: () => void
}) {
  const live = useLiveness(home)
  const status = useStatus(home, windowId)
  const here = home.id === windowId
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <li data-move={home.id} className={s.home} data-editing={editing ?? undefined}>
      <div className={s.head}>
        <span className={s.glyph} data-down={live === 'down' || undefined}>
          <Glyph kind={live === 'down' ? 'down' : 'home'} size={15} />
        </span>
        <span className={s.words}>
          {editing === 'name' ? (
            <NameField key={home.id} home={home} className={s.nameField} autoFocus onDone={() => onEdit(null)} />
          ) : (
            <span className={s.name}>{home.name}</span>
          )}
          <span className={s.host} role={copied ? 'status' : undefined}>
            {copied ? 'Identity copied' : home.ssh.target}
          </span>
        </span>
        <span className={s.status} data-down={status.down || undefined}>
          <HomeDot state={live} />
          {status.words}
        </span>
        <Menu
          label={home.name}
          align="end"
          trigger={<IconButton icon="more" label={`${home.name}, more`} size="small" className={s.more} />}
        >
          {!here && (
            <MenuItem icon="external" onSelect={() => openFrom(homes, home.id, onClose)}>
              Open
            </MenuItem>
          )}
          <MenuItem icon="pencil" onSelect={() => onEdit('name')}>
            Rename
          </MenuItem>
          <MenuItem icon="plug" onSelect={() => onEdit('connection')}>
            Edit connection
          </MenuItem>
          <MenuItem
            icon="copy"
            onSelect={() => {
              void navigator.clipboard?.writeText(home.homeId)
              setCopied(true)
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
      {editing === 'connection' ? (
        <Connection home={home} homes={homes} onDone={() => onEdit(null)} />
      ) : (
        <Shelf on={home.id} live={live} onOpen={() => openFrom(homes, home.id, onClose)} />
      )}
    </li>
  )
}

/** What a project is doing, in a few words; known only while its home's window is connected. */
const doing = (running: number, ready: number) => {
  const parts = [running > 0 ? `${running} running` : null, ready > 0 ? `${ready} ready` : null].filter(Boolean)
  return parts.length === 0 ? 'Nothing running' : parts.join(', ')
}

/** The projects on a home, each a press away from being opened there. */
function Shelf({ on, live, onOpen }: { on: string; live: Liveness; onOpen: () => void }) {
  const projects = projectsOn(on)
  const alive = live === 'live'
  if (projects.length === 0) return <p className={s.empty}>Add a project on the host and it shows here.</p>
  return (
    <ul className={s.shelf} data-rest={!alive || undefined}>
      {projects.map((project) => (
        <li key={project.id}>
          <button type="button" className={s.project} onClick={onOpen}>
            <ProjectMark
              seed={project.id}
              ink={project.ink as ProjectInk}
              size={28}
              running={alive && project.running > 0}
              yours={alive && project.ready > 0}
              quiet={!alive}
              className={s.mark}
            />
            <span className={s.projectName}>{project.name}</span>
            {alive && <span className={s.doing}>{doing(project.running, project.ready)}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A home's connection, changed in place of its projects: checked before it's kept, with its identity beneath. */
function Connection({ home, homes, onDone }: { home: LabHome; homes: HomesHost; onDone: () => void }) {
  const edit = useEdit(homes, home)
  return (
    <div className={s.edit}>
      <ConnectionFields edit={edit} home={home} autoFocus />
      <div className={s.identity}>
        <span className={s.label}>Identity</span>
        <Identity homeId={home.homeId} />
      </div>
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
