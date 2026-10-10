import type { ReactNode } from 'react'

import type { HomeCall, HomeTask } from '@althar/contracts'
import { Button, type EdgeWork, NeedLine, type ProjectRef } from '@althar/ui'

import { kindWords } from '../../shared/calls'
import { text as stuckText } from '../task/StuckCall'

/*
 * What waits on the person across every project, as the home and the edge
 * of the screen both list it: each call and each task ready to accept, as a
 * NeedLine of its kind with the one thing to know to answer it. A permission
 * is answered where it is; a stuck step and a ready task open their task.
 */

export const needText = {
  allow: 'Allow once',
  deny: 'Deny',
  look: 'Open',
  review: 'Review',
  /** A change on its branch alone, by its size. */
  onBranch: 'On its branch',
  branchSize: (files: number, add: number, del: number) => `On its branch: ${files === 1 ? '1 file' : `${files} files`}, +${add} −${del}`,
  /** A change ready to accept, in a line: where, its checks, how big. */
  checks: {
    failed: (n: number) => (n === 1 ? '1 check failed' : `${n} checks failed`),
    running: 'checks running',
    passed: 'checks passed',
    none: 'no checks',
  },
}

/** Something that waits on the person, said once for every place that lists it. */
export interface Need {
  readonly id: string
  readonly threadId: string
  readonly kind: string
  readonly project: ProjectRef
  readonly title: string
  /** The command a permission asks to run. */
  readonly command?: string
  /** Otherwise, what to answer by: why it stalled, or the change and its checks. */
  readonly brief?: string
  /** A permission, which is answered in place. */
  readonly permission?: HomeCall
}

/** What a ready task's line says to accept it by: its change, where and how its checks went and how big, or what is on its branch. */
export const briefOf = (task: HomeTask): string => {
  const change = task.change
  if (change === null)
    return task.changed === null ? needText.onBranch : needText.branchSize(task.changed.files, task.changed.add, task.changed.del)
  const checks = change.checks
  const said =
    checks === null
      ? needText.checks.none
      : checks.failed > 0
        ? needText.checks.failed(checks.failed)
        : checks.running > 0
          ? needText.checks.running
          : checks.passed > 0
            ? needText.checks.passed
            : needText.checks.none
  const parts: ReadonlyArray<string | null> = [
    `${change.repository.slice(change.repository.lastIndexOf('/') + 1)} ${change.prefix}${change.number}`,
    said,
    change.additions === null || change.deletions === null ? null : `+${change.additions} −${change.deletions}`,
  ]
  return parts.filter((part) => part !== null).join(' · ')
}

/** The calls first, then the tasks ready to accept; any in a project not known yet waits until it is. */
export const needsOf = ({
  calls,
  ready,
  refs,
  agentName,
}: {
  calls: ReadonlyArray<HomeCall>
  ready: ReadonlyArray<HomeTask>
  refs: ReadonlyMap<string, ProjectRef>
  agentName: (id: string | null) => string
}): ReadonlyArray<Need> => [
  ...calls.flatMap((call): ReadonlyArray<Need> => {
    const project = refs.get(call.projectId)
    if (project === undefined) return []
    const stuck = call.stuck
    return [
      stuck === null
        ? {
            id: call.id,
            threadId: call.threadId,
            kind: kindWords.permission,
            project,
            title: call.title,
            command: call.command ?? call.title,
            permission: call,
          }
        : {
            id: call.id,
            threadId: call.threadId,
            kind: kindWords.stuck,
            project,
            title: call.taskTitle,
            brief: stuckText.what(stuck, agentName(stuck.agentId) || 'The agent'),
          },
    ]
  }),
  ...ready.flatMap((task): ReadonlyArray<Need> => {
    const project = refs.get(task.projectId)
    return project === undefined
      ? []
      : [{ id: task.taskId, threadId: task.threadId, kind: kindWords.ready, project, title: task.title, brief: briefOf(task) }]
  }),
]

/**
 * A need's line: its title opens its task; a permission's answers give it
 * there (Deny and Allow once, unless the place gives every answer the call
 * offers, as the home does), the others' button opens it too.
 */
export function needLineOf(
  need: Need,
  {
    onOpen,
    onAnswer,
    answers,
  }: {
    onOpen: (threadId: string) => void
    onAnswer: (call: HomeCall, project: ProjectRef, decision: 'allow' | 'reject') => void
    /** A permission's answers, in place of Deny and Allow once. */
    answers?: (call: HomeCall, project: ProjectRef) => ReactNode
  },
): ReactNode {
  const open = () => onOpen(need.threadId)
  const { permission } = need
  return (
    <NeedLine
      key={need.id}
      kind={need.kind}
      project={need.project}
      title={need.title}
      {...(need.command === undefined ? {} : { command: need.command })}
      {...(need.brief === undefined ? {} : { brief: need.brief })}
      onOpen={open}
      actions={
        permission === undefined ? (
          <Button size="small" onClick={open}>
            {need.kind === kindWords.ready ? needText.review : needText.look}
          </Button>
        ) : answers !== undefined ? (
          answers(permission, need.project)
        ) : (
          <>
            <Button size="small" onClick={() => onAnswer(permission, need.project, 'reject')}>
              {needText.deny}
            </Button>
            <Button size="small" variant="signal" onClick={() => onAnswer(permission, need.project, 'allow')}>
              {needText.allow}
            </Button>
          </>
        )
      }
    />
  )
}

/** The work in progress, counted, for the edge's one line: how much, and of it, how much is held for a reset or stopped. */
export const workOf = (working: ReadonlyArray<HomeTask>): EdgeWork => ({
  inProgress: working.length,
  held: working.filter((task) => task.waits !== null).length,
  stopped: working.filter((task) => task.phase === 'stopped').length,
})
