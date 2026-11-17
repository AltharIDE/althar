import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import {
  Button,
  Caret,
  CopyButton,
  Disclosure,
  DisclosureTrigger,
  Field,
  Fold,
  Icon,
  LiveDot,
  Problem,
  ProjectMark,
  type ProjectInk,
} from '@althar/ui'

import type { HomesHost, SshHomeTarget } from '../../../../src/homes'
import { projectsOn } from '../../data'
import { type LabHome, stateOf, useWorld, world } from '../../world'
import { homeProblem, isOpen, lastOpened, nameFrom, OptionFields, type Options, Refusal, useConnect, Working } from '../parts'
import p from '../parts.module.css'
import s from './shared.module.css'

/*
 * What the three Manage dialogs share: Forget, at once and with Undo (it only
 * drops the saved connection; a window open on the home carries on, as #982's
 * main has it); a rename, at once; a connection changed, checked first and
 * kept only where the host still has the same home; and the few words that
 * say where each home stands.
 */

/** How a home's connection stands: live while its window is connected, dropped, on its way, or resting (no window open). */
export type Liveness = 'live' | 'down' | 'connecting' | 'rest'
export const useLiveness = (home: { readonly id: string }): Liveness => {
  useWorld()
  if (home.id === 'local') return 'live'
  if (!isOpen(home.id)) return 'rest'
  const { connection } = stateOf(home.id)
  return connection === 'disconnected' ? 'down' : connection === 'connecting' ? 'connecting' : 'live'
}

/** The kit's live dot (cobalt) while a home's window is connected, ringing while it connects; a still red one where it dropped; nothing at rest. */
export function HomeDot({ state }: { state: Liveness }) {
  if (state === 'live') return <LiveDot />
  if (state === 'connecting') return <LiveDot ping />
  if (state === 'down') return <span className={s.down} aria-hidden="true" />
  return null
}

/**
 * The projects on a home, as their marks and names: alive while its window is
 * connected (a cobalt arc round a project where work runs, a violet dot where
 * something waits on you), quiet at rest, when what runs there isn't known.
 */
export function Projects({
  on,
  live,
  size = 15,
  max = 3,
  className,
}: {
  on: string
  live: boolean
  size?: number
  max?: number
  className?: string
}) {
  const projects = projectsOn(on)
  if (projects.length === 0) return <span className={s.none}>No projects yet</span>
  const first = projects.slice(0, max)
  return (
    <span className={`${s.projects} ${className ?? ''}`}>
      {first.map((project) => (
        <span key={project.id} className={s.project}>
          <ProjectMark
            seed={project.id}
            ink={project.ink as ProjectInk}
            size={size}
            running={live && project.running > 0}
            yours={live && project.ready > 0}
            quiet={!live}
          />
          {project.name}
        </span>
      ))}
      {projects.length > first.length && <span className={s.none}>{`and ${projects.length - first.length} more`}</span>}
    </span>
  )
}

/** A home's identity, short: enough to tell two apart at a glance; the whole of it is a copy away. */
export const shortId = (homeId: string) => {
  const hex = homeId.replace(/^home_/, '')
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`
}

/** The dialog itself takes focus as it opens, not its first field or card: opening Manage mustn't put a home's name under the keys. */
export const useQuietFocus = (inside: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const dialog = inside.current?.closest('[role=dialog]')
      if (dialog instanceof HTMLElement) dialog.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [inside])
}

/** What each Manage dialog is given: the window's homes, which window it is, and the ways out. */
export interface ManageProps {
  readonly homes: HomesHost
  readonly windowId: string
  readonly onClose: () => void
  readonly onConnect: () => void
}

/** The home's identity, as it was saved: the line `althar-host status` prints on the host. */
export function Identity({ homeId }: { homeId: string }) {
  return (
    <div className={p.identity}>
      <code className={p.homeId}>{homeId}</code>
      <CopyButton value={homeId} className={p.copy} />
    </div>
  )
}

/** Opening a home from Manage: its window, or the one already open, brought to the front. */
export const openFrom = (homes: HomesHost, id: string, onClose: () => void) => void homes.open(id).then(onClose)

export const optionsOf = (ssh: SshHomeTarget): Options => ({
  profile: ssh.profile ?? '',
  launcher: ssh.launcher ?? '',
  config: ssh.configFile ?? '',
  port: ssh.port === undefined ? '' : String(ssh.port),
})

/** Where a home stands, in a word or two: this window, its window open (and how its connection is), or when it was last opened. */
export const useStatus = (home: LabHome, windowId: string): { words: string; down: boolean } => {
  useWorld()
  if (!isOpen(home.id)) return { words: lastOpened(home), down: false }
  const { connection } = stateOf(home.id)
  if (connection === 'disconnected') return { words: 'Disconnected', down: true }
  if (connection === 'connecting') return { words: 'Connecting…', down: false }
  return { words: home.id === windowId ? 'This window' : 'Open', down: false }
}

/** Forget at once: the home goes as it's pressed, main catches up behind, and Undo puts it back where it was. */
export const useForget = (homes: HomesHost) => {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [last, setLast] = useState<{ home: LabHome; at: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const shown = (id: string) => {
    setHidden((was) => {
      const next = new Set(was)
      next.delete(id)
      return next
    })
  }
  const forget = (home: LabHome, at: number) => {
    setHidden((was) => new Set(was).add(home.id))
    setLast({ home, at })
    setProblem(null)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setLast(null), 8000)
    pending.current = homes.forget(home.id).catch((error: unknown) => {
      shown(home.id)
      setLast(null)
      setProblem(homeProblem(error))
    })
  }
  const undo = () => {
    if (last === null) return
    const { home, at } = last
    setLast(null)
    clearTimeout(timer.current)
    void pending.current.then(() => {
      world.restore(home, at)
      shown(home.id)
    })
  }
  return { hidden, last, problem, forget, undo }
}
export type Forgetting = ReturnType<typeof useForget>

/** The line Forget leaves: what went, with Undo; or why it couldn't. */
export function Forgotten({ forgetting, className }: { forgetting: Forgetting; className?: string }) {
  const { last, problem, undo } = forgetting
  if (problem !== null) return <Refusal problem={problem} />
  if (last === null) return null
  return (
    <div className={className ?? s.undo} role="status">
      <span className={s.undoWords}>Forgot {last.home.name}.</span>
      <Button size="small" variant="quiet" onClick={undo}>
        Undo
      </Button>
    </div>
  )
}

/** A name changed in place: kept as it's left (Enter, or moving away), put back with Escape. */
export function NameField({
  home,
  id,
  className,
  autoFocus,
  onDone,
}: {
  home: LabHome
  id?: string
  className?: string
  autoFocus?: boolean
  onDone?: () => void
}) {
  const [name, setName] = useState(home.name)
  const [was, setWas] = useState(home.name)
  if (home.name !== was) {
    setWas(home.name)
    setName(home.name)
  }
  const keep = () => {
    if (name.trim() === '') setName(home.name)
    else if (name.trim() !== home.name) world.rename(home.id, name)
    onDone?.()
  }
  return (
    <Field
      id={id}
      className={className}
      value={name}
      maxLength={120}
      aria-label="Name"
      autoFocus={autoFocus}
      onFocus={autoFocus ? (event) => event.currentTarget.select() : undefined}
      onChange={(event) => setName(event.currentTarget.value)}
      onBlur={keep}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setName(home.name)
          onDone?.()
        }
      }}
    />
  )
}

/**
 * A home's connection, changed: the host checked first, and kept only where
 * it still has the same home. A host with another home isn't this one any
 * more: it can be saved beside it instead.
 */
export const useEdit = (homes: HomesHost, home: LabHome, onSaved?: () => void) => {
  const form = useConnect(homes, undefined, { target: home.ssh.target, options: optionsOf(home.ssh) })
  const saved = optionsOf(home.ssh)
  const dirty =
    form.target.trim() !== home.ssh.target ||
    (Object.keys(saved) as Array<keyof Options>).some((key) => form.options[key].trim() !== saved[key])
  const [want, setWant] = useState(false)
  const [kept, setKept] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const other = form.phase === 'checked' && form.checked !== null && form.checked.homeId !== home.homeId ? form.checked : null
  useEffect(() => {
    if (!want || form.phase === 'checking') return
    setWant(false)
    if (form.phase !== 'checked' || form.checked === null || form.checked.homeId !== home.homeId) return
    try {
      world.change(home.id, form.checked.checkId)
      setKept(true)
      onSaved?.()
    } catch (error) {
      setProblem(homeProblem(error))
    }
  }, [want, form.phase, form.checked, home, onSaved])
  const edit = {
    setTarget: (value: string) => {
      setKept(false)
      setProblem(null)
      form.setTarget(value)
    },
    setOption: (key: keyof Options, value: string) => {
      setKept(false)
      setProblem(null)
      form.setOption(key, value)
    },
  }
  return {
    form: { ...form, ...edit },
    dirty,
    checking: form.phase === 'checking',
    kept,
    other,
    problem,
    save: () => {
      setWant(true)
      form.check()
    },
    saveNew: () => {
      if (other === null) return
      world.add(other.checkId, nameFrom(form.target))
      edit.setTarget(home.ssh.target)
      for (const key of Object.keys(saved) as Array<keyof Options>) form.setOption(key, saved[key])
    },
    reset: () => {
      edit.setTarget(home.ssh.target)
      for (const key of Object.keys(saved) as Array<keyof Options>) form.setOption(key, saved[key])
    },
  }
}
export type Editing = ReturnType<typeof useEdit>

/** The host and its options, as a saved home has them, with what checking them found. */
export function ConnectionFields({
  edit,
  home,
  optionsOpen,
  actions = true,
  results = true,
  label = true,
  autoFocus,
}: {
  edit: Editing
  home: LabHome
  optionsOpen?: boolean
  /** Its Cancel and Check and save, under it; or the dialog's own, in its foot. */
  actions?: boolean
  /** What the check found (another home, or the same one kept), here; or the dialog's own way of showing it. */
  results?: boolean
  /** Its "SSH host" over the field; or none, where what holds it names it. */
  label?: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  const { form } = edit
  const host = form.target.trim()
  const anyOption = Object.values(optionsOf(home.ssh)).some((value) => value !== '')
  return (
    <div className={s.connection}>
      <label className={s.field} htmlFor={`${id}-host`}>
        {label && <span>SSH host</span>}
        <Field
          id={`${id}-host`}
          aria-label={label ? undefined : 'SSH host'}
          autoFocus={autoFocus}
          value={form.target}
          invalid={form.phase === 'refused'}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => edit.form.setTarget(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && edit.dirty) {
              event.preventDefault()
              edit.save()
            }
          }}
        />
      </label>
      <Disclosure defaultOpen={optionsOpen ?? anyOption}>
        <DisclosureTrigger>
          <button type="button" className={s.more}>
            Connection options <Caret />
          </button>
        </DisclosureTrigger>
        <Fold bleed={false}>
          <OptionFields form={form} className={s.options} />
        </Fold>
      </Disclosure>
      {edit.checking && <Working>{`Checking ${host}…`}</Working>}
      {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
      {edit.problem !== null && <Refusal problem={edit.problem} />}
      {results && edit.other !== null && (
        <Problem
          size="small"
          action={
            <Button size="small" onClick={edit.saveNew}>
              Save as a new home
            </Button>
          }
        >
          {`${host} has a different home. ${home.name} stays on ${home.ssh.target}.`}
        </Problem>
      )}
      {results && edit.kept && !edit.dirty && (
        <span className={s.kept} role="status">
          <Icon name="check" size={13} />
          Same home as before
        </span>
      )}
      {actions && edit.dirty && !edit.checking && (
        <span className={s.editActions}>
          <Button size="small" variant="quiet" onClick={edit.reset}>
            Cancel
          </Button>
          {edit.other === null && (
            <Button size="small" variant="signal" onClick={edit.save}>
              Check and save
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
