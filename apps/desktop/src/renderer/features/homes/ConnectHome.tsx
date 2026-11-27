import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, Code, CopyButton, Dialog, Field, Problem, Spinner } from '@althar/ui'

import type { CheckedHome, HomesHost, SshHomeTarget } from '../../../homes'
import { device } from '../../shared/device'
import { Board, CodeField, HostField, LaterProblem, MethodSwitch, NameField, Options, Routes, type Route, type View } from './Drawing'
import { type ExperimentalStore, useExperimental } from './Experimental'
import { InstallDone, installActions, InstallSteps, useSetup } from './SetUp'
import { useFlow } from './useFlow'
import { homeProblem, nameFrom } from './useHomes'
import s from './Homes.module.css'
import c from './Connect.module.css'

/*
 * Connecting a home, drawn: this computer and the home joined by a line drawn as the connection stands, the home's
 * card filling in as it's typed and found. Over SSH, the host is checked first (read-only, and cancelled by any
 * edit), then its identity shows with the line that compares it on the host, then its name, which starts as the
 * host's until it is typed; or a pairing code reads where it leads. Connecting saves it and opens its window.
 *
 * A first home opens on what a home is, then how to set one up: over SSH, where Althar installs althar-host as a run
 * of steps (SetUp.tsx), or with a pairing code from a server set up by hand.
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
      // An edit or a switch away abandons it: what it comes to then is no longer this form's.
      const at = generation.current
      setPhase('connecting')
      setProblem(null)
      void homes
        .connect(checked.checkId, name)
        .then(() => {
          if (live.current && generation.current === at) onDone?.()
        })
        .catch((error: unknown) => {
          if (!live.current || generation.current !== at) return
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
export function Refusal({ problem, id }: { problem: string; id?: string }) {
  return (
    <Problem size="small" id={id}>
      {problem}
    </Problem>
  )
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

/**
 * One page of the dialog becoming another as a morph: the dialog takes its new height, the drawing and its cards move
 * with it, and what's under the drawing crosses over (Connect.module.css names each). At once where motion is reduced.
 */
const morph = (change: () => void) => {
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  document.startViewTransition(() => flushSync(change))
}

export function ConnectHome({
  homes,
  first = false,
  onClose,
  onHide = onClose,
  said,
}: {
  homes: HomesHost
  /** Where Homes being experimental is kept as said, once for every window. Without it, it isn't said. */
  said?: ExperimentalStore | undefined
  /** The person's first home: it opens on what a home is. */
  first?: boolean
  onClose: () => void
  /** Closed while a home is being set up: the setup goes on, on the window's homes chip. */
  onHide?: () => void
}) {
  const finished = useRef(() => {})
  const experimental = useExperimental(said, c.experimental)
  const flow = useFlow(homes, () => finished.current())
  const install = useSetup(homes, flow)
  useEffect(() => {
    finished.current = () => {
      if (install.setup !== null) install.dismiss()
      onClose()
    }
  })
  const [view, setView] = useState<View>(first ? 'intro' : 'form')
  const [route, setRoute] = useState<Route>('ssh')
  // Came through setting up over SSH, or opened on a setup under way: Althar installs it there, as a run of steps.
  const [chose, setChose] = useState(false)
  // The first field takes the keys as the dialog opens; a method chosen after keeps focus on its switch.
  const [switched, setSwitched] = useState(false)
  const installs = (chose || install.setup !== null) && homes.setUp !== undefined
  // Opened on a setup under way: it opens where that got to.
  const under = install.setup !== null
  useEffect(() => {
    if (!under) return
    setView('form')
    if (flow.method !== 'ssh') flow.setMethod('ssh')
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once a setup is known, not on every change of the form
  }, [under])
  // Running, or set up and found to be another home than the one it made: the setup's own buttons, not Connect.
  const running = view === 'form' && installs && flow.method === 'ssh' && (flow.found === null || install.stranger)
  const installing = running && install.phase !== 'idle'
  const stage = !installing
    ? view === 'form'
      ? flow.stage
      : view
    : install.phase === 'failed' || (install.phase === 'done' && (flow.stage === 'refused' || install.stranger))
      ? 'refused'
      : install.phase === 'running' || install.phase === 'reconnecting' || install.phase === 'done'
        ? 'checking'
        : 'draft'
  const go = () => {
    if (view === 'intro') return morph(() => setView('setup'))
    if (view === 'setup')
      return morph(() => {
        flow.setMethod(route === 'ssh' ? 'ssh' : 'pair')
        setChose(route === 'ssh')
        setView('form')
      })
    if (running) {
      if (install.phase === 'idle') return install.start()
      if (install.phase === 'failed' && install.problem?.retry === true) return install.retry()
      if (install.phase === 'trust') return install.trust()
      if (install.phase === 'stopped') return install.resume()
      if (install.phase === 'done' && (flow.stage === 'refused' || install.stranger)) return install.reread()
      return
    }
    flow.submit()
  }
  const run = running ? installActions(install) : null
  // A setup under way, or waiting on the person, outlives the dialog: closing it hides it, and the chip brings it back.
  const underWay = installs && install.phase !== 'idle' && flow.stage !== 'connecting' && flow.stage !== 'connected'
  const cancel = () => {
    if (install.setup !== null) install.dismiss()
    onClose()
  }
  const back = () => morph(() => setView(first ? 'intro' : 'form'))
  const title = view === 'intro' ? 'Your first home' : view === 'setup' ? 'Set up a home' : 'Connect a home'
  const how = view === 'intro' ? 'always on' : (view === 'setup' ? route === 'ssh' : flow.method === 'ssh') ? 'ssh' : 'https'
  return (
    <Dialog
      title={title}
      width={660}
      className={c.dialog}
      holding={flow.busy || install.busy}
      // Its steps, or what it set up: more of the window, its buttons kept in sight.
      tall={view === 'form' && installs && flow.method === 'ssh' && install.phase !== 'idle'}
      onClose={underWay ? onHide : onClose}
      onBack={view === 'setup' ? back : undefined}
      onSubmit={go}
      actions={
        running ? (
          <>
            {run?.secondary === 'Stop' ? <Button onClick={install.stop}>Stop</Button> : <Button onClick={cancel}>Cancel</Button>}
            {run?.other === 'upload' && (
              <Button variant={run.primary === null ? 'signal' : undefined} onClick={install.send}>
                Send it from here
              </Button>
            )}
            {(run === null || run.primary !== null) && (
              <Button
                type="submit"
                variant="signal"
                busy={run?.busy === true || (install.phase === 'done' && flow.stage === 'checking' && !install.stranger)}
                disabled={run?.busy === true || (run === null && flow.ssh.target.trim() === '')}
              >
                {run === null
                  ? install.phase !== 'done'
                    ? 'Set it up'
                    : flow.stage === 'refused' || install.stranger
                      ? 'Try again'
                      : 'Reading its identity…'
                  : run.primary}
              </Button>
            )}
          </>
        ) : view === 'form' ? (
          <>
            <Button onClick={cancel}>Cancel</Button>
            {flow.action}
          </>
        ) : (
          <>
            <Button onClick={onClose}>{view === 'intro' ? 'Not now' : 'Cancel'}</Button>
            <Button type="submit" variant="signal">
              {view === 'intro' ? 'Set one up' : route === 'ssh' ? 'Continue' : 'Paste its code'}
            </Button>
          </>
        )
      }
    >
      <Board flow={flow} view={view} stage={stage} how={how} />
      <div className={c.body}>
        {experimental}
        {view === 'intro' && (
          <div className={c.intro}>
            <h3 className={c.lede}>Work that keeps going while {device.this} sleeps</h3>
            <p className={c.copy}>
              A home is a computer that runs Althar for you, such as a server that stays on. Its tasks run there, and you open its projects
              from here, each in a window of its own.
            </p>
          </div>
        )}
        {view === 'setup' && <Routes route={route} installs={homes.setUp !== undefined} onRoute={(next) => morph(() => setRoute(next))} />}
        {view === 'form' && (
          <div className={c.form} key="form">
            {!installing && install.phase !== 'done' && homes.pair !== undefined && (
              <MethodSwitch
                flow={flow}
                onChange={(next) => {
                  setSwitched(true)
                  morph(() => flow.setMethod(next))
                }}
              />
            )}
            {flow.method === 'ssh' ? (
              <HostField
                flow={flow}
                readOnly={install.phase !== 'idle' && install.phase !== 'failed'}
                focus={!first && !under && !switched}
                problem={install.refused}
                help={
                  installs && install.phase === 'idle' ? 'Althar installs and starts althar-host there, where it isn’t yet.' : undefined
                }
              />
            ) : (
              <CodeField
                flow={flow}
                focus={!first && !switched}
                help={
                  <>
                    On the home, <Code>althar-host pair</Code> prints one.{' '}
                    {homes.setUp !== undefined && (
                      <button type="button" className={c.link} onClick={() => morph(() => setView('setup'))}>
                        Not set up yet?
                      </button>
                    )}
                  </>
                }
              />
            )}
            {installing && <InstallSteps install={install} />}
            {flow.method === 'ssh' && flow.found === null && flow.stage !== 'checking' && install.phase === 'idle' && (
              <Options flow={flow} />
            )}
            {flow.found !== null && !(installs && install.stranger) && (
              <>
                {installs && flow.method === 'ssh' && install.phase === 'done' ? (
                  // Althar made this home itself, over a key the person trusted: there's no identity to compare.
                  <InstallDone install={install} />
                ) : (
                  <p className={c.note}>
                    {flow.method === 'ssh' ? (
                      <>
                        On the host, <Code>althar-host status</Code> prints the same identity. Connect only if it does.
                      </>
                    ) : (
                      'Tasks and conversations are available. Approvals need a trusted device.'
                    )}
                  </p>
                )}
                <NameField flow={flow} />
              </>
            )}
            <LaterProblem flow={flow} />
          </div>
        )}
      </div>
    </Dialog>
  )
}
