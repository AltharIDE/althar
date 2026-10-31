import type { AttentionRequest } from '@althar/contracts'
import { ActionButton, GraphNodeState, LinkButton, Markdown, StepGraph, unreachable } from '@althar/ui'
import { type ReactNode, useState } from 'react'

import type { StepFacts, TaskGraph } from './graph'
import s from './GraphFace.module.css'
import { PublishedReport, ReviewReport } from './Reports'

/*
 * A task's Graph face (ADR-054): its steps as the kit's StepGraph draws them,
 * a card opening its step's report in a popover by it, or, where the step
 * waits on the person, the call to answer there, as the conversation has it.
 * A marker, and a report's way to it, take the person to that place in the
 * conversation. An answer given here that didn't go through says so where it
 * was given, or on the face once its popover is closed.
 */

export const graphFaceText = {
  show: 'Show in the conversation',
  question: 'Waiting for your answer.',
  now: (took: string | undefined) => (took === undefined ? 'At work.' : `At work for ${took}.`),
  held: 'Waiting for a free agent.',
  limit: 'Waiting for usage to reset.',
  next: 'Not started.',
  added: 'Added to the plan.',
  stopped: 'Stopped.',
  proposed: 'Proposed, waiting for you.',
  waiting: 'Waiting for you.',
  done: 'Done.',
  dismiss: 'Dismiss',
}

export interface GraphFaceProps {
  graph: TaskGraph
  /** A stuck step's call, as the conversation draws it, answered where it opens. */
  stuck: (call: AttentionRequest) => ReactNode
  /** Permissions waiting, as the conversation draws them. */
  permissions: (calls: ReadonlyArray<AttentionRequest>) => ReactNode
  /** Goes to an item of the conversation by its id; with none, to the conversation as it is. */
  onShow: (itemId: string | undefined) => void
  /** What went wrong with the last thing done in the window, an answer given here among them; and its dismissal. */
  error?: string | null
  onDismissError?: () => void
  className?: string
}

export function GraphFace({ graph, stuck, permissions, onShow, error = null, onDismissError, className }: GraphFaceProps) {
  const [open, setOpen] = useState<string | null>(null)
  const failure = error === null ? null : <Failure error={error} {...(onDismissError === undefined ? {} : { onDismiss: onDismissError })} />
  // Where a step's popover is open, it says so there, by what was answered; else on the face.
  const inPopover = open !== null && graph.facts.has(open)
  return (
    <div className={className === undefined ? s.face : `${s.face} ${className}`}>
      <StepGraph
        lanes={graph.lanes}
        rounds={graph.rounds}
        steps={graph.steps}
        open={open}
        onOpenChange={setOpen}
        onRound={(id) => onShow(graph.saidAt.get(id))}
        detail={(id) => {
          const facts = graph.facts.get(id)
          const card = graph.steps.find((step) => step.id === id)
          return facts === undefined ? null : (
            <StepDetail facts={facts} took={card?.corner} stuck={stuck} permissions={permissions} onShow={onShow} failure={failure} />
          )
        }}
      />
      {!inPopover && failure !== null && <div className={s.floating}>{failure}</div>}
    </div>
  )
}

/** What went wrong, in a line, with the way to put it away. */
function Failure({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  return (
    <p className={s.failure} role="alert">
      {error} {onDismiss !== undefined && <LinkButton onClick={onDismiss}>{graphFaceText.dismiss}</LinkButton>}
    </p>
  )
}

/** What a step's popover holds: the call waiting on it, else its report, else where it stands, in a line. */
function StepDetail({
  facts,
  took,
  stuck,
  permissions,
  onShow,
  failure,
}: {
  facts: StepFacts
  took: string | undefined
  stuck: GraphFaceProps['stuck']
  permissions: GraphFaceProps['permissions']
  onShow: GraphFaceProps['onShow']
  failure: ReactNode
}) {
  const { report, calls, step } = facts
  const asking = calls.filter((call) => call.kind === 'permission')
  const body = (() => {
    if (calls.length > 0)
      return (
        <>
          {calls.filter((call) => call.kind === 'stuck').map((call) => stuck(call))}
          {asking.length > 0 && permissions(asking)}
          {calls.some((call) => call.kind === 'question') && <p className={s.line}>{graphFaceText.question}</p>}
        </>
      )
    if (report !== null) {
      switch (step.key) {
        case 'review':
          return <ReviewReport id={report.id} result={report.content} />
        case 'publish':
          return <PublishedReport result={report.content} />
        case 'implement':
        case 'settle':
          return <Markdown source={report.content.built ?? report.content.summary} />
        default:
          return unreachable(step.key)
      }
    }
    return <p className={s.line}>{lineOf(facts, took)}</p>
  })()
  return (
    <div className={s.detail}>
      {failure}
      {body}
      {report !== null && (
        <ActionButton size="small" trailingIcon="arrow" className={s.show} onClick={() => onShow(report.id)}>
          {graphFaceText.show}
        </ActionButton>
      )}
    </div>
  )
}

/** Where a step without a report stands, in a line. */
const lineOf = (facts: StepFacts, took: string | undefined): string => {
  switch (facts.state) {
    case GraphNodeState.Now:
      return graphFaceText.now(took)
    case GraphNodeState.Held:
      return facts.step.hold === 'usage_limit' ? graphFaceText.limit : graphFaceText.held
    case GraphNodeState.Next:
      return graphFaceText.next
    case GraphNodeState.Added:
      return graphFaceText.added
    case GraphNodeState.Stopped:
      return graphFaceText.stopped
    case GraphNodeState.Proposed:
      return graphFaceText.proposed
    case GraphNodeState.Waiting:
      return graphFaceText.waiting
    case GraphNodeState.Done:
      return graphFaceText.done
    default:
      return unreachable(facts.state)
  }
}
