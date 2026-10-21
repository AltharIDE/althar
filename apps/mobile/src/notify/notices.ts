import type { HomeCall, HomeTask } from '@althar/contracts'

import { callKindOf, readyKindOf } from '../model/calls'
import { whoWorks } from '../model/words'

/*
 * What taps the person, as data: which category a notice is, what it says,
 * and what each of its buttons does. Pure, so the rules are tested; the
 * notifications module only hands them to the system.
 *
 * Two groups (docs/design.md): Needs you interrupts (time sensitive,
 * threaded by task); For your information arrives quietly. On a permission,
 * Deny answers from the notification, without opening the app; Allow opens
 * it, for Face ID: an action can ask the phone to be unlocked, not for the
 * person's face, and allowing is the person's word.
 */

export const CATEGORIES = {
  permission: {
    id: 'althar.permission',
    actions: [
      { id: 'deny', title: 'Deny', opens: false, destructive: true },
      { id: 'allow', title: 'Allow once…', opens: true, destructive: false },
    ],
  },
  question: { id: 'althar.question', actions: [{ id: 'open', title: 'Answer…', opens: true, destructive: false }] },
  stuck: { id: 'althar.stuck', actions: [{ id: 'open', title: 'Decide…', opens: true, destructive: false }] },
  ready: { id: 'althar.ready', actions: [{ id: 'open', title: 'Open', opens: true, destructive: false }] },
  away: { id: 'althar.away', actions: [] },
} as const

export type Group = 'needs' | 'fyi'

/** What a notice carries, once the phone has opened it: enough to show it and to act on it, nothing more. */
export type NoticeData =
  | {
      readonly kind: 'call'
      readonly callKind: 'permission' | 'question' | 'stuck'
      readonly attentionId: string
      readonly threadId: string
    }
  | { readonly kind: 'ready'; readonly threadId: string }
  | { readonly kind: 'away'; readonly waiting: number }

export type Notice = {
  readonly category: string
  readonly group: Group
  readonly title: string
  readonly body: string
  /** Notices about one task stack together. */
  readonly thread: string | null
  readonly data: NoticeData
}

const where = (project: string | null, task: string | null): string => [project, task].filter(Boolean).join(' · ')

/** A call, as it taps the person. */
export const callNotice = (call: HomeCall, project: string | null): Notice => {
  const callKind = call.kind === 'permission' ? 'permission' : call.kind === 'question' ? 'question' : 'stuck'
  const asker = call.question?.askedBy === undefined ? null : whoWorks(call.question.askedBy.agentId, call.question.askedBy.model)
  return {
    category: CATEGORIES[callKind].id,
    group: 'needs',
    title: `${callKindOf(call)} · ${where(project, call.taskTitle ?? 'Coordinator')}`,
    body:
      callKind === 'permission'
        ? `${call.title}${call.command === null ? '' : `\n${call.label ?? call.command}`}`
        : callKind === 'question'
          ? `${asker === null ? '' : `${asker}: `}${call.question?.fields[0]?.question ?? call.title}`
          : `${call.title}${call.stuck?.detail == null ? '' : `: ${call.stuck.detail}`}`,
    thread: call.threadId,
    data: { kind: 'call', callKind, attentionId: call.id, threadId: call.threadId },
  }
}

/** Work ready, as it tells the person: quietly. */
export const readyNotice = (task: HomeTask, project: string | null): Notice => ({
  category: CATEGORIES.ready.id,
  group: 'fyi',
  title: `${readyKindOf(task)} · ${project ?? ''}`.replace(/ · $/, ''),
  body: [
    task.title,
    task.change?.checks == null
      ? null
      : `checks ${task.change.checks.passed}/${task.change.checks.total}, +${task.change.additions ?? 0} −${task.change.deletions ?? 0}`,
  ]
    .filter(Boolean)
    .join(': '),
  thread: task.threadId,
  data: { kind: 'ready', threadId: task.threadId },
})

/** The Mac went away with calls waiting: the relay sends this from its heartbeats alone, knowing nothing else. */
export const awayNotice = (mac: string, waiting: number): Notice => ({
  category: CATEGORIES.away.id,
  group: 'needs',
  title: `${mac} went away`,
  body: `${waiting} ${waiting === 1 ? 'call waits' : 'calls wait'} there. Wake it to answer.`,
  thread: null,
  data: { kind: 'away', waiting },
})

/** What a tap on a notice, or on one of its buttons, does. */
export type Response =
  | { readonly kind: 'deny'; readonly attentionId: string }
  | { readonly kind: 'open'; readonly href: string }
  | { readonly kind: 'nothing' }

export const responseTo = (action: string, data: NoticeData): Response => {
  switch (data.kind) {
    case 'call':
      if (data.callKind === 'permission' && action === 'deny') return { kind: 'deny', attentionId: data.attentionId }
      if (data.callKind === 'permission' && action === 'allow') return { kind: 'open', href: `/call/${data.attentionId}?allow=1` }
      return { kind: 'open', href: data.callKind === 'question' ? `/task/${data.threadId}` : `/call/${data.attentionId}` }
    case 'ready':
      return { kind: 'open', href: `/task/${data.threadId}` }
    case 'away':
      return { kind: 'open', href: '/' }
  }
}

/** When an answer from a notice didn't reach the Mac: said, so the person knows the agent still waits. */
export const notDelivered = (why: string): Pick<Notice, 'title' | 'body' | 'group'> => ({
  title: 'Not delivered',
  body: `Your Deny didn’t reach your Mac (${why}). The agent still waits: answer it in Althar.`,
  group: 'needs',
})

/** The calls that weren't there before: what a watch's new home brings to tap the person about. */
export const newCalls = (before: ReadonlyArray<HomeCall>, after: ReadonlyArray<HomeCall>): ReadonlyArray<HomeCall> => {
  const seen = new Set(before.map((call) => call.id))
  return after.filter((call) => !seen.has(call.id))
}
