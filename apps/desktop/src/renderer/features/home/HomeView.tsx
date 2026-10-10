import { type DragEvent, useEffect, useState } from 'react'

import type { HomeCall, HomeEvent, HomeTask, ProjectSummary } from '@althar/contracts'
import { AskAnswered, AskNote, type IconName, ProjectInk, type ProjectRef, TaskStatus } from '@althar/ui'
import { Home, type HomeEvent as HomeLine, type HomeNeed, type HomeProject, type HomeRun } from '@althar/ui/screens'

import { ago, clock, useNow } from '../../shared/time'
import { BarEnd } from '../tabs/TabsFrame'
import type { EdgeGlance } from '../settings/EdgePicture'
import { SettingsPanel } from '../settings/SettingsPanel'
import type { StartModel } from '../start/useStart'
import s from './Home.module.css'
import type { HomeModel } from './useHome'
import { needLineOf, needsOf, needText, workOf } from './needs'

/*
 * The window you come back to, once there are projects: the kit's Home.
 * Across every project, what waits on you, answered where it is when a click
 * will do and opened as its task when it needs reading; what is in progress;
 * and what the loop did since you last left. Beside them, the projects, each
 * with its mark. The window's bar has only settings, as a panel from its
 * gear: how much needs you is the stream's first word, and which agents are
 * signed in is for settings, not the home. A task that waits on you is in
 * what needs you, not again in what is in progress. There is no composer:
 * coordinators belong to projects.
 */

export const text = {
  ...needText,
  allowed: (what: string) => `Allowed ${what}`,
  denied: (what: string) => `Didn’t allow ${what}`,
  answeredIn: (project: string) => `in ${project}`,
  lastWork: (when: string) => `Last task ${when}`,
  noWork: 'No tasks yet',
  /** Before the person ever left the home here, it shows the last day. */
  firstLook: 'the last day',
  event: {
    opened: (noun: string, number: string) => `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${number} opened`,
    implemented: 'Implement finished',
    passed: 'Review passed',
    found: (n: number) => (n === 1 ? 'Review found 1 issue' : `Review found ${n} issues`),
    asked: 'Review asked for changes',
    settled: 'Review settled',
    answered: (n: number) => (n === 1 ? 'Answered 1 permission ask' : `Answered ${n} permission asks`),
    coordinatorAnswered: (n: number) => (n === 1 ? 'Coordinator answered 1 permission ask' : `Coordinators answered ${n} permission asks`),
    withinRules: 'within the projects’ rules',
    since: (at: string) => `since ${at}`,
  },
}

/** A project's ink as the kit has it. */
const inkOf = (ink: ProjectSummary['ink']): ProjectInk => ink as ProjectInk

/** A project as the home draws it: its mark, from its id, which outlives its name; its ink; its name. */
export const refOf = (project: ProjectSummary): ProjectRef => ({ seed: project.id, ink: inkOf(project.ink), name: project.name })

/** How a task that isn't ready stands: running, waiting on a call, or stopped with no agent on it. */
const statusOf = (phase: HomeTask['phase']) =>
  phase === 'waiting' ? TaskStatus.Yours : phase === 'stopped' ? TaskStatus.Stopped : TaskStatus.Running

/** The first line of what a step reported. */
const firstLine = (summary: string) => summary.split('\n')[0] ?? ''

/** Something the loop did, as a line of the home: what, why or what came of it, whose and when. */
export const lineOf = (
  event: HomeEvent,
  projects: ReadonlyMap<string, ProjectRef>,
  now: Date = new Date(),
): Omit<HomeLine, 'id'> | undefined => {
  const t = text.event
  if (event.kind === 'answered')
    return {
      icon: 'lock',
      what: event.by === 'coordinator' ? t.coordinatorAnswered(event.count) : t.answered(event.count),
      detail: t.withinRules,
      at: t.since(clock(event.at, now)),
    }
  const project = projects.get(event.projectId)
  if (project === undefined) return undefined
  // The task is named by its title, quieter, after what happened to it.
  const said = (icon: IconName, what: string) => ({ project, icon, what, detail: event.task.title, at: clock(event.at, now) })
  if (event.kind === 'dealt') return said(event.about === 'limit' ? 'agents' : 'clock', event.title)
  const { result } = event
  switch (result.step) {
    case 'publish':
      return said(
        'pr',
        result.change === null ? firstLine(result.summary) : t.opened(result.change.noun, `${result.change.prefix}${result.change.number}`),
      )
    case 'implement':
      return said('file', t.implemented)
    case 'settle':
      return said('check', t.settled)
    case 'review':
      return said('check', result.verdict === 'pass' ? t.passed : result.findings.length > 0 ? t.found(result.findings.length) : t.asked)
  }
}

/** A call the person answered here, folded to a line until they leave. */
interface Answered {
  readonly said: string
  readonly denied: boolean
  readonly project: ProjectRef
}

export function HomeView({
  model,
  start,
  onProject,
  onTalk,
  onTask,
}: {
  model: HomeModel
  start: StartModel
  onProject: (projectId: string) => void
  /** Open a project's conversation with its coordinator. */
  onTalk: (projectId: string) => void
  onTask: (threadId: string) => void
}) {
  const home = model.home
  const now = useNow(true)
  const [answered, setAnswered] = useState<ReadonlyArray<Answered & { readonly id: string }>>([])
  const [settings, setSettings] = useState(false)
  const agents = start.status?.agents ?? []
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''

  const projects = home?.projects ?? []
  const refs = new Map(projects.map((project) => [project.id, refOf(project)]))
  const tasks = home?.tasks ?? []
  // In progress is every task not ready to accept; only those with an agent on them, or held for a reset, are running.
  const ready = tasks.filter((task) => task.phase === 'ready')
  const calls = (home?.calls ?? []).filter((call) => !answered.some((one) => one.id === call.id))
  // What has a card above isn't listed again under it.
  const carded = new Set(calls.map((call) => call.threadId))
  const working = tasks.filter((task) => task.phase !== 'ready' && !carded.has(task.threadId))
  const waiting = calls.length + ready.length

  const needs = needsOf({ calls, ready, refs, agentName: name })
  // What waits now, and how much is in progress, for Settings' pictures of the edge of the screen.
  const glance: EdgeGlance = { waiting, needs: needs.slice(0, 3), work: workOf(working) }

  const openFolder = () => void start.openFolder().then((opened) => opened !== null && onProject(opened.id))
  // ⌘N opens a folder, and ⌘, opens and closes settings. ⌘ and a number belongs to the window's tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.key === 'n') openFolder()
      else if (event.key === ',') setSettings((now) => !now)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const answer = (call: HomeCall, project: ProjectRef, decision: 'allow' | 'reject') => {
    const what = call.command ?? call.title
    setAnswered((now) => [
      ...now,
      {
        id: call.id,
        said: decision === 'allow' ? text.allowed(what) : text.denied(what),
        denied: decision === 'reject',
        project,
      },
    ])
    void model.answer(call.id, decision)
  }

  // What waits, each gathered under its project; a call answered here stays as a line until the person leaves.
  const waits: ReadonlyArray<HomeNeed> = [
    ...needs.map((need) => ({ key: need.id, project: need.project, line: needLineOf(need, { onOpen: onTask, onAnswer: answer }) })),
    ...answered.map((one) => ({
      key: one.id,
      project: one.project,
      line: (
        <AskAnswered said={one.said} denied={one.denied} focusOnMount>
          <AskNote>{text.answeredIn(one.project.name)}</AskNote>
        </AskAnswered>
      ),
    })),
  ]

  const runs: ReadonlyArray<HomeRun> = working.flatMap((task) => {
    const project = refs.get(task.projectId)
    // Held for a reset, it stands still though its phase is running.
    const status = task.waits !== null ? TaskStatus.Paused : statusOf(task.phase)
    return project === undefined ? [] : [{ id: task.taskId, project, title: task.title, status }]
  })

  const lines: ReadonlyArray<HomeLine> = (home?.events ?? []).flatMap((event) => {
    const line = lineOf(event, refs, new Date(now))
    return line === undefined ? [] : [{ ...line, id: event.id }]
  })

  const list: ReadonlyArray<HomeProject> = projects.map((project) => {
    const ready = tasks.filter((task) => task.projectId === project.id && task.phase === 'ready').length
    return {
      id: project.id,
      project: refOf(project),
      yours: calls.filter((call) => call.projectId === project.id).length + ready,
      note: project.lastWorkAt === null ? text.noWork : text.lastWork(ago(project.lastWorkAt, new Date(now))),
      fresh: project.lastWorkAt === null,
    }
  })

  const drop = {
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (file !== undefined) void start.openDropped(file).then((opened) => opened !== null && onProject(opened.id))
    },
  }
  const error = start.error ?? model.error

  return (
    <div className={s.window} {...drop}>
      <BarEnd>
        <SettingsPanel start={start} open={settings} onOpenChange={setSettings} glance={glance} />
      </BarEnd>
      {error !== null && (
        <p className={s.failure} role="alert">
          {error}
        </p>
      )}
      <div className={s.body}>
        {/* Unread is not empty: nothing shows until the home is read. */}
        {home !== null && (
          <Home
            waiting={waiting}
            needs={waits}
            running={runs}
            since={lines}
            looked={home === null ? '' : home.looked === null ? text.firstLook : ago(home.looked, new Date(now))}
            projects={list}
            onOpenEvent={(id) => {
              const event = home?.events.find((one) => one.id === id)
              if (event === undefined || event.kind === 'answered') return
              onTask(event.task.threadId)
            }}
            onOpenProject={onProject}
            onTalk={onTalk}
            onOpenFolder={openFolder}
          />
        )}
      </div>
    </div>
  )
}
