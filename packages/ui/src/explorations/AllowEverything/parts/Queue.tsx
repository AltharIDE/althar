import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import { AllowedBy, Decision } from '../../../foundations/vocabulary'
import { AskAnswered, AskNote } from '../../../primitives/Ask/Ask'
import { Allowed, permissionText, type PermissionRequest, refuses } from '../../../thread/Permission/Permission'
import { ESCALATE, type PromptAnswer, type PromptCardProps, StackFrame } from './PromptCard'

/*
 * A task's waiting requests, as the thread's stack shows them: one card in
 * front, the edges of the rest under it, each answer folding to its line.
 * What a path adds is how the rest can go at once: answered by stopping
 * asking from the card in front (C), or let through from outside, by a
 * switch or a mode turned on while they waited (A, B, D). Then whatever
 * was still waiting folds into one quiet line saying what let it through,
 * which opens to each command. What went ahead stays gone if the switch is
 * turned off again: it has already run.
 */

export interface QueueText {
  /** The card answered by stopping asking. */
  escalated: string
  escalatedNote: string
  /** What let the rest through, when it was stopping asking: the line under them, and each one's reason. */
  escalatedRest: string
  escalatedRule: string
  undo: string
}

export const queueText: QueueText = {
  escalated: 'Allowed, and stopped asking on this task',
  escalatedNote: '· what follows on it goes ahead',
  escalatedRest: 'waiting when you stopped asking',
  escalatedRule: 'Stopped asking on this task',
  undo: 'Ask again',
}

/** What let the waiting requests through at once: the line's reason, and each request's. */
export interface ClearedBy {
  why: string
  rule: string
}

export interface QueueProps {
  items: readonly PermissionRequest[]
  project: string
  /** The card in front, with what its path adds to it. */
  card: (request: PermissionRequest, card: Pick<PromptCardProps, 'pos' | 'total' | 'onAnswer' | 'onAll' | 'phase'>) => ReactNode
  /** Let through from outside while they waited, by a switch or a mode. Null while they wait. */
  clearedBy?: ClearedBy | null
  /** The card in front was answered by stopping asking on the task. */
  onEscalate?: () => void
  /** Stopping asking taken back: what hadn't run yet waits again. */
  onUndoEscalate?: () => void
  text?: Partial<QueueText>
}

const BEAT = 420
const OUT = 220

export function Queue({ items, project, card, clearedBy = null, onEscalate, onUndoEscalate, text }: QueueProps) {
  const t = { ...queueText, ...text }
  const [answers, setAnswers] = useState<ReadonlyMap<string, PromptAnswer>>(new Map())
  const [through, setThrough] = useState<{ ids: readonly string[]; by: ClearedBy } | null>(null)
  const [phase, setPhase] = useState<'beat' | 'out' | 'outNo' | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((x) => window.clearTimeout(x)), [])
  const later = (f: () => void, ms: number) => timers.current.push(window.setTimeout(f, ms))

  const waiting = items.filter((it) => !answers.has(it.id) && !through?.ids.includes(it.id))
  // Let through from outside: whatever waits goes, once, and stays gone.
  if (clearedBy !== null && through === null && waiting.length > 0) setThrough({ ids: waiting.map((it) => it.id), by: clearedBy })
  const current = waiting[0]

  // Yes beats once in violet and lifts away; no steps aside. Only then is the answer kept, as the thread's stack does.
  const answer = (request: PermissionRequest, a: PromptAnswer) => {
    const done = () => {
      setPhase(null)
      setAnswers((now) => new Map(now).set(request.id, a))
      if (a.decision === ESCALATE) {
        setThrough({
          ids: waiting.filter((it) => it.id !== request.id).map((it) => it.id),
          by: { why: t.escalatedRest, rule: t.escalatedRule },
        })
        onEscalate?.()
      }
    }
    if (a.decision !== ESCALATE && refuses(a.decision)) {
      setPhase('outNo')
      later(done, OUT)
    } else {
      setPhase('beat')
      later(() => setPhase('out'), BEAT)
      later(done, BEAT + OUT)
    }
  }
  const allowAll = () =>
    setAnswers(
      new Map([...answers, ...waiting.map((it): [string, PromptAnswer] => [it.id, { decision: Decision.AllowOnce, cmd: it.cmd }])]),
    )

  const lines = items.flatMap((it) => {
    const a = answers.get(it.id)
    if (a === undefined) return []
    if (a.decision === ESCALATE)
      return [
        <AskAnswered
          key={it.id}
          said={t.escalated}
          undo={t.undo}
          onUndo={
            onUndoEscalate &&
            (() => {
              setAnswers(new Map())
              setThrough(null)
              onUndoEscalate()
            })
          }
        >
          <AskNote>{t.escalatedNote}</AskNote>
        </AskAnswered>,
      ]
    return [
      <AskAnswered key={it.id} denied={refuses(a.decision)} said={permissionText.decided[a.decision]}>
        <AskNote code>{a.cmd}</AskNote>
      </AskAnswered>,
    ]
  })
  const letThrough = through === null ? [] : items.filter((it) => through.ids.includes(it.id))
  return (
    <>
      {lines}
      {through !== null && letThrough.length > 0 && (
        <Allowed
          items={letThrough.map((it) => ({ id: it.id, step: it.step, cmd: it.cmd, by: AllowedBy.Rule, rule: through.by.rule }))}
          project={project}
          text={{ allowedWho: () => through.by.why }}
        />
      )}
      {current !== undefined && (
        <StackFrame behind={waiting.length - 1}>
          {/* a card of its own for each request, so what was picked on one isn't carried to the next */}
          <Fragment key={current.id}>
            {card(current, {
              pos: items.length - waiting.length + 1,
              total: items.length,
              phase,
              onAnswer: (a) => {
                if (!phase) answer(current, a)
              },
              onAll: allowAll,
            })}
          </Fragment>
        </StackFrame>
      )}
    </>
  )
}
