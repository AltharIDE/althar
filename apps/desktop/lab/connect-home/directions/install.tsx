import { useEffect, useRef, useState } from 'react'
import { AskCard, Code, CopyButton, Disclosure, DisclosureTrigger, Caret, Fold, Icon, Problem, Snippet, Spinner } from '@althar/ui'

import type { Flow } from '../flow'
import homes from '../../../src/renderer/features/homes/Homes.module.css'
import s from './install.module.css'

/*
 * Setting a home up over SSH, as a run of steps on the server, each said as it goes, with what it ran kept to show.
 * Assumed (none of this exists yet): the desktop reaches the server with the person's own OpenSSH, looks it over,
 * then hands the server a setup that runs there on its own, detached from the SSH session, writing where it got to.
 * So a dropped connection, a sleeping laptop or a quit Althar leaves it going or resumable, never half-made: each
 * step is safe to run again, and Try again starts from the step that stopped.
 *
 * The lab's scenarios (X) play the troubles worth designing for.
 */

export const SCENARIOS = [
  { key: 'ok', label: 'Goes through' },
  { key: 'new-key', label: 'First time: its key' },
  { key: 'auth', label: 'Key turned down' },
  { key: 'root', label: 'Logs in as root' },
  { key: 'offline', label: 'Server offline' },
  { key: 'dropped', label: 'Connection drops' },
  { key: 'no-systemd', label: 'No systemd' },
  { key: 'linger', label: 'Stops at logout' },
  { key: 'resume', label: 'Althar quit midway' },
] as const
export type Scenario = (typeof SCENARIOS)[number]['key']

type StepId = 'reach' | 'look' | 'get' | 'setup' | 'start' | 'identity'
type StepState = 'later' | 'now' | 'done' | 'failed'
type Trouble = {
  /** What happened, in a line. */
  title: string
  /** What to do about it. */
  body: React.ReactNode
  /** A command to copy, for the server or a terminal here. */
  command?: string
  /** Try again resumes; where it can't help (a server Althar can't run on), there is none. */
  retry: boolean
  /** A way round it, as a button beside Try again. */
  other?: { label: string; act: () => void }
}

const TARGET_HOST = (target: string) => target.split('@').at(-1) || target
const FINGERPRINT = 'SHA256:q7Tf3kVxN2mWc9hZp1RaLd8yGs4uEoBi6tJ0nKvYw5M'

export const useInstall = (flow: Flow, scenario: Scenario) => {
  const [phase, setPhase] = useState<'idle' | 'running' | 'trust' | 'failed' | 'stopped' | 'reconnecting' | 'done'>(
    scenario === 'resume' ? 'stopped' : 'idle',
  )
  const [at, setAt] = useState<number>(scenario === 'resume' ? 2 : 0)
  const [progress, setProgress] = useState(scenario === 'resume' ? 0.42 : 0)
  const [problem, setProblem] = useState<Trouble | null>(null)
  const [warning, setWarning] = useState<Trouble | null>(null)
  const [upload, setUpload] = useState(false)
  const [log, setLog] = useState<string[]>(
    scenario === 'resume'
      ? [
          '$ ssh deploy@vps.example.com',
          'Linux 6.8.0 x86_64 · systemd 255 · 21 GB free',
          'althar-host 0.14.2: downloading (42%)',
          '(Althar quit: the server kept what it had)',
        ]
      : [],
  )
  const trusted = useRef(false)
  const dropped = useRef(false)
  const offline = useRef(scenario === 'offline')
  const sending = useRef(false)
  // The target this setup's steps were done for: another typed after a failure starts it over.
  const startedFor = useRef('')
  // Logged in as root: Althar made the home its own user, and connects as it from then on.
  const [madeUser, setMadeUser] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // The run's timers outlive the render that started them: they reach the form, and its check, as it is now.
  const latest = useRef(flow)
  latest.current = flow
  const fallback = scenario === 'root' ? 'root@vps.example.com' : 'deploy@vps.example.com'
  const typed = () => latest.current.ssh.target.trim() || fallback
  const target = startedFor.current || typed()
  const login = target.includes('@') ? target.split('@')[0]! : 'deploy'
  const host = TARGET_HOST(target)
  const say = (line: string) => setLog((was) => [...was, line])
  const later = (ms: number, then: () => void) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(then, ms)
  }
  const fail = (next: Trouble) => {
    setProblem(next)
    setPhase('failed')
  }

  /** Another server typed since it failed: what was done was done there, so it starts over, there. True where it did. */
  const movedOn = () => {
    if (typed() === startedFor.current) return false
    startedFor.current = typed()
    trusted.current = false
    dropped.current = false
    offline.current = scenario === 'offline'
    sending.current = false
    setUpload(false)
    setProgress(0)
    setWarning(null)
    setMadeUser(false)
    setLog([])
    run(0)
    return true
  }

  /** Runs the step at `step`, then the next, as the scenario has them go, on the server it's setting up now. */
  const run = (step: number) => {
    const target = startedFor.current || typed()
    const login = target.includes('@') ? target.split('@')[0]! : 'deploy'
    const host = TARGET_HOST(target)
    setAt(step)
    setPhase('running')
    setProblem(null)
    if (step === 0) {
      say(`$ ssh ${target}`)
      if (scenario === 'new-key' && !trusted.current)
        return later(700, () => {
          say(`The authenticity of host '${host}' can't be established. ED25519 key fingerprint is ${FINGERPRINT}.`)
          setPhase('trust')
        })
      if (scenario === 'auth')
        return later(900, () => {
          say(`${target}: Permission denied (publickey).`)
          fail({
            title: 'The server turned down this computer’s SSH keys.',
            body: (
              <>
                Add your key to it from a terminal here, then try again. Althar doesn’t use passwords; your SSH agent and{' '}
                <Code>~/.ssh/config</Code> are used as they are.
              </>
            ),
            command: `ssh-copy-id ${target}`,
            retry: true,
          })
        })
      return later(800, () => run(1))
    }
    if (step === 1) {
      return later(700, () => {
        if (scenario === 'no-systemd') {
          say('Linux 6.8.0 x86_64 · no systemd user manager (PID 1: tini)')
          return fail({
            title: 'This server can’t keep a home running: it has no systemd.',
            body: 'Usually a container. A home needs a Linux machine or VM with systemd, so it keeps running when you log out and comes back after a restart.',
            retry: false,
            other: { label: 'Other ways to install', act: () => window.open('https://althar.dev/docs/homes', '_blank') },
          })
        }
        say('Linux 6.8.0 x86_64 · systemd 255 · 21 GB free · git 2.43')
        // As root, the home gets a user of its own, althar, as its README says: tasks never run as root.
        if (login === 'root') {
          const own = `althar@${host}`
          say('useradd --create-home --shell /bin/bash althar')
          say('Copied your SSH key to ~althar/.ssh/authorized_keys')
          say('loginctl enable-linger althar')
          say(`$ ssh ${own}  (from here on: the home is althar's)`)
          startedFor.current = own
          setMadeUser(true)
          latest.current.ssh.setTarget(own)
        }
        run(2)
      })
    }
    if (step === 2) {
      say(sending.current ? 'althar-host 0.14.2: uploading from this computer' : 'althar-host 0.14.2: downloading from althar.dev')
      if (offline.current)
        return later(1000, () => {
          say(`curl: (6) Could not resolve host: althar.dev`)
          fail({
            title: `${host} can’t reach the internet to download althar-host.`,
            body: 'Althar can send it from this computer instead (38 MB). It’s checked against Althar’s signature on the server either way.',
            retry: true,
            other: {
              label: 'Send it from here',
              act: () => {
                if (movedOn()) return
                offline.current = false
                sending.current = true
                setUpload(true)
                run(2)
              },
            },
          })
        })
      // the download, in steps, from where it had got to
      const tick = (done: number) => {
        setProgress(done)
        if (scenario === 'dropped' && !dropped.current && done >= 0.55) {
          dropped.current = true
          say('Connection to vps.example.com closed by remote host.')
          setPhase('reconnecting')
          return later(1600, () => {
            say(`$ ssh ${target}  (again: the setup went on there)`)
            say('althar-host 0.14.2: downloading (71%)')
            setPhase('running')
            tick(0.71)
          })
        }
        if (done >= 1) {
          say('Signature checked against Althar’s release key')
          return later(200, () => run(3))
        }
        later(110, () => tick(Math.min(1, done + 0.07)))
      }
      return tick(progress >= 1 ? 0 : progress)
    }
    if (step === 3)
      return later(700, () => {
        say('althar-host init: a new home, home_01a1c4f3…, its key kept apart from its data')
        run(4)
      })
    if (step === 4)
      return later(800, () => {
        say('systemctl --user enable --now althar-host.service')
        if (scenario === 'linger' && login !== 'root') {
          say('Linger is off for deploy: user services stop at logout.')
          setWarning({
            title: 'It stops when you log out of the server.',
            body: 'To keep it running after logout and start it after a restart, run this on the server once. It needs sudo, which Althar won’t ask for.',
            command: 'sudo loginctl enable-linger deploy',
            retry: false,
          })
        }
        say('althar-host status: ready')
        setAt(5)
        setPhase('done')
        // the form's check as it is now: of the dedicated user's target where Althar made one
        latest.current.submit()
      })
  }

  const stepState = (step: number): StepState => {
    if (step === 5) {
      // identity: read once the setup is done, by the form's own check
      if (phase !== 'done') return 'later'
      if (flow.stage === 'found' || flow.stage === 'connecting' || flow.stage === 'connected') return 'done'
      if (flow.stage === 'refused') return 'failed'
      return 'now'
    }
    if (step < at) return 'done'
    if (step > at) return 'later'
    if (phase === 'failed') return 'failed'
    if (phase === 'done') return 'done'
    return phase === 'stopped' ? 'later' : 'now'
  }
  return {
    phase,
    at,
    progress,
    problem,
    warning,
    upload,
    log,
    host,
    target,
    stepState,
    /** Under way, where the form holds still. */
    busy: phase === 'running' || phase === 'reconnecting' || (phase === 'done' && flow.stage === 'checking'),
    start: () => {
      startedFor.current = typed()
      setLog([])
      run(0)
    },
    retry: () => {
      if (movedOn()) return
      say(`(trying again from: ${STEPS[at]?.label ?? ''})`)
      run(at)
    },
    /** Set up, but its identity couldn't be read: reads it again; the setup itself stands. */
    reread: () => {
      say('(reading its identity again)')
      latest.current.submit()
    },
    resume: () => {
      say('(resuming: the server has what it had)')
      run(at)
    },
    login,
    /** Logged in as root: the home runs as a user of its own, althar. */
    own: madeUser,
    trust: () => {
      trusted.current = true
      say(`Trusted ${host} (${FINGERPRINT}), kept in ~/.ssh/known_hosts`)
      run(0)
    },
    stop: () => {
      clearTimeout(timer.current)
      say('(stopped: what it had done stays, and resumes from here)')
      setPhase('stopped')
    },
  }
}
export type Install = ReturnType<typeof useInstall>

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'reach', label: 'Reach the server' },
  { id: 'look', label: 'Look it over' },
  { id: 'get', label: 'Get althar-host' },
  { id: 'setup', label: 'Make it a home' },
  { id: 'start', label: 'Start its service' },
  { id: 'identity', label: 'Read its identity' },
]

/** The run, step by step: what each did, where it stopped and what to do, and what it ran, to show. */
export function InstallSteps({ install }: { install: Install }) {
  const detail = (index: number, state: StepState) => {
    if (index === 0 && state === 'done') return install.target
    if (index === 1 && state === 'done') return `Linux · x64 · systemd · 21 GB free${install.own ? ' · made the user althar for it' : ''}`
    if (index === 2 && state === 'now' && install.phase === 'reconnecting')
      return 'Connection dropped. Reconnecting; it goes on there meanwhile'
    if (index === 2 && state === 'now')
      return `${install.upload ? 'Sending from this computer' : 'Downloading'} · ${Math.round(install.progress * 38)} of 38 MB`
    if (index === 2 && state === 'done') return `0.14.2, signature checked${install.upload ? ', sent from here' : ''}`
    if (index === 2 && install.phase === 'stopped') return `Stopped at ${Math.round(install.progress * 100)}%: it resumes from there`
    if (index === 4 && state === 'done') return 'Starts with the server, restarts if it stops'
    return null
  }
  return (
    <div className={s.install}>
      {install.phase === 'stopped' && (
        <p className={s.resumeNote}>
          <Icon name="info" size={12} />
          Setting up {install.host} stopped partway. Nothing’s lost: it picks up where it got to.
        </p>
      )}
      <ol className={s.steps} aria-live="polite" aria-label={`Setting up ${install.target}`}>
        {STEPS.map((step, index) => {
          const state = install.stepState(index)
          const said = detail(index, state)
          return (
            <li key={step.id} data-state={state}>
              <span className={s.tick}>
                {state === 'done' ? (
                  <Icon name="check" size={10} />
                ) : state === 'failed' ? (
                  <Icon name="close" size={10} />
                ) : state === 'now' && install.phase === 'trust' ? (
                  <Icon name="lock" size={10} />
                ) : state === 'now' ? (
                  <Spinner size="small" />
                ) : null}
              </span>
              <span className={s.stepWords}>
                <span className={s.stepLabel}>{step.label}</span>
                {said !== null && <span className={s.stepDetail}>{said}</span>}
                {index === 2 && state === 'now' && (
                  <span className={s.bar} data-paused={install.phase === 'reconnecting' || undefined}>
                    <span style={{ transform: `scaleX(${install.progress})` }} />
                  </span>
                )}
                {state === 'now' && install.phase === 'trust' && (
                  <AskCard icon="lock" kicker="First time on this server" what={`Is this ${install.host}’s key?`} className={s.ask}>
                    <span className={s.fingerprint}>
                      <code>{FINGERPRINT}</code>
                      <CopyButton value={FINGERPRINT} ghost />
                    </span>
                    <span className={s.note}>
                      On the server, <Code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</Code> prints it. Your provider’s console shows
                      it too.
                    </span>
                  </AskCard>
                )}
                {state === 'failed' && install.problem !== null && <Failed problem={install.problem} />}
              </span>
            </li>
          )
        })}
      </ol>
      {install.warning !== null && <LeftToDo warning={install.warning} />}
      {install.log.length > 0 && (
        <Disclosure>
          <DisclosureTrigger>
            <button type="button" className={s.more}>
              What it ran <Caret />
            </button>
          </DisclosureTrigger>
          <Fold bleed={false}>
            <div className={s.log}>
              <CopyButton value={install.log.join('\n')} tone="onDark" ghost className={s.logCopy} />
              {install.log.map((line, index) => (
                <code key={index}>{line}</code>
              ))}
            </div>
          </Fold>
        </Disclosure>
      )}
    </div>
  )
}

/** Where a step failed, under it: the kit's Problem, what to do, and the command that does it. */
function Failed({ problem }: { problem: Trouble }) {
  return (
    <span className={s.failed}>
      <Problem as="span" size="small">
        {problem.title}
      </Problem>
      <span className={s.note}>{problem.body}</span>
      {problem.command !== undefined && <Snippet cmd={problem.command} />}
    </span>
  )
}

/** What's still to do on the server once it runs: offered, not waited on, so a quiet ask in ink. */
function LeftToDo({ warning }: { warning: Trouble }) {
  return (
    <AskCard icon="info" kicker="One thing on the server" what={warning.title} quiet>
      <span className={s.note}>{warning.body}</span>
      {warning.command !== undefined && <Snippet cmd={warning.command} />}
    </AskCard>
  )
}

/** Its buttons, by where the run stands: what the dialog's footer offers. */
export function installActions(install: Install) {
  switch (install.phase) {
    case 'trust':
      return { primary: 'Trust and continue', secondary: 'Cancel' as const }
    case 'failed':
      return { primary: install.problem?.retry ? 'Try again' : null, other: install.problem?.other, secondary: 'Cancel' as const }
    case 'stopped':
      return { primary: 'Resume', secondary: 'Cancel' as const }
    case 'running':
    case 'reconnecting':
      return { primary: 'Setting up…', busy: true, secondary: 'Stop' as const }
    default:
      return null
  }
}

/** Set up and found: what it is now, and anything still to do on the server, kept in view as it's named and connected. */
export function InstallDone({ install }: { install: Install }) {
  return (
    <div className={s.install}>
      <p className={s.doneNote}>
        <span className={s.doneTick}>
          <Icon name="check" size={10} />
        </span>
        althar-host 0.14.2 is running on {install.host}
        {install.own && ' as althar'}
        {install.warning === null ? ', and starts with it.' : '.'}
      </p>
      {install.warning !== null && <LeftToDo warning={install.warning} />}
    </div>
  )
}

/**
 * A setup going on with its dialog closed, on the window's homes chip: where it's got to, and a press brings the dialog
 * back as it is. It's the person's to answer where it waits (its key), red where it stopped on a trouble.
 */
export function InstallChip({ install, found, onShow }: { install: Install; found: boolean; onShow: () => void }) {
  const step = STEPS[install.at]?.label ?? ''
  const [icon, said, tone] = found
    ? (['check', 'Ready to connect', 'quiet'] as const)
    : install.phase === 'failed'
      ? (['problem', 'Setup stopped', 'down'] as const)
      : install.phase === 'trust'
        ? (['answer', 'Needs you', 'ask'] as const)
        : install.phase === 'stopped'
          ? (['pause', 'Paused', 'quiet'] as const)
          : install.phase === 'reconnecting'
            ? (['spin', 'Reconnecting…', 'quiet'] as const)
            : install.at === 2
              ? (['spin', `Getting althar-host · ${Math.round(install.progress * 100)}%`, 'quiet'] as const)
              : (['spin', `${step}…`, 'quiet'] as const)
  return (
    <button
      type="button"
      className={homes.chip}
      data-down={tone === 'down' || undefined}
      data-ask={tone === 'ask' || undefined}
      aria-label={`Setting up ${install.host}: ${said}. Show it`}
      onClick={onShow}
    >
      {icon === 'spin' ? <Spinner size="small" /> : <Icon name={icon} size={13} />}
      <span className={homes.chipName}>{install.host.split('.')[0]}</span>
      <span className={tone === 'down' ? homes.chipDown : tone === 'ask' ? s.chipAsk : homes.chipQuiet}>{said}</span>
    </button>
  )
}
