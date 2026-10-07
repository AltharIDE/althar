import { type DragEvent, type ReactNode, useEffect, useState } from 'react'

import type { AgentStatus, HomeCall, HomeEvent, HomeTask, ProjectSummary } from '@althar/contracts'
import {
  type AgentMark,
  AgentMarks,
  AskAnswered,
  AskNote,
  Button,
  type IconName,
  IconButton,
  NeedCard,
  NeedChange,
  NeedCommand,
  ProjectInk,
  type ProjectRef,
  RuntimeState,
  TaskStatus,
  TitleBar,
  TitleBarRule,
  WorkStatus,
} from '@althar/ui'
import { Home, type HomeEvent as HomeLine, type HomeProject, type HomeRun } from '@althar/ui/screens'

import { brandOf, modelInfo, waitsWords } from '../../shared/agents'
import { productBrand, productName } from '../../shared/products'
import { ago, clock, running, useNow } from '../../shared/time'
import { type DockTarget, trackOf } from '../board/BoardView'
import { DockView } from '../board/DockView'
import type { StartModel } from '../start/useStart'
import { text as stuckText } from '../task/StuckCall'
import s from './Home.module.css'
import type { HomeModel } from './useHome'

/*
 * The window you come back to, once there are projects: the kit's Home.
 * Across every project, what waits on you, answered where it is when a click
 * will do and opened in the dock when it needs reading; what runs; and what
 * the loop did since you last left. Beside them, the projects, each with its
 * mark. The bar has the agents' marks, how much runs and needs you, and the
 * way to settings. There is no composer: coordinators belong to projects.
 */

export const text = {
  dock: 'Beside the home',
  settings: 'Settings',
  settingsKbd: '⌘,',
  kind: { permission: 'Permission', stuck: 'Stuck', ready: 'Ready to accept' },
  allow: 'Allow once',
  deny: 'Deny',
  look: 'Open',
  review: 'Review',
  allowed: (what: string) => `Allowed ${what}`,
  denied: (what: string) => `Didn’t allow ${what}`,
  answeredIn: (project: string) => `in ${project}`,
  /** A change on its branch alone, by its size. */
  onBranch: 'On its branch',
  branchSize: (files: number, add: number, del: number) => `On its branch: ${files === 1 ? '1 file' : `${files} files`}, +${add} −${del}`,
  stopped: 'No agent is working on it',
  waiting: 'Waits on you',
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
    withinRules: 'within the projects’ rules',
    since: (at: string) => `since ${at}`,
  },
}

/** A project's ink as the kit has it. */
const inkOf = (ink: ProjectSummary['ink']): ProjectInk => ink as ProjectInk

/** A project as the home draws it: its mark, from its id, which outlives its name; its ink; its name. */
export const refOf = (project: ProjectSummary): ProjectRef => ({ seed: project.id, ink: inkOf(project.ink), name: project.name })

/** An agent in the bar: ready, out of usage until the first of its accounts is back, or signed out. */
export const agentMarkOf = (agent: AgentStatus, now: Date = new Date()): AgentMark => {
  const brand = brandOf(agent.id)
  const base = { id: agent.id, name: agent.name, ...(brand === undefined ? {} : { brand }) }
  if (agent.signIn === 'signed_out') return { ...base, state: RuntimeState.SignedOut }
  const usable = agent.accounts.filter((account) => account.signIn !== 'signed_out')
  const back = usable.flatMap((account) => (account.outUntil === null ? [] : [account.outUntil])).toSorted((a, b) => a.localeCompare(b))
  const [first] = back
  if (usable.length > 0 && back.length === usable.length && first !== undefined)
    return { ...base, state: RuntimeState.OutOfUsage, back: clock(first, now) }
  return { ...base, state: RuntimeState.Ready }
}

/** How a task that isn't ready stands: running, waiting on a call, or stopped. */
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
    return { icon: 'lock', what: t.answered(event.count), detail: t.withinRules, at: t.since(clock(event.at, now)) }
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
  readonly project: string
}

export function HomeView({
  model,
  start,
  onProject,
  onTask,
  onSettings,
}: {
  model: HomeModel
  start: StartModel
  onProject: (projectId: string) => void
  onTask: (threadId: string) => void
  onSettings: () => void
}) {
  const home = model.home
  const now = useNow(true)
  const [target, setTarget] = useState<DockTarget | null>(null)
  const [answered, setAnswered] = useState<ReadonlyArray<Answered & { readonly id: string }>>([])
  const agents = start.status?.agents ?? []
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const lead = (task: HomeTask) => modelInfo({ id: task.lead ?? 'agent', name: name(task.lead) }, null)

  const projects = home?.projects ?? []
  const refs = new Map(projects.map((project) => [project.id, refOf(project)]))
  const tasks = home?.tasks ?? []
  const working = tasks.filter((task) => task.phase !== 'ready')
  const ready = tasks.filter((task) => task.phase === 'ready')
  const calls = (home?.calls ?? []).filter((call) => !answered.some((one) => one.id === call.id))
  const waiting = calls.length + ready.length

  const openFolder = () => void start.openFolder().then((opened) => opened !== null && onProject(opened.id))
  // ⌘N opens a folder, and ⌘, the settings. ⌘ and a number belongs to the window's tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.key === 'n') openFolder()
      else if (event.key === ',') onSettings()
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
        project: project.name,
      },
    ])
    if (target?.kind === 'call' && target.id === call.id) setTarget(null)
    void model.answer(call.id, decision)
  }

  const open = (next: DockTarget) => setTarget(next)
  const isOpen = (kind: DockTarget['kind'], id: string) => target?.kind === kind && target.id === id

  const cards: ReadonlyArray<{ readonly key: string; readonly node: ReactNode }> = [
    ...calls.flatMap((call) => {
      const project = refs.get(call.projectId)
      if (project === undefined) return []
      const stuck = call.stuck
      const shared = {
        project,
        at: ago(call.createdAt, new Date(now)),
        current: isOpen('call', call.id),
        onOpen: () => open({ kind: 'call', id: call.id }),
      }
      return [
        {
          key: call.id,
          node:
            stuck === null ? (
              <NeedCard
                {...shared}
                kind={text.kind.permission}
                title={call.title}
                detail={<NeedCommand command={call.command ?? call.title} />}
                actions={
                  <>
                    <Button size="small" onClick={() => answer(call, project, 'reject')}>
                      {text.deny}
                    </Button>
                    <Button size="small" variant="signal" onClick={() => answer(call, project, 'allow')}>
                      {text.allow}
                    </Button>
                  </>
                }
              />
            ) : (
              <NeedCard
                {...shared}
                kind={text.kind.stuck}
                title={call.taskTitle}
                detail={stuckText.what(stuck, name(stuck.agentId) || 'The agent')}
                actions={
                  <Button size="small" onClick={shared.onOpen}>
                    {text.look}
                  </Button>
                }
              />
            ),
        },
      ]
    }),
    ...ready.flatMap((task) => {
      const project = refs.get(task.projectId)
      if (project === undefined) return []
      const change = task.change
      const brand = change === null ? undefined : productBrand(change.product)
      const reviewer = task.plan?.steps.find((step) => step.key === 'review' && !step.skipped)?.agentId
      return [
        {
          key: task.taskId,
          node: (
            <NeedCard
              kind={text.kind.ready}
              project={project}
              title={task.title}
              current={isOpen('task', task.taskId)}
              onOpen={() => open({ kind: 'task', id: task.taskId })}
              detail={
                change === null ? (
                  task.changed === null ? (
                    text.onBranch
                  ) : (
                    text.branchSize(task.changed.files, task.changed.add, task.changed.del)
                  )
                ) : (
                  <NeedChange
                    host={{ name: productName(change.product), ...(brand === undefined ? {} : { brand }) }}
                    repo={change.repository.slice(change.repository.lastIndexOf('/') + 1)}
                    number={change.number}
                    add={change.additions ?? 0}
                    del={change.deletions ?? 0}
                    checks={{
                      passed: change.checks?.passed ?? 0,
                      failed: change.checks?.failed ?? 0,
                      running: change.checks?.running ?? 0,
                    }}
                    lead={lead(task)}
                    {...(reviewer === undefined ? {} : { reviewer: modelInfo({ id: reviewer, name: name(reviewer) }, null) })}
                    text={{ number: (n) => `${change.prefix}${n}` }}
                  />
                )
              }
              actions={
                <Button size="small" onClick={() => open({ kind: 'task', id: task.taskId })}>
                  {text.review}
                </Button>
              }
            />
          ),
        },
      ]
    }),
  ]

  const runs: ReadonlyArray<HomeRun> = working.flatMap((task) => {
    const project = refs.get(task.projectId)
    if (project === undefined) return []
    const { steps, at } = trackOf(task)
    const status = statusOf(task.phase)
    const note =
      task.waits !== null
        ? waitsWords(name(task.waits.agentId), clock(task.waits.until, new Date(now)))
        : status === TaskStatus.Stopped
          ? text.stopped
          : status === TaskStatus.Yours
            ? text.waiting
            : undefined
    return [
      {
        id: task.taskId,
        project,
        title: task.title,
        status,
        steps,
        at,
        who: lead(task),
        elapsed: task.startedAt === null ? '' : running(task.startedAt, now),
        ...(note === undefined ? {} : { note }),
      },
    ]
  })

  const lines: ReadonlyArray<HomeLine> = (home?.events ?? []).flatMap((event) => {
    const line = lineOf(event, refs, new Date(now))
    return line === undefined ? [] : [{ ...line, id: event.id }]
  })

  const list: ReadonlyArray<HomeProject> = projects.map((project) => {
    const mine = tasks.filter((task) => task.projectId === project.id)
    const on = mine.find((task) => task.phase === 'running')
    const step = on === undefined ? undefined : { ...trackOf(on), on }
    const yours = calls.filter((call) => call.projectId === project.id).length + mine.filter((task) => task.phase === 'ready').length
    return {
      id: project.id,
      project: refOf(project),
      running: mine.filter((task) => task.phase !== 'ready').length,
      yours,
      moving: mine.some((task) => task.phase === 'running' && task.waits === null),
      ...(step === undefined ? {} : { now: { step: step.steps[step.at] ?? '', task: step.on.title, who: lead(step.on) } }),
      note: project.lastWorkAt === null ? text.noWork : text.lastWork(ago(project.lastWorkAt, new Date(now))),
    }
  })

  // The dock acts on the task or call it holds, in whichever project that is.
  const docked =
    target === null
      ? undefined
      : target.kind === 'call'
        ? home?.calls.find((call) => call.id === target.id)?.projectId
        : home?.tasks.find((task) => task.taskId === target.id)?.projectId
  const dock =
    target === null || docked === undefined ? undefined : (
      <DockView
        label={text.dock}
        target={target}
        model={model}
        agents={agents}
        project={refs.get(docked)?.name ?? ''}
        now={now}
        onClose={() => setTarget(null)}
        onTask={onTask}
        onChanges={(task) => onTask(task.threadId)}
      />
    )

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
      <TitleBar
        lights="none"
        end={
          <>
            <AgentMarks agents={agents.map((agent) => agentMarkOf(agent, new Date(now)))} />
            <TitleBarRule />
            <WorkStatus
              running={working.length}
              yours={waiting}
              onYours={() => {
                const [call] = calls
                const [first] = ready
                if (call !== undefined) open({ kind: 'call', id: call.id })
                else if (first !== undefined) open({ kind: 'task', id: first.taskId })
              }}
            />
            <IconButton icon="gear" label={text.settings} kbd={text.settingsKbd} size="small" onClick={onSettings} />
          </>
        }
      >
        {null}
      </TitleBar>
      {error !== null && (
        <p className={s.failure} role="alert">
          {error}
        </p>
      )}
      <div className={s.body}>
        <Home
          waiting={waiting}
          needs={[
            ...cards.map(({ key, node }) => <div key={key}>{node}</div>),
            ...answered.map((one) => (
              <AskAnswered key={one.id} said={one.said} denied={one.denied} focusOnMount>
                <AskNote>{text.answeredIn(one.project)}</AskNote>
              </AskAnswered>
            )),
          ]}
          running={runs}
          since={lines}
          looked={home === null ? '' : home.looked === null ? text.firstLook : ago(home.looked, new Date(now))}
          projects={list}
          {...(target?.kind === 'task' ? { current: target.id } : {})}
          {...(dock === undefined ? {} : { dock })}
          onOpenTask={(id) => open({ kind: 'task', id })}
          onOpenEvent={(id) => {
            const event = home?.events.find((one) => one.id === id)
            if (event === undefined || event.kind === 'answered') return
            if (tasks.some((task) => task.taskId === event.task.id)) open({ kind: 'task', id: event.task.id })
            else onTask(event.task.threadId)
          }}
          onOpenProject={onProject}
          onOpenFolder={openFolder}
        />
      </div>
    </div>
  )
}
