import { type ReactNode, useState } from 'react'

import { LoadReadings } from '../../chrome/LoadMeter/LoadPeek'
import type { LoadAgents, LoadGlance, WorkerState } from '../../chrome/LoadMeter/load'
import type { Brand } from '../../foundations/brands/brands'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field } from '../../primitives/Field/Field'
import { Problem } from '../../primitives/Problem/Problem'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { ControlDetail } from '../ControlCenter/ControlCenter'
import cc from '../ControlCenter/ControlCenter.module.css'
import { SettingGroup } from '../Preferences/Preferences'
import { AddTile, SheetFact } from '../ToolTiles/ToolParts'
import tt from '../ToolTiles/ToolTiles.module.css'
import { CloudLine, type CloudUse } from './Cloud'
import s from './Computers.module.css'
import { WorkerUpdateStrip } from './WorkerUpdateStrip'
import { fleetUpdate, shortUpdate, type WorkerUpdateView, workerUpdateText } from './workerUpdate'

/*
 * Settings › Computers: where the home's agents run (ADR-103). Sections, as
 * Settings has them: Home, the computer that keeps the projects, with its
 * readings as its load popover has them; Workers, the computers it runs
 * tasks on, one task at a time each, with where each stands; and Cloud,
 * Althar Cloud's line, only once a home has it. Each is one of the kit's
 * modules with a round picture of what it is: the home a house in ink, a
 * worker a computer, red where it is out of reach, the cloud a cloud. A
 * computer opens out in place, as an MCP server opens out of its tile, with
 * a way back: its readings beside what it is, its settings under them, and
 * taking it out apart at the foot.
 */

/** The home, as Computers has it: its name, how hard it works, its agents. */
export interface ComputerHome {
  /** As the window names it: This Mac, or the home's own name. */
  name: string
  /** How hard it works; null before the first reading, or where it can't be read. */
  load: LoadGlance | null
  agents: LoadAgents | null
}

/** One of the home's workers, as Computers has it. */
export interface ComputerWorker {
  id: string
  /** As the person knows it: Linux worker 3f9a2c. */
  name: string
  /** What it is, in a line: Linux · arm64 · 8 cores; null while it hasn't said. */
  kind: string | null
  state: WorkerState
  /** The home's task it runs, while it runs one. */
  task: { id: string; title: string; project: string } | null
  /** What it has free, formatted: 12.4 GB; null while it hasn't said. */
  memoryFree: string | null
  diskFree: string | null
  /**
   * The agents it can run, by name, each with its mark where it has one; `signedIn` where it says, as a worker its home
   * set up does, and `id` to sign one in by.
   */
  agents: readonly { id?: string | undefined; name: string; mark?: Brand | undefined; signedIn?: boolean | undefined }[]
  /** The projects it may work on, by name. */
  projects: readonly string[]
  /** Those projects, by id, where the window picks them (`ComputersProps.onProjects`). */
  projectIds?: readonly string[] | undefined
  /** Its home set it up: its projects are picked in the window, and its agents signed in from it. */
  managed?: boolean | undefined
  /** It can be reached over SSH from here: its agents sign in from the window. */
  reachable?: boolean | undefined
  /**
   * Gone offline during a task: it still holds that task's workspace, and keeps it until it reconnects and says the work
   * stopped, so it can't be taken out before then.
   */
  stranded?: boolean | undefined
  /**
   * What its own check found that stops a task there (ADR-103), in words: what, what to do, and the command an
   * administrator runs there, to copy; none where it is ready, or hasn't checked.
   */
  unready?: { title: string; body?: string | undefined; command?: string | undefined } | undefined
  /** The Althar release it runs, where it says. */
  release?: string | undefined
  /** Where its update stands, where a newer release is out or one was asked for. */
  update?: WorkerUpdateView | undefined
}

/** The home's workers: whether it takes any (it listens for them), and each it enrolled. */
export interface ComputerWorkers {
  enabled: boolean
  list: readonly ComputerWorker[]
}

/** The home, opened out: as a worker's id would open one. */
export const HOME = 'home'

export interface ComputersText {
  computers: string
  home: string
  /** Under the home's name: what a home is. */
  homeLine: string
  /** Over a worker opened out, as Home is over the home. */
  worker: string
  workers: string
  cloud: string
  add: string
  /** Under Add a worker, while there are none. */
  addLine: string
  reading: string
  state: Record<WorkerState, string>
  /** Under where a worker stands: what it runs, or what is off. */
  stateLine: (worker: ComputerWorker) => string
  memoryFree: string
  diskFree: string
  unknown: string
  facts: { computer: string; agents: string; projects: string; id: string; memory: string; workers: string; ready: string }
  noAgents: string
  noProjects: string
  /** Over the projects to pick, while none is. */
  pickProjects: string
  signedIn: string
  notSignedIn: string
  signIn: string
  signInHere: string
  signInSteps: {
    code: (page: string) => string
    copyCode: string
    openPage: string
    browser: string
    paste: string
    pasteHint: string
    send: string
    cancel: string
    starting: string
    /** The agent's own program, downloading to the worker first: how far, in whole percent. */
    getting: string
    /** Its sign-in in a terminal here, by the line that runs it on the worker. */
    terminal: string
    check: string
    checking: string
    notYet: string
  }
  /** How many of the home's workers are connected. */
  connected: (connected: number, all: number) => string
  noWorkers: string
  openTask: string
  remove: (name: string) => string
  removeLater: string
  /** Under Remove, for one gone offline during a task. */
  removeStranded: string
  /** Where this connection can't take workers out, as a window on a device paired over the network can't: who can. */
  removeElsewhere: (home: string) => string
  removeTitle: (name: string) => string
  removeNote: (home: string) => string
  /** For a worker its home set up: it takes itself off its computer. */
  removeOff: (home: string) => string
  /** For one of those offline now: when it does, and the line that does it there now. */
  removeOffline: (home: string) => string
  removeConfirm: string
  cancel: string
  addTitle: (home: string) => string
  addNote: string
  steps: { listen: string; enroll: string; agents: string; start: string }
  /** On a home in this app: its own command line. */
  commands: { listen: string; enroll: string; agents: string; start: string }
  /** On a Linux home of its own: what differs, run there with althar-host. */
  hostSteps: { listen: string; enroll: string }
  hostCommands: { listen: string; enroll: string }
  addWaiting: string
  done: string
}

export const computersText: ComputersText = {
  computers: 'Computers',
  home: 'Home',
  homeLine: 'Keeps your projects',
  worker: 'Worker',
  workers: 'Workers',
  cloud: 'Cloud',
  add: 'Add a worker',
  addLine: 'A Linux computer this home runs tasks on',
  reading: 'Reading…',
  state: { working: 'At work', free: 'Free', full: 'Full', offline: 'Offline' },
  stateLine: (worker) => {
    switch (worker.state) {
      case 'working':
        return worker.task === null ? 'Running a task' : `${worker.task.title} · ${worker.task.project}`
      case 'free':
        // Free, but its check found what stops a task there: said below, on its Ready line.
        return worker.unready === undefined ? 'Ready for a task' : 'Can’t take a task yet'
      case 'full':
        return 'Out of memory or disk space'
      case 'offline':
        return worker.stranded === true && worker.task !== null ? `Went offline during ${worker.task.title}` : 'Not connected to this home'
    }
  },
  memoryFree: 'Memory free',
  diskFree: 'Disk free',
  unknown: 'Not reported yet',
  facts: {
    computer: 'Computer',
    agents: 'Agents',
    projects: 'Projects',
    id: 'Worker ID',
    memory: 'Memory',
    workers: 'Workers',
    ready: 'Ready',
  },
  noAgents: 'None it has said',
  noProjects: 'None yet',
  pickProjects: 'Pick the projects it works on. It takes no tasks until one is picked.',
  signedIn: 'Signed in',
  notSignedIn: 'Not signed in',
  signIn: 'Sign in',
  signInHere: 'Sign in on the worker itself: this window can’t reach it over SSH.',
  signInSteps: {
    code: (page) => `Enter this code at ${page}`,
    copyCode: 'Copy code',
    openPage: 'Open the page',
    browser: 'Approve it in your browser. Where the page shows a code, paste it here.',
    paste: 'Code from the page',
    pasteHint: 'Paste the code the page shows',
    send: 'Continue',
    cancel: 'Cancel',
    starting: 'Starting its sign-in…',
    getting: 'Downloading to the worker',
    terminal: 'Run this in a terminal, sign in there, then check.',
    check: 'Check',
    checking: 'Checking…',
    notYet: 'Not signed in yet',
  },
  connected: (connected, all) => `${connected} of ${all} connected`,
  noWorkers: 'None',
  openTask: 'Open its task',
  remove: (name) => `Remove ${name}`,
  removeLater: 'You can remove it once its task finishes.',
  removeStranded: 'It went offline during a task. Start it again so it can stop that work, then remove it.',
  removeElsewhere: (home) => `From a paired device, this window can’t remove workers. A window on ${home} itself, or over SSH, can.`,
  removeTitle: (name) => `Remove ${name}?`,
  removeNote: (home) => `It gets no more tasks from ${home}, and its key isn’t accepted again. To bring it back, add it again.`,
  removeOff: (home) =>
    `It gets no more tasks from ${home}, and takes itself off its computer: its service, its checkouts and its releases. Its agents stay signed in there. To bring it back, add it again.`,
  removeOffline: (home) => `It’s offline, so it does that once it next reaches ${home}. To do it now, run this on it:`,
  removeConfirm: 'Remove',
  cancel: 'Cancel',
  addTitle: (home) => `Add a worker to ${home}`,
  addNote:
    'A worker is a Linux computer this home runs tasks on, one at a time. This home takes workers by its own certificates: set one up with Althar’s command line.',
  steps: {
    listen: 'Let this home take workers, then restart Althar.',
    enroll: 'Enroll the worker’s certificate for each project it may work on.',
    agents: 'On the worker, sign in to the agent, install its ACP adapter, and say which project it works on.',
    start:
      'Start the worker at a name the home’s certificate covers, with the home and worker IDs enrolling printed, and leave it running.',
  },
  commands: {
    listen: 'althar workers configure --address <private-ip> --ca home-ca.pem --certificate home.pem --key home.key',
    enroll: 'althar workers enroll --certificate worker.pem --project <project-id>',
    agents:
      "umask 077; mkdir -p ~/althar-worker/workspaces && printf '%s\\n%s\\t%s\\t%s\\n' ~/althar-worker/workspaces <project-id> codex </path/to/acp-adapter> > ~/althar-worker/agents.conf",
    start:
      './althar-worker https://<home-name>:6770 <home-id> <worker-id> ca.pem client.pem client.key ~/althar-worker/journal --agent-config ~/althar-worker/agents.conf --watch',
  },
  hostSteps: {
    listen: 'On the home, let it take workers at a private address they reach, then restart it.',
    enroll: 'On the home, enroll the worker’s certificate for each project it may work on, then read the home’s ID.',
  },
  hostCommands: {
    listen:
      'althar-host configure-workers --listen-address <private-ip> --worker-ca ca.pem --tls-certificate home.pem --tls-key home.key && systemctl --user restart althar-host.service',
    enroll:
      'althar-host enroll-worker --worker-certificate client.pem --project-id <project-id> --json && althar-host status --wait --json',
  },
  addWaiting: 'It shows here once it connects.',
  done: 'Done',
}

/** Out of reach, or out of room: said in the danger colour. */
const troubled = (state: WorkerState) => state === 'offline' || state === 'full'

/** What takes a worker its home set up off its computer, run there as its login (apps/worker/src/uninstall.rs). */
export const UNINSTALL = '"${XDG_DATA_HOME:-$HOME/.local/share}/althar-worker-program/current/althar-worker" uninstall'

/** A computer's head: its round picture, the home's in ink and one out of reach in red; its name and a line; the way in. */
function Head({
  picture,
  name,
  line,
  tone,
  end,
}: {
  picture: IconName
  name: string
  line: string
  tone?: 'home' | 'away'
  end?: ReactNode
}) {
  return (
    <span className={s.head}>
      <span className={cx(s.picture, tone === 'home' && s.pictureHome, tone === 'away' && s.pictureAway)} aria-hidden="true">
        <Icon name={picture} size={16} />
      </span>
      <span className={s.names}>
        <span className={s.name}>{name}</span>
        <span className={s.kindLine}>{line}</span>
      </span>
      {end}
      <Icon name="chevron" size={11} className={s.chevron} />
    </span>
  )
}

/** A figure in a worker's glance: its name, then what it is. */
function Reading({ name, figure }: { name: string; figure: string }) {
  return (
    <span className={s.reading}>
      <span>{name}</span>
      <span className={s.readingFigure}>{figure}</span>
    </span>
  )
}

/** Where a worker stands, big, and a line under it: the task it runs, or what is off. */
function Standing({ worker, t }: { worker: ComputerWorker; t: ComputersText }) {
  // While its updater runs it takes no task: said big, where Free or At work would be, with its step under it.
  const updating = worker.update?.state === 'running'
  return (
    <span className={s.standing}>
      <span className={cx(s.state, !updating && troubled(worker.state) && s.danger)}>
        {updating ? workerUpdateText.updating : t.state[worker.state]}
      </span>
      <span className={s.line}>{updating ? shortUpdate(worker.update, worker.name) : t.stateLine(worker)}</span>
    </span>
  )
}

/**
 * Its update, in a line at its module's foot: none while it's on the newest, or Updating says it. Under a strip that
 * says it already, quiet: nothing where the strip is about this worker alone, else only what differs from its offer.
 */
function ReleaseLine({ worker, quiet }: { worker: ComputerWorker; quiet: 'none' | 'offer' | 'all' }) {
  const { update } = worker
  if (update === undefined || update.state === 'running' || quiet === 'all') return null
  if (quiet === 'offer' && update.state === 'offer') return null
  const words = shortUpdate(update, worker.name)
  if (update.state === 'failed')
    return (
      <Problem as="span" size="small" className={s.releaseProblem}>
        {words}
      </Problem>
    )
  const tone = update.state === 'done' ? 'ok' : update.state === 'offer' ? 'offer' : 'wait'
  return (
    <span className={s.release} data-tone={tone}>
      <Icon name={tone === 'ok' ? 'check' : tone === 'offer' ? 'download' : 'clock'} size={12} />
      {words}
    </span>
  )
}

/** What it has free, while it says. */
function Free({ worker, t }: { worker: ComputerWorker; t: ComputersText }) {
  if (worker.memoryFree === null && worker.diskFree === null) return null
  return (
    <span className={s.readings}>
      {worker.memoryFree !== null && <Reading name={t.memoryFree} figure={worker.memoryFree} />}
      {worker.diskFree !== null && <Reading name={t.diskFree} figure={worker.diskFree} />}
    </span>
  )
}

/** The kit's module, on the page's paper: a third of the row, or the whole of it. */
function Module({ wide = false, onClick, children }: { wide?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx(cc.module, cc.opens, s.module, !wide && s.third)} onClick={onClick}>
      {children}
    </button>
  )
}

export interface ComputersProps {
  home: ComputerHome
  /** Null before they are read. */
  workers: ComputerWorkers | null
  /** Althar Cloud's use this month, where the home has it: its line under Cloud opens its own page (`onCloud`). */
  cloud?: CloudUse | null | undefined
  onCloud?: (() => void) | undefined
  /** The computer opened out: the home (`HOME`) or a worker, by its id; null for all of them. */
  opened: string | null
  onOpen: (id: string | null) => void
  onAdd: () => void
  /** Takes a worker out of the home, once the person says so. */
  onRemove: (id: string) => void
  /** Whether this connection may take workers out: a window on a device paired over the network may not. */
  canRemove?: boolean | undefined
  /** Opens the task a worker runs. */
  onTask?: ((id: string) => void) | undefined
  /** Asks these workers to update now; without it, their updates are only said. */
  onUpdate?: ((ids: readonly string[]) => void) | undefined
  /** Takes back an update asked of a worker that hasn't started. */
  onCancelUpdate?: ((id: string) => void) | undefined
  /** The newest release published, where it's known: beside a worker's own, opened out. */
  newest?: string | undefined
  /** The home's projects, for a worker's projects to be picked from. */
  allProjects?: readonly { id: string; name: string }[] | undefined
  /** The projects a worker works on, as the person picks them; none where this connection can't. */
  onProjects?: ((id: string, projectIds: readonly string[]) => void) | undefined
  /** Signs one of a worker's agents in, on the worker; none where this window can't. */
  onSignIn?: ((id: string, agent: string) => void) | undefined
  /** An agent's sign-in under way on a worker. */
  signingIn?: WorkerSignInView | null | undefined
  onPaste?: ((code: string) => void) | undefined
  /** Reads who is signed in again, for an agent signed in in a terminal on the worker. */
  onCheckSignIn?: (() => void) | undefined
  onCancelSignIn?: (() => void) | undefined
  /** Opens a sign-in's page in the person's browser. */
  onOpenLink?: ((url: string) => void) | undefined
  /** The home's own settings, opened out: its Agents at once. */
  homeSettings?: ReactNode
  /** How many readings the home's trace has room for. */
  slots?: number | undefined
  text?: Partial<ComputersText> | undefined
}

/** Settings › Computers: the home, its workers and, where it has it, Althar Cloud; a computer opened out in place. */
export function Computers({
  home,
  workers,
  cloud,
  onCloud,
  opened,
  onOpen,
  onAdd,
  onRemove,
  canRemove = true,
  onTask,
  onUpdate,
  onCancelUpdate,
  newest,
  allProjects,
  onProjects,
  onSignIn,
  signingIn,
  onPaste,
  onCheckSignIn,
  onCancelSignIn,
  onOpenLink,
  homeSettings,
  slots,
  text,
}: ComputersProps) {
  const t = { ...computersText, ...text }
  const list = workers?.list ?? []
  const worker = list.find((one) => one.id === opened)
  const fleet = fleetUpdate(list)
  // Under the fleet's strip, a module says only what the strip doesn't.
  const quiet = fleet === null ? 'none' : list.filter((one) => one.update !== undefined).length === 1 ? 'all' : 'offer'
  if (opened === HOME)
    return (
      <div className={s.computers}>
        <HomeSheet home={home} workers={workers} settings={homeSettings} slots={slots} onBack={() => onOpen(null)} t={t} />
      </div>
    )
  if (worker !== undefined)
    return (
      <div className={s.computers}>
        <WorkerSheet
          worker={worker}
          home={home.name}
          onBack={() => onOpen(null)}
          onRemove={canRemove ? () => onRemove(worker.id) : null}
          onTask={onTask}
          onUpdate={onUpdate}
          onCancelUpdate={onCancelUpdate}
          newest={newest}
          allProjects={allProjects}
          onProjects={onProjects === undefined ? undefined : (ids) => onProjects(worker.id, ids)}
          onSignIn={onSignIn === undefined ? undefined : (agent) => onSignIn(worker.id, agent)}
          signingIn={signingIn?.workerId === worker.id ? signingIn : null}
          onPaste={onPaste}
          onCheckSignIn={onCheckSignIn}
          onCancelSignIn={onCancelSignIn}
          onOpenLink={onOpenLink}
          t={t}
        />
      </div>
    )
  return (
    <div className={s.computers}>
      <SettingGroup className={s.group} title={t.home}>
        <div className={s.grid}>
          <Module wide onClick={() => onOpen(HOME)}>
            <Head picture="house" name={home.name} line={t.homeLine} tone="home" />
            {home.load === null ? (
              <span className={s.line}>{t.reading}</span>
            ) : (
              <LoadReadings load={home.load} agents={home.agents} slots={slots} along />
            )}
          </Module>
        </div>
      </SettingGroup>
      <SettingGroup
        className={s.group}
        title={t.workers}
        {...(list.length > 0 ? { action: <LinkButton onClick={onAdd}>{t.add}</LinkButton> } : {})}
      >
        <div className={s.workers}>
          {fleet !== null && <WorkerUpdateStrip fleet={fleet} onUpdate={onUpdate} onCancel={onCancelUpdate} />}
          <div className={s.grid}>
            {workers === null ? (
              <span className={s.line}>{t.reading}</span>
            ) : list.length === 0 ? (
              <AddTile onClick={onAdd} className={s.add}>
                <span className={s.addWords}>
                  <span>{t.add}</span>
                  <span className={s.addLine}>{t.addLine}</span>
                </span>
              </AddTile>
            ) : (
              list.map((one) => (
                <Module key={one.id} onClick={() => onOpen(one.id)}>
                  <Head
                    picture="worker"
                    name={one.name}
                    line={one.kind ?? t.unknown}
                    {...(one.state === 'offline' ? { tone: 'away' as const } : {})}
                  />
                  <span className={s.glance}>
                    <Standing worker={one} t={t} />
                    <Free worker={one} t={t} />
                  </span>
                  <ReleaseLine worker={one} quiet={quiet} />
                </Module>
              ))
            )}
          </div>
        </div>
      </SettingGroup>
      {cloud != null && onCloud !== undefined && (
        <SettingGroup className={s.group} title={t.cloud}>
          <div className={s.grid}>
            <CloudLine use={cloud} onClick={onCloud} />
          </div>
        </SettingGroup>
      )}
    </div>
  )
}

/** The home opened out: its readings beside what it is, then its own settings. */
function HomeSheet({
  home,
  workers,
  settings,
  slots,
  onBack,
  t,
}: {
  home: ComputerHome
  workers: ComputerWorkers | null
  settings: ReactNode
  slots: number | undefined
  onBack: () => void
  t: ComputersText
}) {
  const list = workers?.list ?? []
  return (
    <div className={tt.opened}>
      <ControlDetail title={home.name} onBack={onBack} text={{ back: t.computers }} aside={t.home}>
        <div className={s.body}>
          <div className={cx(tt.sheet, s.sheetGlance)}>
            <div className={s.sheetReadings}>
              {home.load === null ? (
                <span className={s.line}>{t.reading}</span>
              ) : (
                <LoadReadings load={home.load} agents={home.agents} slots={slots} />
              )}
            </div>
            <div className={s.facts}>
              {home.load !== null && <SheetFact label={t.facts.memory}>{home.load.memoryTotal}</SheetFact>}
              <SheetFact label={t.facts.workers}>
                {list.length === 0 ? t.noWorkers : t.connected(list.filter((one) => one.state !== 'offline').length, list.length)}
              </SheetFact>
            </div>
          </div>
          {settings !== undefined && settings !== null && <div className={cx(tt.sheet, s.settings)}>{settings}</div>}
        </div>
      </ControlDetail>
    </div>
  )
}

/** A worker opened out: where it stands and what it has free beside what it is; taking it out apart at the foot. */
function WorkerSheet({
  worker,
  home,
  onBack,
  onRemove,
  onTask,
  onUpdate,
  onCancelUpdate,
  newest,
  allProjects,
  onProjects,
  onSignIn,
  signingIn,
  onPaste,
  onCheckSignIn,
  onCancelSignIn,
  onOpenLink,
  t,
}: {
  worker: ComputerWorker
  home: string
  onBack: () => void
  /** Null where this connection can't take workers out. */
  onRemove: (() => void) | null
  onTask: ((id: string) => void) | undefined
  onUpdate: ((ids: readonly string[]) => void) | undefined
  onCancelUpdate: ((id: string) => void) | undefined
  newest: string | undefined
  allProjects: readonly { id: string; name: string }[] | undefined
  onProjects: ((projectIds: readonly string[]) => void) | undefined
  onSignIn: ((agent: string) => void) | undefined
  signingIn: WorkerSignInView | null
  onPaste: ((code: string) => void) | undefined
  onCheckSignIn: (() => void) | undefined
  onCancelSignIn: (() => void) | undefined
  onOpenLink: ((url: string) => void) | undefined
  t: ComputersText
}) {
  // Its projects are picked here where its home set it up and this connection may; else named, as its operator gave them.
  const picking = worker.managed === true && onProjects !== undefined && allProjects !== undefined && allProjects.length > 0
  const [asking, setAsking] = useState(false)
  const { task } = worker
  // A worker at work keeps its task: taking it out under it would leave the task without its checkout. So does one gone
  // offline during a task, until it says that work stopped.
  const working = worker.state === 'working'
  const stranded = !working && worker.stranded === true
  const why = onRemove === null ? t.removeElsewhere(home) : working ? t.removeLater : stranded ? t.removeStranded : null
  const update = fleetUpdate([worker])
  return (
    <div className={tt.opened}>
      <ControlDetail title={worker.name} onBack={onBack} text={{ back: t.computers }} aside={t.worker}>
        <div className={s.body}>
          {update !== null && <WorkerUpdateStrip fleet={update} onUpdate={onUpdate} onCancel={onCancelUpdate} />}
          <div className={cx(tt.sheet, s.sheetGlance)}>
            <div className={s.sheetReadings}>
              <Standing worker={worker} t={t} />
              {task !== null && onTask !== undefined && (
                <LinkButton className={s.taskLink} onClick={() => onTask(task.id)}>
                  {t.openTask}
                </LinkButton>
              )}
              <Free worker={worker} t={t} />
            </div>
            <div className={s.facts}>
              <SheetFact label={t.facts.computer}>{worker.kind ?? t.unknown}</SheetFact>
              {worker.release !== undefined && (
                <SheetFact label={workerUpdateText.release}>
                  <span className={s.releaseFact}>
                    {worker.release}
                    {newest !== undefined && newest !== worker.release && worker.update !== undefined && (
                      <span className={s.factNote}>{workerUpdateText.out(newest)}</span>
                    )}
                  </span>
                </SheetFact>
              )}
              {worker.unready !== undefined && (
                <SheetFact label={t.facts.ready}>
                  <span className={s.stopped}>
                    <Problem as="span" size="small">
                      {worker.unready.title}
                    </Problem>
                    {worker.unready.body !== undefined && <span className={s.addressHint}>{worker.unready.body}</span>}
                    {worker.unready.command !== undefined && (
                      <span className={s.lineToRun}>
                        <Code className={s.lineToRunText}>{worker.unready.command}</Code>
                        <CopyButton value={worker.unready.command} ghost />
                      </span>
                    )}
                  </span>
                </SheetFact>
              )}
              <SheetFact label={t.facts.agents}>
                {worker.agents.length === 0 ? (
                  t.noAgents
                ) : worker.agents.some((agent) => agent.signedIn !== undefined) ? (
                  <Agents
                    worker={worker}
                    onSignIn={onSignIn}
                    signingIn={signingIn}
                    onPaste={onPaste}
                    onCheck={onCheckSignIn}
                    onCancel={onCancelSignIn}
                    onOpenLink={onOpenLink}
                    t={t}
                  />
                ) : (
                  <span className={s.marks}>
                    {worker.agents.map((agent) => (
                      <span key={agent.name} className={s.inline}>
                        {agent.mark !== undefined && <BrandMark brand={agent.mark} size={13} />}
                        {agent.name}
                      </span>
                    ))}
                  </span>
                )}
              </SheetFact>
              <SheetFact label={t.facts.projects}>
                {picking ? (
                  <div className={s.agentRows}>
                    {(worker.projectIds ?? []).length === 0 && <span className={s.addressHint}>{t.pickProjects}</span>}
                    <CheckList
                      label={t.facts.projects}
                      className={s.projectsPick}
                      items={allProjects.map((project) => ({ id: project.id, label: project.name }))}
                      value={worker.projectIds ?? []}
                      onChange={onProjects}
                    />
                  </div>
                ) : worker.projects.length === 0 ? (
                  t.noProjects
                ) : (
                  worker.projects.join(', ')
                )}
              </SheetFact>
              <SheetFact label={t.facts.id}>
                <span className={s.inline}>
                  <Code className={s.id}>{worker.id}</Code>
                  <CopyButton value={worker.id} ghost />
                </span>
              </SheetFact>
            </div>
          </div>
          <div className={cx(tt.foot, s.foot)}>
            {why !== null && <span className={s.line}>{why}</span>}
            <LinkButton className={tt.danger} disabled={why !== null} onClick={() => setAsking(true)}>
              {t.remove(worker.name)}
            </LinkButton>
          </div>
        </div>
      </ControlDetail>
      {asking && (
        <Dialog
          title={t.removeTitle(worker.name)}
          description={worker.managed === true ? t.removeOff(home) : t.removeNote(home)}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button onClick={() => setAsking(false)}>{t.cancel}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setAsking(false)
                  onRemove?.()
                }}
              >
                {t.removeConfirm}
              </Button>
            </>
          }
        >
          {worker.managed === true && worker.state === 'offline' && (
            <div className={s.leftToDo}>
              <span className={s.addressHint}>{t.removeOffline(home)}</span>
              <span className={s.lineToRun}>
                <Code className={s.lineToRunText}>{UNINSTALL}</Code>
                <CopyButton value={UNINSTALL} ghost />
              </span>
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}

/** An agent's sign-in on a worker, as its steps come. */
export interface WorkerSignInView {
  workerId: string
  agent: string
  step:
    | { kind: 'starting' }
    /** Its own program, downloading to the worker before its sign-in starts. */
    | { kind: 'getting'; percent: number }
    /** Its sign-in is its own command: the line that runs it on the worker, for a terminal here, then Check. */
    | { kind: 'terminal'; command: string; checking?: boolean; notYet?: boolean }
    | { kind: 'code'; code: string; page: string }
    | { kind: 'browser'; link: string | null; paste: boolean; refused?: string | null | undefined }
    | { kind: 'failed'; message: string }
}

/** A worker's agents, each signed in or not, with Sign in; the sign-in under way under its agent. */
function Agents({
  worker,
  onSignIn,
  signingIn,
  onPaste,
  onCheck,
  onCancel,
  onOpenLink,
  t,
}: {
  worker: ComputerWorker
  onSignIn: ((agent: string) => void) | undefined
  signingIn: WorkerSignInView | null
  onPaste: ((code: string) => void) | undefined
  onCheck: (() => void) | undefined
  onCancel: (() => void) | undefined
  onOpenLink: ((url: string) => void) | undefined
  t: ComputersText
}) {
  const [pasted, setPasted] = useState('')
  const canSignIn = onSignIn !== undefined && worker.reachable === true && worker.state !== 'offline'
  return (
    <div className={s.agentRows}>
      {worker.agents.map((agent) => {
        const signing = signingIn !== null && agent.id !== undefined && signingIn.agent === agent.id ? signingIn : null
        return (
          <div key={agent.name} className={s.agentRows}>
            <span className={s.agentRow}>
              <span className={s.inline}>
                {agent.mark !== undefined && <BrandMark brand={agent.mark} size={13} />}
                {agent.name}
              </span>
              {agent.signedIn === true ? (
                <span className={s.agentState}>{t.signedIn}</span>
              ) : canSignIn && agent.id !== undefined && signing === null ? (
                <LinkButton onClick={() => onSignIn(agent.id ?? '')}>{t.signIn}</LinkButton>
              ) : (
                <span className={s.agentState}>{t.notSignedIn}</span>
              )}
            </span>
            {signing !== null && (
              <div className={s.signInStep}>
                {signing.step.kind === 'starting' && (
                  <span className={s.making}>
                    <Spinner size="small" />
                    {t.signInSteps.starting}
                  </span>
                )}
                {signing.step.kind === 'getting' && (
                  <span className={s.making}>
                    <Spinner size="small" />
                    {t.signInSteps.getting}
                    <span className={s.percent}>{`${signing.step.percent}%`}</span>
                  </span>
                )}
                {signing.step.kind === 'terminal' && (
                  <>
                    <span className={s.addressHint}>{t.signInSteps.terminal}</span>
                    <span className={s.commandRow}>
                      <code className={s.signInCommand}>{signing.step.command}</code>
                      <CopyButton value={signing.step.command} ghost />
                    </span>
                    <span className={s.signInRow}>
                      {onCheck !== undefined && (
                        <LinkButton onClick={onCheck} disabled={signing.step.checking === true}>
                          {signing.step.checking === true ? t.signInSteps.checking : t.signInSteps.check}
                        </LinkButton>
                      )}
                      {signing.step.notYet === true && <span className={s.agentState}>{t.signInSteps.notYet}</span>}
                    </span>
                  </>
                )}
                {signing.step.kind === 'code' && (
                  <>
                    <span className={s.addressHint}>{t.signInSteps.code(signing.step.page.replace(/^https:\/\//u, ''))}</span>
                    <span className={s.signInRow}>
                      <span className={s.signInCode}>{signing.step.code}</span>
                      <CopyButton value={signing.step.code} ghost />
                      <LinkButton onClick={() => signing.step.kind === 'code' && onOpenLink?.(signing.step.page)}>
                        {t.signInSteps.openPage}
                      </LinkButton>
                    </span>
                  </>
                )}
                {signing.step.kind === 'browser' && (
                  <>
                    <span className={s.addressHint}>{t.signInSteps.browser}</span>
                    {signing.step.link !== null && (
                      <span className={s.signInRow}>
                        <LinkButton
                          onClick={() => signing.step.kind === 'browser' && signing.step.link !== null && onOpenLink?.(signing.step.link)}
                        >
                          {t.signInSteps.openPage}
                        </LinkButton>
                      </span>
                    )}
                    {signing.step.paste && onPaste !== undefined && (
                      <form
                        className={s.pasteRow}
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (pasted.trim() === '') return
                          onPaste(pasted.trim())
                          setPasted('')
                        }}
                      >
                        <Field
                          aria-label={t.signInSteps.paste}
                          placeholder={t.signInSteps.pasteHint}
                          value={pasted}
                          onChange={(event) => setPasted(event.target.value)}
                          className={s.address}
                        />
                        <Button type="submit" disabled={pasted.trim() === ''}>
                          {t.signInSteps.send}
                        </Button>
                      </form>
                    )}
                    {signing.step.refused != null && (
                      <Problem as="span" size="small">
                        {signing.step.refused}
                      </Problem>
                    )}
                  </>
                )}
                {signing.step.kind === 'failed' && (
                  <Problem as="span" size="small">
                    {signing.step.message}
                  </Problem>
                )}
                {signing.step.kind !== 'failed' && onCancel !== undefined && (
                  <span className={s.signInRow}>
                    <LinkButton onClick={onCancel}>{t.signInSteps.cancel}</LinkButton>
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
      {onSignIn !== undefined && worker.reachable !== true && worker.agents.some((agent) => agent.signedIn === false) && (
        <span className={s.addressHint}>{t.signInHere}</span>
      )}
    </div>
  )
}

/** A step of adding a worker: what to do, and the line to run for it, to copy. */
function Step({ n, words, command }: { n: number; words: string; command: string }) {
  return (
    <li className={s.step}>
      <span className={s.stepWords}>
        <span className={s.stepN}>{n}</span>
        {words}
      </span>
      <span className={s.command}>
        <Code className={s.commandLine}>{command}</Code>
        <CopyButton value={command} ghost />
      </span>
    </li>
  )
}

export interface AddWorkerByHandDialogProps {
  /** The home it joins, by name. */
  home: string
  /** Whether the home takes workers already: without, the first step lets it. */
  enabled: boolean
  /** A Linux home of its own, set up there with althar-host, rather than the home in this app. */
  standalone?: boolean | undefined
  onClose: () => void
  text?: Partial<ComputersText> | undefined
}

/**
 * Add a worker to a home that takes workers only by its operator's certificates: what it takes, a step a line to run,
 * and that it shows in Computers once it connects. A home that is its own authority has `AddWorkerDialog` instead.
 */
export function AddWorkerByHandDialog({ home, enabled, standalone = false, onClose, text }: AddWorkerByHandDialogProps) {
  const t = { ...computersText, ...text }
  const listen = standalone
    ? { words: t.hostSteps.listen, command: t.hostCommands.listen }
    : { words: t.steps.listen, command: t.commands.listen }
  const steps = [
    ...(enabled ? [] : [listen]),
    standalone ? { words: t.hostSteps.enroll, command: t.hostCommands.enroll } : { words: t.steps.enroll, command: t.commands.enroll },
    { words: t.steps.agents, command: t.commands.agents },
    { words: t.steps.start, command: t.commands.start },
  ]
  return (
    <Dialog
      title={t.addTitle(home)}
      description={t.addNote}
      onClose={onClose}
      actions={<Button onClick={onClose}>{t.done}</Button>}
      width={560}
    >
      <ol className={s.steps}>
        {steps.map((step, i) => (
          <Step key={step.command} n={i + 1} words={step.words} command={step.command} />
        ))}
      </ol>
      <span className={s.waiting}>{t.addWaiting}</span>
    </Dialog>
  )
}
