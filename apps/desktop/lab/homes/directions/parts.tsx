import { Laptop, LinkSlash, Server } from 'iconoir-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Code, CopyButton, Field, Problem, Spinner } from '@althar/ui'

import type { CheckedHome, HomeState, HomesHost, SshHomeTarget } from '../../../src/homes'
import { homeProblem } from '../../../src/renderer/features/homes/useHomes'
import { homeOf, hostOf, type LabHome, openedAgo, shownHomes, stateOf, useWorld, world } from '../world'
import s from './parts.module.css'

/*
 * What every direction draws from: a home's glyph (a server; this computer
 * a laptop; a broken link while its connection is down), the homes as main
 * knows them, the connection form's work (a check, then connect), the line
 * that lets the person compare a home's identity with what its host says,
 * and what a connection over SSH can't do.
 */

/** Iconoir at the kit's weight: a hairline at small sizes otherwise. */
const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

export type GlyphKind = 'local' | 'home' | 'down'
export function Glyph({ kind, size = 14, className }: { kind: GlyphKind; size?: number; className?: string }) {
  const Drawing = kind === 'local' ? Laptop : kind === 'down' ? LinkSlash : Server
  return <Drawing width={size} height={size} strokeWidth={stroke(size)} className={className} aria-hidden="true" style={{ flex: 'none' }} />
}

/** The window's home: this computer, or a home and how its connection stands. */
export const useWindowHome = (windowId: string): HomeState => {
  useWorld()
  return stateOf(windowId)
}

/** The saved homes, as main keeps them, kept current. */
export const useHomes = (): ReadonlyArray<LabHome> => {
  useWorld()
  return shownHomes()
}

export const isOpen = (id: string) => world.isOpen(id)
export const lastOpened = (home: LabHome) => (home.opened === 0 ? 'Just now' : openedAgo(home.opened))
export { homeOf, hostOf, homeProblem }

/** A name to start from: the host, without its user. */
export const nameFrom = (target: string) => hostOf(target.trim()).replace(/\..*$/, '')

export type Phase = 'idle' | 'checking' | 'checked' | 'refused' | 'connecting'
export interface Options {
  readonly profile: string
  readonly launcher: string
  readonly config: string
  readonly port: string
}
const noOptions: Options = { profile: '', launcher: '', config: '', port: '' }

/**
 * The connection form's work, as #982's form does it: the host is checked
 * (read-only, cancelled by any edit), then connected under the name given,
 * which opens the home's window. The name starts as the host's, until it is
 * typed.
 */
export const useConnect = (
  homes: HomesHost,
  onDone?: () => void,
  start?: { target?: string; options?: Partial<Options>; checked?: boolean; refused?: boolean },
) => {
  const [target, setTargetNow] = useState(start?.target ?? '')
  const [options, setOptionsNow] = useState<Options>({ ...noOptions, ...start?.options })
  const [name, setNameNow] = useState('')
  const [named, setNamed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [checked, setChecked] = useState<CheckedHome | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const generation = useRef(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      void homes.cancelCheck().catch(() => undefined)
    }
  }, [homes])
  const edited = () => {
    generation.current++
    setChecked(null)
    setProblem(null)
    setPhase('idle')
    void homes.cancelCheck().catch(() => undefined)
  }
  const setTarget = (value: string) => {
    edited()
    setTargetNow(value)
    if (!named) setNameNow(nameFrom(value))
  }
  const setOption = (key: keyof Options, value: string) => {
    edited()
    setOptionsNow((was) => ({ ...was, [key]: value }))
  }
  const setName = (value: string) => {
    setNamed(true)
    setNameNow(value)
  }
  const check = useCallback(
    (over?: string) => {
      const host = (over ?? target).trim()
      if (host === '') return
      const at = ++generation.current
      setPhase('checking')
      setProblem(null)
      setChecked(null)
      if (!named) setNameNow(nameFrom(host))
      const input: SshHomeTarget = {
        target: host,
        ...(options.profile.trim() === '' ? {} : { profile: options.profile.trim() }),
        ...(options.launcher.trim() === '' ? {} : { launcher: options.launcher.trim() }),
        ...(options.config.trim() === '' ? {} : { configFile: options.config.trim() }),
        ...(options.port.trim() === '' ? {} : { port: Number(options.port) }),
      }
      void homes
        .inspect(input)
        .then((value) => {
          if (!live.current || generation.current !== at) return
          setChecked(value)
          setPhase('checked')
        })
        .catch((error: unknown) => {
          if (!live.current || generation.current !== at) return
          const said = homeProblem(error)
          if (said === 'The home check was cancelled.') return
          setProblem(said)
          setPhase('refused')
        })
    },
    [homes, named, options, target],
  )
  const connect = () => {
    if (checked === null || name.trim() === '') return
    setPhase('connecting')
    setProblem(null)
    void homes
      .connect(checked.checkId, name)
      .then(() => {
        if (live.current) onDone?.()
      })
      .catch((error: unknown) => {
        if (!live.current) return
        setProblem(homeProblem(error))
        setPhase('refused')
        setChecked(null)
      })
  }
  const cancel = () => {
    edited()
  }
  // A screenshot's form: already checked, or refused. Run on mount (again on StrictMode's second mount, whose first was cancelled).
  useEffect(() => {
    if (start?.target === undefined || (start.checked !== true && start.refused !== true)) return
    check(start.target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { target, setTarget, options, setOption, name, setName, phase, checked, problem, check, connect, cancel }
}
export type Connecting = ReturnType<typeof useConnect>

/** The connection options #982 offers, for a host that needs them. */
export function OptionFields({ form, className }: { form: Connecting; className?: string }) {
  const id = useId()
  const row = (key: keyof Options, label: string, hint: string) => (
    <label className={s.option} htmlFor={`${id}-${key}`}>
      <span>{label}</span>
      <Field
        id={`${id}-${key}`}
        value={form.options[key]}
        placeholder={hint}
        spellCheck={false}
        autoComplete="off"
        inputMode={key === 'port' ? 'numeric' : undefined}
        onChange={(event) => form.setOption(key, event.currentTarget.value)}
      />
    </label>
  )
  return (
    <div className={className ?? s.options}>
      {row('port', 'Port', '22')}
      {row('config', 'SSH config file', '~/.ssh/config')}
      {row('profile', 'Home’s profile on the host', 'Its default')}
      {row('launcher', 'althar-host on the host', 'althar-host')}
    </div>
  )
}

/**
 * The line that lets the person compare: what the host itself prints for
 * its home, which they can run there and read side by side.
 */
export function Compare({ checked, terminal = false }: { checked: CheckedHome; terminal?: boolean }) {
  if (terminal)
    return (
      <div className={s.terminal}>
        <div className={s.prompt}>
          <span aria-hidden="true">$ </span>althar-host status
        </div>
        <div>
          Home ready: <strong>{checked.homeId}</strong> (host {checked.version}, API {checked.apiVersion})
        </div>
      </div>
    )
  return (
    <div className={s.identity}>
      <code className={s.homeId}>{checked.homeId}</code>
      <CopyButton value={checked.homeId} className={s.copy} />
    </div>
  )
}

/** What a home's window can't do over SSH, in a few words each: said where it helps, never on every screen. */
export const LIMITS = [
  { key: 'permissions', short: 'Permissions', line: 'Permissions can’t be answered over SSH yet.' },
  { key: 'projects', short: 'New projects', line: 'New projects are added on the host.' },
  { key: 'files', short: 'Attachments', line: 'Files on this computer can’t be attached.' },
  { key: 'previews', short: 'Previews', line: 'Previews, pages and canvases open for this computer’s projects only.' },
  { key: 'dictation', short: 'Dictation', line: 'Dictation is for this computer’s windows.' },
  { key: 'notify', short: 'Notifications', line: 'Notifications and the Dock count this computer’s work only.' },
] as const

/** "Not over SSH: permissions, new projects, …", in one quiet line. */
export const limitsLine = () =>
  `Not over SSH yet: ${LIMITS.slice(0, 5)
    .map((one, i) => (i === 0 ? one.short : one.short.toLowerCase()))
    .join(', ')}.`

/** The host, as SSH is told it: the person's alias, or user@host. */
export function Target({ home, className }: { home: { readonly ssh: SshHomeTarget }; className?: string }) {
  return <span className={className ?? s.target}>{home.ssh.target}</span>
}

/** A refused check or connection, under the host it was about, with what fixes it. */
export function Refusal({ problem, onRetry }: { problem: string; onRetry?: () => void }) {
  return (
    <Problem
      size="small"
      {...(onRetry === undefined
        ? {}
        : {
            action: (
              <Button size="small" variant="quiet" onClick={onRetry}>
                Try again
              </Button>
            ),
          })}
    >
      {problem}
    </Problem>
  )
}

/** Work in motion, with what it is. */
export function Working({ children }: { children: string }) {
  return (
    <span className={s.working} role="status">
      <Spinner size="small" />
      {children}
    </span>
  )
}

export { Code }
