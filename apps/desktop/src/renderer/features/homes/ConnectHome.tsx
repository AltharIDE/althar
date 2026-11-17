import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Caret, Code, CopyButton, Dialog, Disclosure, DisclosureTrigger, Field, Fold, Problem, Spinner } from '@althar/ui'

import type { CheckedHome, HomesHost, SshHomeTarget } from '../../../homes'
import { homeProblem, nameFrom } from './useHomes'
import s from './Homes.module.css'

/*
 * Connecting a home: the host, checked first (read-only, and cancelled by any
 * edit), then the home's identity with the line that compares it on the
 * host, then its name, which starts as the host's until it is typed.
 * Connecting saves it and opens its window.
 */

export type Phase = 'idle' | 'checking' | 'checked' | 'refused' | 'connecting'
export interface Options {
  readonly profile: string
  readonly launcher: string
  readonly config: string
  readonly port: string
}
export const NO_OPTIONS: Options = { profile: '', launcher: '', config: '', port: '' }
export const optionsOf = (ssh: SshHomeTarget): Options => ({
  profile: ssh.profile ?? '',
  launcher: ssh.launcher ?? '',
  config: ssh.configFile ?? '',
  port: ssh.port === undefined ? '' : String(ssh.port),
})
export const targetOf = (host: string, options: Options): SshHomeTarget => ({
  target: host.trim(),
  ...(options.profile.trim() === '' ? {} : { profile: options.profile.trim() }),
  ...(options.launcher.trim() === '' ? {} : { launcher: options.launcher.trim() }),
  ...(options.config.trim() === '' ? {} : { configFile: options.config.trim() }),
  ...(options.port.trim() === '' ? {} : { port: Number(options.port.trim()) }),
})

/** A check main cancelled because a newer one replaced it: no problem to show. */
const cancelled = (said: string) => said === 'The home check was cancelled.'

/** The connection form's work: the host and its options, a check, and connecting under a name. */
export const useConnect = (homes: HomesHost, onDone?: () => void, start?: { target?: string; options?: Options }) => {
  const [target, setTargetNow] = useState(start?.target ?? '')
  const [options, setOptionsNow] = useState<Options>(start?.options ?? NO_OPTIONS)
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
  /** Checks the host; `then` hears what it found, if the form is still as it was checked. */
  const check = useCallback(
    (then?: (checked: CheckedHome) => void) => {
      const host = target.trim()
      if (host === '') return
      const at = ++generation.current
      setPhase('checking')
      setProblem(null)
      setChecked(null)
      if (!named) setNameNow(nameFrom(host))
      void homes
        .inspect(targetOf(host, options))
        .then((value) => {
          if (!live.current || generation.current !== at) return
          setChecked(value)
          setPhase('checked')
          then?.(value)
        })
        .catch((error: unknown) => {
          if (!live.current || generation.current !== at) return
          const said = homeProblem(error)
          if (cancelled(said)) return setPhase('idle')
          setProblem(said)
          setPhase('refused')
        })
    },
    [homes, named, options, target],
  )
  return {
    target,
    options,
    name,
    phase,
    checked,
    problem,
    check,
    setTarget: (value: string) => {
      edited()
      setTargetNow(value)
      if (!named) setNameNow(nameFrom(value))
    },
    setOption: (key: keyof Options, value: string) => {
      edited()
      setOptionsNow((was) => ({ ...was, [key]: value }))
    },
    setName: (value: string) => {
      setNamed(true)
      setNameNow(value)
    },
    /** Back to the settings given, as they were. */
    reset: (host: string, given: Options) => {
      edited()
      setTargetNow(host)
      setOptionsNow(given)
    },
    connect: () => {
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
    },
  }
}
export type Connecting = ReturnType<typeof useConnect>

/** The connection options, for a host that needs them. */
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
        maxLength={key === 'port' ? 5 : 4096}
        inputMode={key === 'port' ? 'numeric' : undefined}
        onChange={(event) => form.setOption(key, event.currentTarget.value)}
      />
    </label>
  )
  return (
    <div className={className ?? s.options}>
      {row('port', 'Port', '22')}
      {row('config', 'SSH config file', 'SSH’s own')}
      {row('profile', 'Home’s profile on the host', 'Its default')}
      {row('launcher', 'althar-host on the host', 'althar-host')}
    </div>
  )
}

/** A home's identity, whole, with Copy: what `althar-host status` prints on its host. */
export function Identity({ homeId }: { homeId: string }) {
  return (
    <div className={s.identity}>
      <code className={s.homeId}>{homeId}</code>
      <CopyButton value={homeId} className={s.copy} />
    </div>
  )
}

/** A refused check or connection, under what it was about. */
export function Refusal({ problem }: { problem: string }) {
  return <Problem size="small">{problem}</Problem>
}

/** Work under way, with what it is. */
export function Working({ children }: { children: string }) {
  return (
    <output className={s.working}>
      <Spinner size="small" />
      {children}
    </output>
  )
}

export function ConnectHome({ homes, onClose }: { homes: HomesHost; onClose: () => void }) {
  const id = useId()
  const form = useConnect(homes, onClose)
  const checked = form.checked !== null && (form.phase === 'checked' || form.phase === 'connecting')
  const busy = form.phase === 'checking' || form.phase === 'connecting'
  return (
    <Dialog
      title="Connect a home"
      width={480}
      holding={busy}
      onClose={onClose}
      onSubmit={() => (checked ? form.connect() : form.check())}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {checked ? (
            <Button type="submit" variant="signal" busy={form.phase === 'connecting'} disabled={form.name.trim() === ''}>
              {form.phase === 'connecting' ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <Button type="submit" busy={form.phase === 'checking'} disabled={form.target.trim() === '' || form.phase === 'checking'}>
              {form.phase === 'checking' ? 'Checking…' : 'Check host'}
            </Button>
          )}
        </>
      }
    >
      <div className={s.form}>
        <div className={s.field}>
          <label className={s.field} htmlFor={`${id}-host`}>
            <span>SSH host</span>
            <Field
              id={`${id}-host`}
              value={form.target}
              invalid={form.phase === 'refused'}
              placeholder="user@host, or a Host from your SSH config"
              spellCheck={false}
              autoComplete="off"
              maxLength={4096}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is opened to type a host; its first field takes the keys.
              autoFocus
              onChange={(event) => form.setTarget(event.currentTarget.value)}
            />
          </label>
          {form.phase === 'refused' && form.problem !== null && <Refusal problem={form.problem} />}
        </div>
        {!checked && (
          <Disclosure>
            <DisclosureTrigger>
              <button type="button" className={s.more}>
                Connection options <Caret />
              </button>
            </DisclosureTrigger>
            <Fold bleed={false}>
              <OptionFields form={form} />
            </Fold>
          </Disclosure>
        )}
        {checked && form.checked !== null && (
          <section className={s.check} aria-label="The home on this host">
            <span className={s.label}>Home on {form.checked.target}</span>
            <Identity homeId={form.checked.homeId} />
            <p className={s.note}>
              On the host, <Code>althar-host status</Code> prints the same home. Connect only if it does.
            </p>
          </section>
        )}
        {checked && (
          <label className={s.field} htmlFor={`${id}-name`}>
            <span>Name</span>
            <Field id={`${id}-name`} value={form.name} maxLength={120} onChange={(event) => form.setName(event.currentTarget.value)} />
          </label>
        )}
      </div>
    </Dialog>
  )
}
