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
import { Dialog } from '../../primitives/Dialog/Dialog'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { ControlDetail } from '../ControlCenter/ControlCenter'
import cc from '../ControlCenter/ControlCenter.module.css'
import { SettingGroup } from '../Preferences/Preferences'
import { AddTile, SheetFact } from '../ToolTiles/ToolParts'
import tt from '../ToolTiles/ToolTiles.module.css'
import { CloudLine, type CloudUse } from './Cloud'
import s from './Computers.module.css'

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
  /** The agents it can run, by name, each with its mark where it has one. */
  agents: readonly { name: string; mark?: Brand | undefined }[]
  /** The projects it may work on, by name. */
  projects: readonly string[]
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
  facts: { computer: string; agents: string; projects: string; id: string; memory: string; workers: string }
  noAgents: string
  noProjects: string
  /** How many of the home's workers are connected. */
  connected: (connected: number, all: number) => string
  noWorkers: string
  openTask: string
  remove: (name: string) => string
  removeLater: string
  removeTitle: (name: string) => string
  removeNote: (home: string) => string
  removeConfirm: string
  cancel: string
  addTitle: (home: string) => string
  addNote: string
  steps: { listen: string; enroll: string; start: string }
  commands: { listen: string; enroll: string; start: string }
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
        return 'Ready for a task'
      case 'full':
        return 'Out of memory or disk space'
      case 'offline':
        return 'Not connected to this home'
    }
  },
  memoryFree: 'Memory free',
  diskFree: 'Disk free',
  unknown: 'Not reported yet',
  facts: { computer: 'Computer', agents: 'Agents', projects: 'Projects', id: 'Worker ID', memory: 'Memory', workers: 'Workers' },
  noAgents: 'None it has said',
  noProjects: 'None yet',
  connected: (connected, all) => `${connected} of ${all} connected`,
  noWorkers: 'None',
  openTask: 'Open its task',
  remove: (name) => `Remove ${name}`,
  removeLater: 'You can remove it once its task finishes.',
  removeTitle: (name) => `Remove ${name}?`,
  removeNote: (home) =>
    `It gets no more tasks from ${home}, and its certificate isn’t accepted again. To bring it back, enroll a new certificate.`,
  removeConfirm: 'Remove',
  cancel: 'Cancel',
  addTitle: (home) => `Add a worker to ${home}`,
  addNote:
    'A worker is a Linux computer this home runs tasks on, one at a time. For now, you set one up with certificates and Althar’s command line.',
  steps: {
    listen: 'Let this home take workers, then restart Althar.',
    enroll: 'Enroll the worker’s certificate for each project it may work on.',
    start: 'On the worker, start it with the home and worker IDs enrolling printed.',
  },
  commands: {
    listen: 'althar workers configure --address <private-ip> --ca home-ca.pem --certificate home.pem --key home.key',
    enroll: 'althar workers enroll --certificate worker.pem --project <project-id>',
    start: './althar-worker https://<home>:6770 <home-id> <worker-id> ca.pem client.pem client.key ~/althar-worker-journal',
  },
  addWaiting: 'It shows here once it connects.',
  done: 'Done',
}

/** Out of reach, or out of room: said in the danger colour. */
const troubled = (state: WorkerState) => state === 'offline' || state === 'full'

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
  return (
    <span className={s.standing}>
      <span className={cx(s.state, troubled(worker.state) && s.danger)}>{t.state[worker.state]}</span>
      <span className={s.line}>{t.stateLine(worker)}</span>
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
  /** Opens the task a worker runs. */
  onTask?: ((id: string) => void) | undefined
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
  onTask,
  homeSettings,
  slots,
  text,
}: ComputersProps) {
  const t = { ...computersText, ...text }
  const list = workers?.list ?? []
  const worker = list.find((one) => one.id === opened)
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
          onRemove={() => onRemove(worker.id)}
          onTask={onTask}
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
              </Module>
            ))
          )}
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
  t,
}: {
  worker: ComputerWorker
  home: string
  onBack: () => void
  onRemove: () => void
  onTask: ((id: string) => void) | undefined
  t: ComputersText
}) {
  const [asking, setAsking] = useState(false)
  const { task } = worker
  // A worker at work keeps its task: taking it out under it would leave the task without its checkout.
  const working = worker.state === 'working'
  return (
    <div className={tt.opened}>
      <ControlDetail title={worker.name} onBack={onBack} text={{ back: t.computers }} aside={t.worker}>
        <div className={s.body}>
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
              <SheetFact label={t.facts.agents}>
                {worker.agents.length === 0 ? (
                  t.noAgents
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
              <SheetFact label={t.facts.projects}>{worker.projects.length === 0 ? t.noProjects : worker.projects.join(', ')}</SheetFact>
              <SheetFact label={t.facts.id}>
                <span className={s.inline}>
                  <Code className={s.id}>{worker.id}</Code>
                  <CopyButton value={worker.id} ghost />
                </span>
              </SheetFact>
            </div>
          </div>
          <div className={cx(tt.foot, s.foot)}>
            {working && <span className={s.line}>{t.removeLater}</span>}
            <LinkButton className={tt.danger} disabled={working} onClick={() => setAsking(true)}>
              {t.remove(worker.name)}
            </LinkButton>
          </div>
        </div>
      </ControlDetail>
      {asking && (
        <Dialog
          title={t.removeTitle(worker.name)}
          description={t.removeNote(home)}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button onClick={() => setAsking(false)}>{t.cancel}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setAsking(false)
                  onRemove()
                }}
              >
                {t.removeConfirm}
              </Button>
            </>
          }
        />
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

export interface AddWorkerDialogProps {
  /** The home it joins, by name. */
  home: string
  /** Whether the home takes workers already: without, the first step lets it. */
  enabled: boolean
  onClose: () => void
  text?: Partial<ComputersText> | undefined
}

/** Add a worker: what it takes, a step a line to run, and that it shows in Computers once it connects. */
export function AddWorkerDialog({ home, enabled, onClose, text }: AddWorkerDialogProps) {
  const t = { ...computersText, ...text }
  const steps = [
    ...(enabled ? [] : [{ words: t.steps.listen, command: t.commands.listen }]),
    { words: t.steps.enroll, command: t.commands.enroll },
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
