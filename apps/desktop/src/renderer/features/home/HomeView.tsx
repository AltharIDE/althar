import { type DragEvent, useEffect, useState } from 'react'

import type { HomeCall, HomeEvent, HomeTask } from '@althar/contracts'
import { type IconName, modKey, PermissionAnswers, type ProjectRef, Problem } from '@althar/ui'
import { Home, type HomeEvent as HomeLine, type HomeNeed, type HomeProject, type HomeRun } from '@althar/ui/screens'

import { taskStatusOf } from '../../shared/taskStatus'
import { queuedOfWords } from '../../shared/agents'
import { permissionOf, type Reply, replyOf } from '../../shared/permissions'
import type { DoneHere } from '../../shared/standing'
import { ago, clock, useNow } from '../../shared/time'
import { useNewTab } from '../tabs/TabsFrame'
import type { StartModel } from '../start/useStart'
import { yoursByProject } from '../board/lanes'
import { homeGlanceOf, refOf } from './glance'
import s from './Home.module.css'
import type { HomeModel } from './useHome'
import { type AnsweredCall, needLineOf, needText } from './needs'
import { useModelNames } from '../../shared/modelNames'

/*
 * The window you come back to, once there are projects: the kit's Home.
 * Across every project, what waits on you, answered where it is when a click
 * will do and opened as its task when it needs reading; what is in progress;
 * and what the loop did since you last left. Beside them, the projects, each
 * with its mark. The window's bar has nothing of the home's own, only
 * Althar's settings, as every screen has them: how much needs you is the
 * stream's first word, and which agents are signed in is for settings, not
 * the home. A task that waits on you is in
 * what needs you, not again in what is in progress; one that waits for a
 * free agent stands still in its project's row, which says what it waits
 * for. There is no composer: coordinators belong to projects. A new project
 * starts in a tab of its own, from the projects' +, or with folders dropped
 * on the home.
 */

export const text = {
  ...needText,
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
    coordinatorAnswered: (n: number) => (n === 1 ? 'Coordinator answered 1 permission ask' : `Coordinator answered ${n} permission asks`),
    since: (at: string) => `since ${at}`,
  },
}

export { refOf }

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
      // A tick only for a review that passed; one that found something, or asked for changes, says so.
      return result.verdict === 'pass'
        ? said('check', t.passed)
        : said('quote', result.findings.length > 0 ? t.found(result.findings.length) : t.asked)
  }
}

export function HomeView({
  model,
  start,
  onProject,
  onTalk,
  onTask,
  onSignIn,
}: {
  model: HomeModel
  start: StartModel
  onProject: (projectId: string) => void
  /** Open a project's conversation with its coordinator. */
  onTalk: (projectId: string) => void
  onTask: (threadId: string) => void
  /** Opens Settings at an agent's sign-in, started: a stuck step's line whose agent is signed out offers it. */
  onSignIn?: (agentId: string) => void
}) {
  const home = model.home
  const now = useNow(true)
  // Calls answered here: each stays its line, quiet, where it was, until the person leaves.
  const [answered, setAnswered] = useState<ReadonlyArray<AnsweredCall>>([])
  // The home's screen is kept while the person is elsewhere: leaving is when those lines go.
  useEffect(() => () => setAnswered([]), [])
  const agents = start.status?.agents ?? []
  const named = useModelNames()
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''

  const projects = home?.projects ?? []
  const refs = new Map(projects.map((project) => [project.id, refOf(project)]))
  // Each task where its board puts it: one being merged is in progress until it settles; one kept for later waits on its board.
  const { working, waiting, needs } = homeGlanceOf(home, {
    answered,
    merging: model.merging,
    agentName: name,
    modelName: (agentId, model) => named(agentId, model).name,
  })

  const newTab = useNewTab()

  const answer = (call: HomeCall, reply: Reply) => {
    setAnswered((now) => [...now, { call, reply }])
    // One whose answer didn't go through comes back, with what went wrong.
    void model.answer(call.id, reply.decision, reply.reason, reply.always).then((through) => {
      if (!through) setAnswered((now) => now.filter((one) => one.call.id !== call.id))
    })
  }

  // A ready change's next thing, done from its line when it is the person's own (merge, push), at once, at the heads they saw; the lead's it leaves to the task.
  const doNext = (task: HomeTask, next: DoneHere, bypassQueue?: boolean) => {
    if (next.kind === 'ship') return void model.ship(task.taskId)
    if (next.kind === 'fix_after_merge') return void model.fixAfterMerge(task.taskId)
    const change = task.change
    if (change === null) return
    return void (next.kind === 'merge'
      ? bypassQueue === true
        ? model.merge(task.taskId, change.head ?? '', change.url, true)
        : model.merge(task.taskId, change.head ?? '', change.url)
      : model.push(task.taskId, change.localHead ?? '', change.url))
  }
  const doing = (taskId: string) =>
    model.merging.has(taskId) || model.pushing.has(taskId) || model.shipping.has(taskId) || model.answeringAfterMerge.has(taskId)

  // What waits, each gathered under its project; a call answered here stays its line, quiet, until the person leaves.
  const waits: ReadonlyArray<HomeNeed> = needs.map((need) => ({
    key: need.id,
    project: need.project,
    ...(need.answer === undefined ? {} : { answered: true }),
    line: needLineOf(need, {
      onOpen: onTask,
      onAnswer: (call, _project, decision) => answer(call, { decision }),
      // Every answer the call offers (ADR-018): Deny and Allow once, the rest in a menu beside them.
      answers: (call, project) => (
        <PermissionAnswers request={permissionOf(call)} project={project.name} onAnswer={(given) => answer(call, replyOf(given))} />
      ),
      onNext: doNext,
      doing,
      failed: (taskId) => model.failed[taskId],
      ...(onSignIn === undefined ? {} : { onSignIn }),
    }),
  }))

  const runs: ReadonlyArray<HomeRun> = working.flatMap((task) => {
    const project = refs.get(task.projectId)
    // Where it stands, as its card on the board and its header say it: held, waiting its turn, or by its phase.
    const status = taskStatusOf(task)
    return project === undefined ? [] : [{ id: task.taskId, project, title: task.title, status }]
  })
  // What waiting tasks wait for is this computer's, the same for each: its project says it, with how many wait there.
  const queued = working.find((task) => task.queued !== null)?.queued ?? null

  const lines: ReadonlyArray<HomeLine> = (home?.events ?? []).flatMap((event) => {
    const line = lineOf(event, refs, new Date(now))
    return line === undefined ? [] : [{ ...line, id: event.id }]
  })

  // What waits in each, as its board and its tab count it.
  const yours = home === null ? new Map<string, number>() : yoursByProject(home, model.merging)
  const list: ReadonlyArray<HomeProject> = projects.map((project) => {
    return {
      id: project.id,
      project: refOf(project),
      yours: yours.get(project.id) ?? 0,
      note: project.lastWorkAt === null ? text.noWork : text.lastWork(ago(project.lastWorkAt, new Date(now))),
      fresh: project.lastWorkAt === null,
    }
  })

  const drop = {
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const files = [...event.dataTransfer.files]
      if (files.length > 0) newTab.start(files)
    },
  }
  const error = start.error ?? model.error

  return (
    <div className={s.window} {...drop}>
      {error !== null && <Problem className={s.failure}>{error}</Problem>}
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
            text={{
              projects: {
                // The shortcut as this system writes it.
                newProjectKbd: modKey('N'),
                ...(queued === null ? {} : { queued: (n: number) => queuedOfWords(n, queued) }),
              },
            }}
            onOpenEvent={(id) => {
              const event = home?.events.find((one) => one.id === id)
              if (event === undefined || event.kind === 'answered') return
              onTask(event.task.threadId)
            }}
            onOpenProject={onProject}
            onTalk={onTalk}
            onNewProject={() => newTab.start()}
          />
        )}
      </div>
    </div>
  )
}
