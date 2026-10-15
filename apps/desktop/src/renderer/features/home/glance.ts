import type { HomeSnapshot, ProjectSummary } from '@althar/contracts'
import type { ProjectInk, ProjectRef } from '@althar/ui'

import { isFinished } from '../../shared/calls'
import type { EdgeGlance } from '../settings/EdgePicture'
import { type AnsweredCall, type Need, needsOf, workOf } from './needs'

/** A project as the home draws it: its mark, from its id, which outlives its name; its ink; its name. */
export const refOf = (project: ProjectSummary): ProjectRef => ({ seed: project.id, ink: project.ink as ProjectInk, name: project.name })

/*
 * What waits on the person and what is in progress, across every project, as
 * the home reads them: for the home's own lists, and for Settings' pictures
 * of the edge of the screen, which show the same. A task that waits on a
 * call has its call, not a line again among what is in progress; one ready
 * to accept waits too, until it is finished.
 */

export interface HomeGlance {
  readonly calls: HomeSnapshot['calls']
  readonly working: HomeSnapshot['tasks']
  /** Calls and tasks ready: how many wait on the person. */
  readonly waiting: number
  readonly needs: ReadonlyArray<Need>
  /** The first few that wait, and how much is in progress, for the edge's pictures. */
  readonly edge: EdgeGlance
}

export const homeGlanceOf = (
  home: HomeSnapshot | null,
  {
    answered = [],
    agentName,
    modelName,
  }: {
    /** Calls answered here, which stay their lines until the person leaves. */
    readonly answered?: ReadonlyArray<AnsweredCall>
    readonly agentName: (id: string | null) => string
    readonly modelName: (agentId: string, model: string | null) => string
  },
): HomeGlance => {
  const refs = new Map((home?.projects ?? []).map((project) => [project.id, refOf(project)]))
  const tasks = home?.tasks ?? []
  // In progress is every task not ready to accept; a plain task that finished waits on its board, not here.
  const ready = tasks.filter((task) => task.phase === 'ready' && !isFinished(task))
  const calls = (home?.calls ?? []).filter((call) => !answered.some((one) => one.call.id === call.id))
  // What has a card above isn't listed again under it.
  const carded = new Set(calls.map((call) => call.threadId))
  const working = tasks.filter((task) => task.phase !== 'ready' && !carded.has(task.threadId))
  const waiting = calls.length + ready.length
  const needs = needsOf({ calls: home?.calls ?? [], answered, ready, refs, agentName, modelName })
  return {
    calls,
    working,
    waiting,
    needs,
    edge: { waiting, needs: needs.filter((need) => need.answer === undefined).slice(0, 3), work: workOf(working) },
  }
}
