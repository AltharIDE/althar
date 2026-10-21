import type { BoardCall, BoardTask, HomeCall, HomeSnapshot, HomeTask, ProjectSummary } from '@althar/contracts'

import { callKindOf, needsYou, readyKindOf, standingCalls } from './calls'
import { whoWorks } from './words'

/*
 * The home, as a phone shows it: one column, what needs you first, then
 * what's at work, what's next, and what the loop did while you were away.
 */

/** Something that needs the person: a call to answer, or work ready for them. */
export type Need =
  | { readonly kind: 'call'; readonly id: string; readonly call: HomeCall; readonly word: string; readonly project: ProjectSummary | null }
  | { readonly kind: 'ready'; readonly id: string; readonly task: HomeTask; readonly word: string; readonly project: ProjectSummary | null }

/** How soon a call wants an answer: an agent waits on a permission or a question; a stuck step waits on nothing. */
const urgency = (call: { readonly kind: string }): number => (call.kind === 'permission' ? 0 : call.kind === 'question' ? 1 : 2)

export const needsOf = (home: HomeSnapshot): ReadonlyArray<Need> => {
  const projects = new Map(home.projects.map((project) => [project.id, project]))
  const calls = [...standingCalls(home.tasks, home.calls)].sort(
    (a, b) => urgency(a) - urgency(b) || a.createdAt.localeCompare(b.createdAt),
  )
  const ready = home.tasks.filter(needsYou).sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))
  return [
    ...calls.map((call): Need => ({ kind: 'call', id: call.id, call, word: callKindOf(call), project: projects.get(call.projectId) ?? null })),
    ...ready.map(
      (task): Need => ({ kind: 'ready', id: task.taskId, task, word: readyKindOf(task), project: projects.get(task.projectId) ?? null }),
    ),
  ]
}

/** Tasks an agent is on now, or held for a usage limit: longest-running last, so the newest work is first. */
export const atWorkOf = (home: { readonly tasks: ReadonlyArray<HomeTask> }): ReadonlyArray<HomeTask> =>
  home.tasks
    .filter((task) => task.phase === 'running' || task.phase === 'held')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))

/** Tasks in line or planned, by their place. */
export const upNextOf = (home: { readonly tasks: ReadonlyArray<HomeTask> }): ReadonlyArray<HomeTask> =>
  home.tasks.filter((task) => task.phase === 'planned').sort((a, b) => (a.place ?? 99) - (b.place ?? 99))

/** The step a task is on, as its row says it: Implementing, Reviewing. */
export const stepWords = (task: Pick<BoardTask, 'step' | 'phase' | 'waits' | 'inLine' | 'place' | 'plan'>, now: number): string => {
  if (task.phase === 'held' || task.waits !== null) return 'Paused for usage'
  if (task.phase === 'planned') {
    if (task.inLine === true) return task.place === 1 ? 'Next in line' : `${task.place ?? '–'} in line`
    const starts = task.plan?.startsAt
    if (starts != null) {
      const seconds = Math.max(0, Math.round((Date.parse(starts) - now) / 1000))
      return seconds < 60 ? `Starts in ${seconds}s` : `Starts in ${Math.round(seconds / 60)}m`
    }
    return 'Planned'
  }
  switch (task.step) {
    case 'implement':
      return 'Implementing'
    case 'review':
      return 'Reviewing'
    case 'settle':
      return 'Settling the review'
    case 'publish':
      return 'Opening the pull request'
    default:
      return 'Working'
  }
}

/** Who is on the step now: the reviewer while it reviews, else the lead. */
export const workerOf = (task: Pick<BoardTask, 'step' | 'plan' | 'lead' | 'leadModel'>): string => {
  const step = task.plan?.steps.find((one) => one.key === task.step)
  return step === undefined ? whoWorks(task.lead, task.leadModel) : whoWorks(step.agentId, step.model)
}

/** The plan's steps as a track: done, now, or to come. */
export const trackOf = (
  task: Pick<BoardTask, 'plan' | 'step' | 'phase'>,
): ReadonlyArray<{ readonly key: string; readonly label: string; readonly state: 'done' | 'now' | 'next' }> => {
  const keys = ['implement', 'review', 'publish'] as const
  const labels = { implement: 'Implement', review: 'Review', publish: 'Pull request' } as const
  const hasReview = task.plan?.steps.some((step) => step.key === 'review' && !step.skipped) ?? false
  const shown = keys.filter((key) => key !== 'review' || hasReview)
  const at = task.phase === 'ready' || task.phase === 'settled' ? shown.length : Math.max(0, shown.indexOf(task.step as (typeof keys)[number]))
  return shown.map((key, index) => ({ key, label: labels[key], state: index < at ? 'done' : index === at ? 'now' : 'next' }))
}

/** How many things need the person, for the tab's badge and the app's icon. */
export const needsCount = (home: HomeSnapshot): number => standingCalls(home.tasks, home.calls).length + home.tasks.filter(needsYou).length

/** A project's lanes on its board, as a phone stacks them. */
export const lanesOf = (board: { readonly tasks: ReadonlyArray<BoardTask>; readonly calls: ReadonlyArray<BoardCall> }) => ({
  needsYou: board.tasks.filter((task) => task.phase === 'waiting' || task.phase === 'ready'),
  running: board.tasks.filter((task) => task.phase === 'running' || task.phase === 'held'),
  upNext: board.tasks.filter((task) => task.phase === 'planned'),
  settled: board.tasks.filter((task) => task.phase === 'settled' || task.phase === 'kept' || task.phase === 'stopped'),
})
