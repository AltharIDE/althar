import { type BoardTask, type HomeSnapshot, type HomeTask, type ProjectSummary, standingCalls } from '@althar/contracts'
import type { ProjectInk, ProjectRef } from '@althar/ui'

import { asMerging } from '../../data/merges'
import { lanesOf, yoursOf } from '../board/lanes'
import type { EdgeGlance } from '../settings/EdgePicture'
import { type AnsweredCall, type Need, needsOf, workOf } from './needs'

/** A project as the home draws it: its mark, from its id, which outlives its name; its ink; its name. */
export const refOf = (project: ProjectSummary): ProjectRef => ({ seed: project.id, ink: project.ink as ProjectInk, name: project.name })

/*
 * What waits on the person and what is in progress, across every project, as
 * the home reads them: for the home's own lists, the edge of the screen, and
 * Settings' pictures of it, which show the same. Each task is where its
 * board's lanes put it (`lanesOf`, by `waitingOn`), so the home, the edge and
 * the tabs count what the board's Needs you and Running show: a task that
 * waits on a call has its call, not a line again among what is in progress;
 * one that waits on issues to file, one whose lead stopped, and one ready to
 * accept wait too; an aside, a chat on Scratch, is in neither.
 */

/** Where the board's lanes put the home's tasks and calls, across every project. */
export interface HomeWaits {
  /** The calls that stand for what waits, a task's oldest once (`standingCalls`), in the order they came. */
  readonly calls: HomeSnapshot['calls']
  /** Tasks that wait on issues their lead drafted, or changes to their issue. */
  readonly issues: ReadonlyArray<HomeTask>
  /** Tasks whose lead stopped with no agent on them, the latest stopped first. */
  readonly stopped: ReadonlyArray<HomeTask>
  /** Work ready for the person. */
  readonly ready: ReadonlyArray<HomeTask>
  /** What is in progress: Running's and Up next's, and what waits on a call, in the home's order. */
  readonly working: ReadonlyArray<HomeTask>
  /** How many things wait, each once, as the tabs count them. */
  readonly waiting: number
}

export const waitsOf = (home: HomeSnapshot | null, merging: ReadonlySet<string> = new Set()): HomeWaits => {
  // One being merged, or in its merge queue, is in progress, not waiting on the person, until it settles.
  const tasks = asMerging(home?.tasks ?? [], merging)
  const calls = home?.calls ?? []
  const lanes = lanesOf({ cursor: home?.cursor ?? 0, tasks, calls, settledTotal: 0 })
  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  const homeOf = (list: ReadonlyArray<BoardTask>) =>
    list.flatMap((task) => {
      const one = byId.get(task.taskId)
      return one === undefined ? [] : [one]
    })
  const under = new Set([...lanes.next, ...lanes.running, ...lanes.waiting.map((one) => one.task)].map((task) => task.taskId))
  return {
    calls: standingCalls(tasks, calls),
    issues: homeOf(lanes.issues),
    stopped: homeOf(lanes.stopped),
    ready: homeOf(lanes.ready),
    working: tasks.filter((task) => under.has(task.taskId)),
    waiting: yoursOf(lanes),
  }
}

export interface HomeGlance {
  readonly calls: HomeSnapshot['calls']
  readonly working: HomeSnapshot['tasks']
  /** How many things wait on the person, each once, as the tabs count them. */
  readonly waiting: number
  readonly needs: ReadonlyArray<Need>
  /** The first few that wait, and how much is in progress, for the edge's pictures. */
  readonly edge: EdgeGlance
}

export const homeGlanceOf = (
  home: HomeSnapshot | null,
  {
    answered = [],
    merging = new Set(),
    agentName,
    modelName,
  }: {
    /** Calls answered here, which stay their lines until the person leaves. */
    readonly answered?: ReadonlyArray<AnsweredCall>
    /** Tasks being merged, which are in progress, not waiting on the person, until they settle. */
    readonly merging?: ReadonlySet<string>
    readonly agentName: (id: string | null) => string
    readonly modelName: (agentId: string, model: string | null) => string
  },
): HomeGlance => {
  const refs = new Map((home?.projects ?? []).map((project) => [project.id, refOf(project)]))
  const { calls: standing, issues, stopped, ready, working: all, waiting } = waitsOf(home, merging)
  const calls = standing.filter((call) => !answered.some((one) => one.call.id === call.id))
  // What has a card above isn't listed again under it: a task whose call was answered here is, until it goes on.
  const carded = new Set(calls.map((call) => call.threadId))
  // A project not known yet has none of its work shown, nor counted as in progress.
  const working = all.filter((task) => refs.has(task.projectId) && !carded.has(task.threadId))
  const needs = needsOf({ calls: standing, answered, issues, stopped, ready, refs, agentName, modelName })
  return {
    calls,
    working,
    waiting,
    needs,
    edge: { waiting, needs: needs.filter((need) => need.answer === undefined).slice(0, 3), work: workOf(working) },
  }
}
