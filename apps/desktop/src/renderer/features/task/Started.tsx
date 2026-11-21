import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { AgentStatus, BoardSnapshot, BoardTask, ThreadSnapshot } from '@althar/contracts'
import { StartedTask, TaskStatus, type TaskPartModel } from '@althar/ui'

import { useServices } from '../../data/services'
import { reads } from '../../data/reads'
import { useModelNames } from '../../shared/modelNames'
import { type Stands, standsOf, startedText } from '../board/started'

/*
 * The tasks a task's lead started (ADR-097), as the task says them: a chip
 * where its lead started one, and a list in its parts. Both are read from the
 * project's board, which the window keeps current, so they show the task
 * where it stands (counting down to start, working, waiting on the person, its
 * pull request, merged, done, abandoned) in the board's own words, and the
 * end shows on the chip that was there from the start. Nothing is said a
 * second time: a task's thread keeps no line for what became of another.
 */

/** What of the project's board shows the tasks a lead started: their cards, and the calls they wait on. */
export type StartedBoard = Pick<BoardSnapshot, 'tasks' | 'calls'>

/**
 * The project's board as the window has read it, for what shows the tasks a lead started: only those tasks and their
 * calls, so the task's screen is drawn again where one of them changes, not wherever the board does. Null until it is read.
 */
export const useStartedBoard = (
  projectId: string | undefined,
  taskId: string | undefined,
  started: ThreadSnapshot['started'],
): StartedBoard | null => {
  const { client } = useServices()
  const threads = (started ?? []).map((one) => one.threadId).join(' ')
  const theirs = useCallback(
    (board: BoardSnapshot): StartedBoard => {
      const ids = new Set(threads.split(' '))
      const tasks = board.tasks.filter((task) => (taskId !== undefined && task.startedBy?.taskId === taskId) || ids.has(task.threadId))
      const these = new Set(tasks.map((task) => task.taskId))
      return { tasks, calls: board.calls.filter((call) => call.taskId !== null && these.has(call.taskId)) }
    },
    [taskId, threads],
  )
  return useQuery({ ...reads(client).board(projectId ?? ''), enabled: projectId !== undefined, select: theirs }).data ?? null
}

/** The tasks a task's lead started, oldest first, as the board has them. */
export const startedBy = (board: StartedBoard | null, taskId: string | undefined): ReadonlyArray<BoardTask> =>
  board === null || taskId === undefined
    ? []
    : board.tasks.filter((task) => task.startedBy?.taskId === taskId).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))

/** A task its lead started: where its thread says so, and as the board has it, where the board still holds it. */
export interface StartedEntry {
  readonly threadId: string
  readonly title: string
  readonly work: BoardTask | undefined
}

/**
 * Every task a task's lead started, oldest first: its thread's own list of them, which holds all, and the board's card for
 * each it still holds, since the board only keeps the most recently settled (the rest say they settled, and still open).
 */
export const startedIn = (board: StartedBoard | null, started: ThreadSnapshot['started']): ReadonlyArray<StartedEntry> =>
  board === null
    ? []
    : (started ?? []).map((one) => ({
        threadId: one.threadId,
        title: one.title,
        work: board.tasks.find((task) => task.taskId === one.taskId),
      }))

/** Whether a started task's chip counts down: it needs the clock to tick. */
export const countsDown = (task: BoardTask) => task.phase === 'planned' && task.plan?.startsAt != null

/** What a task's started tasks look like to read: the board, the clock, who works on what, and how one opens. */
export interface StartedReading {
  readonly board: StartedBoard
  readonly now: string
  readonly agents: ReadonlyArray<AgentStatus>
  readonly onOpen: (threadId: string) => void
}

/** Where a started task stands as the board has it now: its word, its colour, and what more the board says. */
const standsIn = (work: BoardTask, { board, now, agents }: StartedReading): Stands =>
  standsOf(
    work,
    board.calls.find((call) => call.taskId === work.taskId),
    now,
    (id) => agents.find((agent) => agent.id === id)?.name ?? id ?? '',
  )

/** A started task as the board stands: its chip. One the board no longer holds, long settled, says only that. */
export function StartedOf({ threadId, title, reading }: { threadId: string; title: string; reading: StartedReading }) {
  const named = useModelNames()
  const { board, onOpen } = reading
  const work = board.tasks.find((task) => task.threadId === threadId)
  const open = () => onOpen(threadId)
  if (work === undefined) return <StartedTask title={title} tone={TaskStatus.Done} word={startedText.settled} onClick={open} />
  const stands = standsIn(work, reading)
  return (
    <StartedTask
      title={work.title}
      tone={stands.tone}
      word={stands.word}
      detail={stands.detail}
      model={work.lead === null ? undefined : named(work.lead, work.leadModel)}
      onClick={open}
    />
  )
}

export const startedPartText = {
  name: 'Tasks it started',
}

/**
 * The tasks its lead started, as one of its parts: what they stand at, in a few words, and each as the chip its thread
 * has, which opens it. Waiting on the person, the part is in their colour; else live while one is at work.
 */
export const startedPart = (tasks: ReadonlyArray<StartedEntry>, reading: StartedReading): TaskPartModel => {
  const stands = tasks.map((one) =>
    one.work === undefined ? { tone: TaskStatus.Done, word: startedText.settled } : standsIn(one.work, reading),
  )
  return {
    id: 'started',
    icon: 'agents',
    name: startedPartText.name,
    detail: [...new Set(stands.map((one) => one.word))].join(', '),
    ...(stands.some((one) => one.tone === TaskStatus.Yours)
      ? { tone: 'you' as const }
      : stands.some((one) => one.tone === TaskStatus.Running)
        ? { tone: 'live' as const }
        : {}),
    body: (
      <>
        {tasks.map((one) => (
          <StartedOf key={one.threadId} threadId={one.threadId} title={one.title} reading={reading} />
        ))}
      </>
    ),
  }
}
