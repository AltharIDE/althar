import type { ReactNode } from 'react'

import type { HomeCall, HomeTask } from '@althar/contracts'
import { Button, type EdgeWork, Fact, LinkButton, NeedLine, type ProjectRef } from '@althar/ui'

import { commandOf, titleOf } from '../../shared/callCommand'
import { callKindOf, isUnshipped, kindWords, readyKindOf, whereOf } from '../../shared/calls'
import type { Reply } from '../../shared/permissions'
import { briefOf as questionBrief } from '../../shared/questions'
import {
  doingWords,
  doneHere,
  factsOf,
  labelWords,
  type DoneHere,
  type Next,
  nextWords,
  standingOf,
  standingText,
} from '../../shared/standing'
import { text as stuckText } from '../task/StuckCall'
import type { ActionFailure } from '../board/useWorkActions'

/*
 * What waits on the person across every project, as the home and the edge
 * of the screen both list it: each call and each task ready to accept, as a
 * NeedLine of its kind with the one thing to know to answer it. A permission
 * is answered where it is; a stuck step opens its task. A ready change says
 * what stands between it and merging, as its board card does, and where the
 * place offers it (the home), its button is the one next thing to do: push or
 * accept and merge, right there, saying why when that failed and offering to
 * try again; asking its lead to fix the checks or resolve a conflict is a
 * link into its task, where the lead is told.
 * Answered there, its line stays where it was, at its height, and goes
 * quiet, with what was said where its answers were, until the place is left.
 */

export const needText = {
  /** A call answered here, as its line then says it: which way, and in a word what was said. */
  settled: {
    allowed: 'Allowed',
    denied: 'Denied',
    once: 'Once',
    always: 'Always',
    never: 'Never',
    /** Where an always or a never was kept. */
    keptIn: (project: string) => `kept in ${project}’s rules`,
    answeredIn: (project: string) => `in ${project}`,
  },
  allow: 'Allow once',
  deny: 'Deny',
  look: 'Open',
  review: 'Review',
  /** An agent's question, opened where it was asked to answer it. */
  answer: 'Answer',
  /** A change on its branch alone, by its size. */
  onBranch: 'On its branch',
  /** Commits after its last pull request, in none yet, and how big they are. */
  inNone: (commits: number, add: number, del: number) =>
    `${commits === 1 ? '1 commit' : `${commits} commits`} in no pull request · +${add} −${del}`,
  branchSize: (files: number, add: number, del: number) =>
    files === 0 ? 'Nothing changed on its branch' : `On its branch: ${files === 1 ? '1 file' : `${files} files`}, +${add} −${del}`,
  /** A review drafted, in a line: whose pull request, and what the draft found. */
  by: (author: string) => `by ${author}`,
  findings: (n: number) => (n === 0 ? 'no findings' : n === 1 ? '1 finding' : `${n} findings`),
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
  /** Otherwise, what to answer by: why it stalled, or the change and what stands between it and merging. */
  readonly brief?: string
  /** A permission, which is answered in place. */
  readonly permission?: HomeCall
  /** A ready change: the task, and the one next thing its pull request needs, done from its line where the place offers it. */
  readonly ready?: { readonly task: HomeTask; readonly next: Next }
  /** Answered here: which way, what was said, and where it was kept or what to do instead. */
  readonly answer?: { readonly kind: string; readonly said: string; readonly note: string; readonly denied: boolean }
}

/** A permission answered here, kept where it was until the place is left: the call, and what was said. */
export interface AnsweredCall {
  readonly call: HomeCall
  readonly reply: Reply
}

/** What an answered call's line says, in the glossary's words. */
const answerOf = (reply: Reply, project: ProjectRef): NonNullable<Need['answer']> => {
  const t = needText.settled
  const denied = reply.decision === 'reject'
  return {
    kind: denied ? t.denied : t.allowed,
    said: reply.always === undefined ? t.once : denied ? t.never : t.always,
    note: reply.always !== undefined ? t.keptIn(project.name) : (reply.reason ?? t.answeredIn(project.name)),
    denied,
  }
}

/** Whether one call came before another, in the store's order: when each came, then its id. */
const before = (a: HomeCall, b: HomeCall) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)

/**
 * The calls as the runtime lists them, with each answered here that it no
 * longer lists put back where it came, so a line answered stays where it was.
 */
const withAnswered = (calls: ReadonlyArray<HomeCall>, answered: ReadonlyArray<AnsweredCall>): ReadonlyArray<HomeCall> =>
  answered
    .map((one) => one.call)
    .filter((call) => !calls.some((listed) => listed.id === call.id))
    .reduce<ReadonlyArray<HomeCall>>((all, call) => {
      const at = all.findIndex((listed) => before(call, listed))
      return at === -1 ? [...all, call] : [...all.slice(0, at), call, ...all.slice(at)]
    }, calls)

/** What a ready task's line says to accept it by: its change, where and how its checks went and how big, or what is on its branch. */
export const briefOf = (task: HomeTask): string => {
  // A review drafted: their pull request, whose, and what the draft found.
  const reviewing = task.reviewing
  if (reviewing != null)
    return [
      `${reviewing.repository.slice(reviewing.repository.lastIndexOf('/') + 1)} #${reviewing.number}`,
      needText.by(reviewing.author),
      needText.findings(reviewing.findings),
    ].join(' · ')
  // A task that isn't a change, finished: what its lead said, in its first line; else where it wrote.
  if (task.kind === 'plain') {
    const said = task.summary?.split('\n').find((line) => line.trim() !== '')
    if (said !== undefined) return said
  }
  const change = task.change
  // Commits after its last pull request merged or closed: a new one is the person's to open.
  const after = task.unshipped
  if (after != null && isUnshipped(task)) return needText.inNone(after.commits, after.add, after.del)
  if (change === null)
    return task.changed === null ? needText.onBranch : needText.branchSize(task.changed.files, task.changed.add, task.changed.del)
  const where = `${change.repository.slice(change.repository.lastIndexOf('/') + 1)} ${change.prefix}${change.number}`
  // One merged or closed has nothing in its way; it says only which it was.
  if (change.state !== 'open') return where
  // What stands between it and merging, as the board's card says it, or how its checks went where nothing does; then how big.
  const size = change.additions === null || change.deletions === null ? [] : [`+${change.additions} −${change.deletions}`]
  return [where, ...factsOf(change).map((one) => one.words), ...size].join(' · ')
}

/** The one next thing a ready task's open pull request needs, where it has one: none for a review, a plain task, or a conflict handed back. */
export const nextOf = (task: HomeTask): Next | null =>
  task.kind !== 'change' || task.handedBack != null || task.change === null || task.change.state !== 'open'
    ? null
    : standingOf(task.change).next

/** The calls first, then the tasks ready to accept; any in a project not known yet waits until it is. */
export const needsOf = ({
  calls,
  answered = [],
  ready,
  refs,
  agentName,
  modelName,
}: {
  /** The calls as the runtime lists them, answered here or not. */
  calls: ReadonlyArray<HomeCall>
  /** Calls answered here: each stays where it was, among the others, as it was answered. */
  answered?: ReadonlyArray<AnsweredCall>
  ready: ReadonlyArray<HomeTask>
  refs: ReadonlyMap<string, ProjectRef>
  agentName: (id: string | null) => string
  /** A model by its name, for who asks a question; the agent's name without it. */
  modelName?: (agentId: string, model: string | null) => string
}): ReadonlyArray<Need> => [
  ...withAnswered(calls, answered).flatMap((call): ReadonlyArray<Need> => {
    const project = refs.get(call.projectId)
    if (project === undefined) return []
    const reply = answered.find((one) => one.call.id === call.id)?.reply
    if (reply !== undefined)
      return [
        {
          id: call.id,
          threadId: call.threadId,
          kind: kindWords.permission,
          project,
          title: titleOf(call),
          ...commandOf(call),
          answer: answerOf(reply, project),
        },
      ]
    const stuck = call.stuck
    // An agent's question is answered where it was asked: its line says what it asks, and opens it there.
    // A question's line stays calm: what it asks first, why, and Answer takes the person to it, where its options are.
    if (call.kind === 'question') {
      const brief = questionBrief(call, modelName ?? agentName)
      return [
        {
          id: call.id,
          threadId: call.threadId,
          kind: kindWords.question,
          project,
          title: call.title,
          ...(brief === undefined ? {} : { brief }),
        },
      ]
    }
    return [
      stuck === null
        ? {
            id: call.id,
            threadId: call.threadId,
            kind: kindWords.permission,
            project,
            title: titleOf(call),
            ...commandOf(call),
            permission: call,
          }
        : {
            id: call.id,
            threadId: call.threadId,
            kind: callKindOf(call),
            project,
            title: whereOf(call),
            brief:
              stuck.step === 'publish' && stuck.why !== 'not_connected'
                ? stuckText.publishing(stuck)
                : stuckText.what(stuck, agentName(stuck.agentId) || 'The agent'),
          },
    ]
  }),
  ...ready.flatMap((task): ReadonlyArray<Need> => {
    const project = refs.get(task.projectId)
    // `ready` is the tasks that wait on the person (`readyOf`): a task that finished and isn't a change among them.
    if (project === undefined) return []
    const next = nextOf(task)
    return [
      {
        id: task.taskId,
        threadId: task.threadId,
        kind: readyKindOf(task),
        project,
        title: task.title,
        brief: task.handedBack ?? briefOf(task),
        ...(next === null ? {} : { ready: { task, next } }),
      },
    ]
  }),
]

/** A permission's Allow once on its line: what Enter gives, where focus is put on it. */
export const DEFAULT_ANSWER = '[data-default-answer]'

/**
 * A need's line: its title opens its task; a permission's answers give it
 * there (Deny and Allow once, unless the place gives every answer the call
 * offers, as the home does); a ready change's button is the one next thing
 * its pull request needs, where the place does it (`onNext`); the others'
 * button opens it too.
 */
export function needLineOf(
  need: Need,
  {
    onOpen,
    onAnswer,
    answers,
    onNext,
    doing,
    failed,
  }: {
    onOpen: (threadId: string) => void
    onAnswer: (call: HomeCall, project: ProjectRef, decision: 'allow' | 'reject') => void
    /** A permission's answers, in place of Deny and Allow once. */
    answers?: (call: HomeCall, project: ProjectRef) => ReactNode
    /** Does a ready change's next thing; without it, its button opens the task to review. */
    onNext?: (task: HomeTask, next: DoneHere) => void
    /** Whether a task's next thing is under way, so its button says so and waits. */
    doing?: (taskId: string) => boolean
    /** What last failed for a task's push or merge, to say in its line and offer to try again. */
    failed?: (taskId: string) => ActionFailure | undefined
  },
): ReactNode {
  const open = () => onOpen(need.threadId)
  const { permission, answer, ready } = need
  // The next thing done from here, if it is the person's own; and why it failed last time, if it did.
  const here = ready !== undefined && onNext !== undefined && doneHere(ready.next) ? ready.next : null
  const failure = ready === undefined ? undefined : failed?.(ready.task.taskId)
  const why = here !== null && failure !== undefined && failure.action === here.kind ? failure.message : null
  // Answered here: where it was, as high as it was, quiet; focus comes to it from the button pressed.
  if (answer !== undefined)
    return (
      <NeedLine
        key={need.id}
        data-move={need.id}
        kind={answer.kind}
        project={need.project}
        title={need.title}
        {...(need.command === undefined ? {} : { command: need.command })}
        onOpen={open}
        answer={{ said: answer.said, note: answer.note, ...(answer.denied ? { denied: true } : {}) }}
        focusOnMount
      />
    )
  return (
    <NeedLine
      key={need.id}
      data-move={need.id}
      kind={need.kind}
      project={need.project}
      title={need.title}
      {...(need.command === undefined ? {} : { command: need.command })}
      {...(why !== null && here !== null
        ? {
            brief: (
              <>
                <Fact icon="close" tone="danger" role="alert">
                  {standingText.nextFailed[here.kind](why)}
                </Fact>
                {need.brief !== undefined && <> · {need.brief}</>}
              </>
            ),
          }
        : need.brief === undefined
          ? {}
          : { brief: need.brief })}
      onOpen={open}
      actions={
        ready !== undefined && onNext !== undefined ? (
          here === null ? (
            // Asking the lead to resolve or fix takes the lead: a link into the task, where it is told.
            <LinkButton onClick={open}>{nextWords(ready.next)}</LinkButton>
          ) : (
            <Button
              size="small"
              // Merging and pushing are the person's own to do, so they're violet.
              variant="signal"
              // The pull request it acts on, for a screen reader: the line's own words don't name it.
              {...(ready.task.change === null
                ? {}
                : { 'aria-label': labelWords(here, `${ready.task.change.prefix}${ready.task.change.number}`, why !== null) })}
              busy={doing?.(ready.task.taskId) === true}
              onClick={() => onNext(ready.task, here)}
            >
              {doing?.(ready.task.taskId) === true ? doingWords(here) : why === null ? nextWords(here) : standingText.nextFailed.again}
            </Button>
          )
        ) : permission === undefined ? (
          <Button size="small" {...(need.kind === kindWords.question ? { variant: 'signal' as const } : {})} onClick={open}>
            {need.kind === kindWords.ready || need.kind === kindWords.drafted
              ? needText.review
              : need.kind === kindWords.question
                ? needText.answer
                : needText.look}
          </Button>
        ) : answers !== undefined ? (
          answers(permission, need.project)
        ) : (
          <>
            <Button size="small" onClick={() => onAnswer(permission, need.project, 'reject')}>
              {needText.deny}
            </Button>
            {/* The answer Enter gives, where a place puts focus on it as it opens (`DEFAULT_ANSWER`). */}
            <Button size="small" variant="signal" data-default-answer="" onClick={() => onAnswer(permission, need.project, 'allow')}>
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
