import { useEffect, useRef, useState, type ReactNode } from 'react'
import { device } from '../../shared/device'
import { AskCard, Caret, Code, CopyButton, Disclosure, DisclosureTrigger, Fold, Icon, Problem, Snippet, Spinner } from '@althar/ui'

import { SETUP_STEPS, type HomeSetup, type HomesHost, type SetupAction } from '../../../homes'
import { optionsOf, targetOf } from './ConnectHome'
import type { Flow } from './useFlow'
import { homeProblem, hostOf, useHomeSetup } from './useHomes'
import homes from './Homes.module.css'
import s from './SetUp.module.css'

/*
 * Setting a home up over SSH, as main runs it (main/homes/setup.ts): a run of steps on the server, each said as it goes,
 * with what it ran kept to show. It goes on with the dialog closed, on the window's homes chip, and picks up again after
 * Althar quits. Here: what each step did, where it stopped and what to do, and the buttons for where it stands.
 */

export const HOST_README = 'https://github.com/AltharIDE/althar/blob/main/apps/host/README.md'

export interface Trouble {
  /** What happened, in a line. */
  readonly title: string
  /** What to do about it. */
  readonly body: ReactNode
  /** A command to copy, for the server or a terminal here. */
  readonly command?: string
  /** Try again can help; where it can't (a server that can't run a home), there's none. */
  readonly retry: boolean
  /** A way round it, beside Try again. */
  readonly other?: 'upload'
}

const LABELS = ['Reach the server', 'Look it over', 'Get althar-host', 'Make it a home', 'Start its service', 'Read its identity']
const JOURNAL = 'journalctl --user -u althar-host.service -n 60'

/** What stopped a setup, in words: what happened, what to do, and the command that does it. */
export const troubleOf = (code: string, setup: HomeSetup): Trouble => {
  const target = setup.target.target
  const host = hostOf(target)
  const port = setup.target.port === undefined ? '' : ` -p ${setup.target.port}`
  switch (code) {
    case 'AuthFailed':
      return {
        title: `The server turned down ${device.this}’s SSH keys.`,
        body: (
          <>
            Add your key to it from a terminal here, then try again. Althar doesn’t use passwords; your SSH agent and{' '}
            <Code>~/.ssh/config</Code> are used as they are.
          </>
        ),
        command: `ssh-copy-id${port} ${target}`,
        retry: true,
      }
    case 'Unreachable':
    case 'Dropped':
      return {
        title: code === 'Dropped' ? `The connection to ${host} keeps dropping.` : `Althar couldn’t reach ${host} over SSH.`,
        body:
          code === 'Dropped'
            ? 'What the server has done stays there, and Try again picks up from it.'
            : 'Check the address, and that this logs in from a terminal here.',
        command: `ssh${port} ${target}`,
        retry: true,
      }
    case 'HostKeyChanged':
      return {
        title: `${host}’s SSH key isn’t the one ${device.this} knows.`,
        body: 'The server may have been rebuilt, or something is in the way. Check its key with your provider before you remove the old one.',
        command: `ssh-keygen -R ${host}`,
        retry: true,
      }
    case 'KeyScanFailed':
      return {
        title: `Althar couldn’t read ${host}’s SSH key.`,
        body: 'Log in once from a terminal here, which asks you to trust it, then try again.',
        command: `ssh${port} ${target}`,
        retry: true,
      }
    case 'UnsupportedOS':
    case 'UnsupportedArchitecture':
      return {
        title: `${host} isn’t a 64-bit Linux server.`,
        body: 'A home runs on 64-bit Linux, on Intel or Arm, with systemd.',
        retry: false,
      }
    case 'NoSystemd':
      return {
        title: 'This server can’t keep a home running: it has no systemd.',
        body: 'Usually a container. A home needs a Linux machine or VM with systemd, so it keeps running when you log out and comes back after a restart.',
        retry: false,
      }
    case 'NoUserManager':
      return {
        title: 'This login has no systemd user session.',
        body: 'A home runs as a user service. Log in as a regular user rather than through su or a container shell, then try again.',
        retry: true,
      }
    case 'NotEnoughDisk':
    case 'DiskUnavailable':
      return {
        title: `${host} doesn’t have room for althar-host.`,
        body: 'It needs about 500 MB free in your home folder there.',
        command: 'df -h ~',
        retry: true,
      }
    case 'NoRelease':
      return {
        title: 'There’s no althar-host release to install yet.',
        body: (
          <>
            <a className={s.link} href={HOST_README} target="_blank" rel="noreferrer">
              Set it up on the server by hand
            </a>
            , then connect to it here, over SSH or with a pairing code.
          </>
        ),
        retry: false,
      }
    case 'CannotDownload':
      return {
        title: `${host} can’t download althar-host.`,
        body: `Althar can send it from ${device.this} instead. It’s checked against Althar’s signature on the server either way.`,
        retry: true,
        other: 'upload',
      }
    case 'UploadFailed':
      return {
        title: `althar-host couldn’t be sent from ${device.this}.`,
        body: `Check ${device.this}’s connection, then try again.`,
        retry: true,
      }
    case 'SignatureMismatch':
    case 'ReleaseExtractionFailed':
    case 'ReleaseRejected':
      return {
        title: 'The althar-host release didn’t check out against Althar’s signature.',
        body: 'Nothing of it ran. Try again in a while; a release being published may be half there.',
        retry: true,
      }
    case 'LockHeld':
      return {
        title: `Another setup is running on ${host}.`,
        body: 'Try again in a moment to follow it.',
        retry: true,
      }
    case 'AccountConflict':
      return {
        title: `${host} already has a user called althar that Althar didn’t make.`,
        body: 'Log in as that user, or as another regular user, instead of root.',
        retry: false,
      }
    case 'DedicatedUserRequired':
    case 'AccountCreationFailed':
    case 'AccountKeyFailed':
    case 'AccountLingerFailed':
    case 'InvalidPublicKey':
    case 'NoPublicKey':
      return {
        title: `Althar couldn’t make ${host} a user of its own, althar.`,
        body:
          code === 'NoPublicKey' || code === 'InvalidPublicKey'
            ? 'It couldn’t tell which of your SSH keys logged you in. Load it into your SSH agent, or log in as a regular user.'
            : 'Log in as a regular user instead of root, or make the user althar yourself.',
        retry: true,
      }
    default:
      return {
        title: `Setting up ${host} stopped at ${LABELS[setup.at]?.toLowerCase() ?? 'a step'}.`,
        body: 'What it ran says why, and the server’s log has more. Try again picks up where it stopped.',
        command: JOURNAL,
        retry: true,
      }
  }
}

type Phase = 'idle' | HomeSetup['phase']
type StepState = 'later' | 'now' | 'done' | 'failed'

/**
 * The setup as the dialog draws it: main's, shown as pressed at once (a press predicts what main does next, until main
 * says), with the form kept on the target it's set up on, and its identity read by the form's own check once it's done.
 */
export const useSetup = (host: HomesHost, flow: Flow) => {
  const told = useHomeSetup(host)
  const [held, setHeld] = useState<{ readonly setup: HomeSetup | null; readonly over: HomeSetup | null } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  // What main said last wins over a guess made before it.
  const setup = held !== null && held.over === told ? held.setup : told
  const latest = useRef(flow)
  useEffect(() => {
    latest.current = flow
  })
  // Main moves the target (to althar@host, as it makes that user), or the dialog opens on a setup under way: the form follows.
  const synced = useRef('')
  useEffect(() => {
    if (told === null) {
      synced.current = ''
      return
    }
    const key = JSON.stringify(told.target)
    if (synced.current === key) return
    synced.current = key
    if (JSON.stringify(targetOf(latest.current.ssh.target, latest.current.ssh.options)) !== key)
      latest.current.ssh.reset(told.target.target, optionsOf(told.target))
  }, [told])
  // Set up: its identity is read as any host's is, by the form's own check.
  const phase: Phase = setup === null ? 'idle' : setup.phase
  useEffect(() => {
    if (phase !== 'done' || latest.current.method !== 'ssh') return
    const { ssh } = latest.current
    if (ssh.phase === 'idle' && ssh.target.trim() === told?.target.target) ssh.check()
  }, [phase, told, flow.ssh.target])

  const predict = (next: HomeSetup | null) => setHeld({ setup: next, over: told })
  const act = (action: SetupAction, next: HomeSetup | null) => {
    predict(next)
    void host.setupAct?.(action).catch(() => setHeld(null))
  }
  const typed = () => targetOf(flow.ssh.target, flow.ssh.options)
  /** Another server typed since it stopped: what was done was done there, so it starts over, here. */
  const movedOn = () => setup !== null && JSON.stringify(typed()) !== JSON.stringify(setup.target)
  const start = () => {
    const target = typed()
    if (target.target === '' || host.setUp === undefined) return
    setRefused(null)
    predict({ target, phase: 'running', at: 0, upload: false, madeUser: false, log: [`$ ssh ${target.target}`] })
    void host.setUp(target).catch((error: unknown) => {
      setHeld(null)
      setRefused(homeProblem(error))
    })
  }
  const going = (next: Partial<HomeSetup>) => (setup === null ? null : { ...setup, phase: 'running' as const, problem: undefined, ...next })

  const problem = setup?.phase === 'failed' && setup.problem !== undefined ? troubleOf(setup.problem, setup) : null
  const target = setup?.target.target ?? flow.ssh.target.trim()
  const stepState = (step: number): StepState => {
    if (setup === null) return 'later'
    if (step === 5) {
      if (phase !== 'done') return setup.at === 5 && phase === 'failed' ? 'failed' : setup.at === 5 ? 'now' : 'later'
      if (flow.stage === 'found' || flow.stage === 'connecting' || flow.stage === 'connected') return 'done'
      if (flow.stage === 'refused') return 'failed'
      return 'now'
    }
    if (step < setup.at || phase === 'done') return 'done'
    if (step > setup.at) return 'later'
    if (phase === 'failed') return 'failed'
    return phase === 'stopped' ? 'later' : 'now'
  }
  return {
    setup,
    phase,
    at: setup?.at ?? 0,
    progress: setup?.progress === undefined || setup.progress.total === 0 ? 0 : Math.min(1, setup.progress.bytes / setup.progress.total),
    megabytes: setup?.progress === undefined ? 0 : Math.round(setup.progress.total / 1_048_576),
    problem,
    /** A setup the main process couldn't start: a target it can't use. */
    refused,
    warning: setup?.linger,
    upload: setup?.upload === true,
    log: setup?.log ?? [],
    host: hostOf(target),
    target,
    own: setup?.madeUser === true,
    version: setup?.version,
    hostKey: setup?.hostKey,
    stepState,
    /** Under way, where the form holds still. */
    busy: phase === 'running' || phase === 'reconnecting' || (phase === 'done' && flow.stage === 'checking'),
    start,
    retry: () => (movedOn() ? start() : act('resume', going({}))),
    resume: () => (movedOn() ? start() : act('resume', going({}))),
    send: () => (movedOn() ? start() : act('upload', going({ upload: true }))),
    trust: () => act('trust', going({ hostKey: undefined })),
    stop: () => act('stop', setup === null ? null : { ...setup, phase: 'stopped' }),
    dismiss: () => act('dismiss', null),
    /** Set up, but its identity couldn't be read: reads it again; the setup itself stands. */
    reread: () => flow.ssh.check(),
  }
}
export type Install = ReturnType<typeof useSetup>

/** The run, step by step: what each did, where it stopped and what to do, and what it ran, to show. */
export function InstallSteps({ install }: { install: Install }) {
  const mb = install.megabytes
  const detail = (index: number, state: StepState) => {
    const facts = install.setup?.facts
    if (index === 0 && state === 'done') return install.target
    if (index === 1 && state === 'done' && facts !== undefined)
      return `Linux · ${facts.arch} · systemd · ${Math.round(facts.freeKiB / 1_048_576)} GB free${install.own ? ' · made the user althar for it' : ''}`
    if (index === 2 && state === 'now' && install.phase === 'reconnecting')
      return 'Connection dropped. Reconnecting; it goes on there meanwhile'
    if (index === 2 && state === 'now' && mb > 0)
      return `${install.upload ? `Sending from ${device.this}` : 'Downloading'} · ${Math.round(install.progress * mb)} of ${mb} MB`
    if (index === 2 && state === 'done' && install.version !== undefined)
      return `${install.version}, signature checked${install.upload ? ', sent from here' : ''}`
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
        {SETUP_STEPS.map((step, index) => {
          const state = install.stepState(index)
          const said = detail(index, state)
          return (
            <li key={step} data-state={state}>
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
                <span className={s.stepLabel}>{LABELS[index]}</span>
                {said !== null && <span className={s.stepDetail}>{said}</span>}
                {index === 2 && state === 'now' && mb > 0 && (
                  <span className={s.bar} data-paused={install.phase === 'reconnecting' || undefined}>
                    <span style={{ transform: `scaleX(${install.progress})` }} />
                  </span>
                )}
                {state === 'now' && install.phase === 'trust' && install.hostKey !== undefined && (
                  <AskCard icon="lock" kicker="First time on this server" what={`Is this ${install.host}’s key?`} className={s.ask}>
                    <span className={s.fingerprint}>
                      <code>{install.hostKey.fingerprint}</code>
                      <CopyButton value={install.hostKey.fingerprint} ghost />
                    </span>
                    <span className={s.note}>
                      On the server, <Code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</Code> prints it. Your provider’s console shows
                      it too.
                    </span>
                  </AskCard>
                )}
                {state === 'failed' && install.problem !== null && <Failed problem={install.problem} />}
                {index === 5 && state === 'failed' && install.problem === null && install.phase === 'done' && (
                  <Problem as="span" size="small">
                    Set up, but its identity couldn’t be read yet.
                  </Problem>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {install.warning !== undefined && install.at >= 4 && <LeftToDo command={install.warning} />}
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
function LeftToDo({ command }: { command: string }) {
  return (
    <AskCard icon="info" kicker="One thing on the server" what="It stops when you log out of the server." quiet>
      <span className={s.note}>
        To keep it running after logout and start it after a restart, run this on the server once. It needs sudo, which Althar won’t ask
        for.
      </span>
      <Snippet cmd={command} />
    </AskCard>
  )
}

/** Its buttons, by where the run stands: what the dialog's footer offers. */
export function installActions(install: Install) {
  switch (install.phase) {
    case 'trust':
      return { primary: 'Trust and continue', secondary: 'Cancel' as const }
    case 'failed':
      return { primary: install.problem?.retry === true ? 'Try again' : null, other: install.problem?.other, secondary: 'Cancel' as const }
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
        althar-host{install.version === undefined ? '' : ` ${install.version}`} is running on {install.host}
        {install.own && ' as althar'}
        {install.warning === undefined ? ', and starts with it.' : '.'}
      </p>
      {install.warning !== undefined && <LeftToDo command={install.warning} />}
    </div>
  )
}

/**
 * A setup going on with its dialog closed, on the window's homes chip: where it's got to, and a press brings the dialog
 * back as it is. It's the person's to answer where it waits (its key), red where it stopped on a trouble.
 */
export function SetupChip({ setup, onShow }: { setup: HomeSetup; onShow: () => void }) {
  const host = hostOf(setup.target.target)
  const percent =
    setup.progress === undefined || setup.progress.total === 0 ? null : Math.round((100 * setup.progress.bytes) / setup.progress.total)
  const [icon, said, tone] =
    setup.phase === 'done'
      ? (['check', 'Ready to connect', 'quiet'] as const)
      : setup.phase === 'failed'
        ? (['problem', 'Setup stopped', 'down'] as const)
        : setup.phase === 'trust'
          ? (['answer', 'Needs you', 'ask'] as const)
          : setup.phase === 'stopped'
            ? (['pause', 'Paused', 'quiet'] as const)
            : setup.phase === 'reconnecting'
              ? (['spin', 'Reconnecting…', 'quiet'] as const)
              : setup.at === 2 && percent !== null
                ? (['spin', `Getting althar-host · ${percent}%`, 'quiet'] as const)
                : (['spin', `${LABELS[setup.at] ?? ''}…`, 'quiet'] as const)
  return (
    <button
      type="button"
      className={homes.chip}
      data-down={tone === 'down' || undefined}
      data-ask={tone === 'ask' || undefined}
      title={setup.target.target}
      aria-label={`Setting up ${host}: ${said}. Show it`}
      onClick={onShow}
    >
      {icon === 'spin' ? <Spinner size="small" /> : <Icon name={icon} size={13} className={tone === 'ask' ? s.askIcon : undefined} />}
      <span className={homes.chipName}>{host.split('.')[0]}</span>
      <span className={tone === 'down' ? homes.chipDown : tone === 'ask' ? s.chipAsk : homes.chipQuiet}>{said}</span>
    </button>
  )
}
