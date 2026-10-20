import type { AttentionRequest } from '@althar/contracts'
import { ActionButton, GraphNodeState, Markdown, StepGraph, unreachable } from '@althar/ui'
import { type ReactNode, useState } from 'react'

import type { StepFacts, TaskGraph } from './graph'
import s from './GraphFace.module.css'
import { PublishedReport, ReviewReport } from './Reports'

/*
 * A task's Graph face (ADR-054): its steps as the kit's StepGraph draws them,
 * a card opening its step's report in a popover by it, or, where the step
 * waits on the person, the call to answer there, as the conversation has it.
 * A marker, and a report's way to it, take the person to that place in the
 * conversation.
 */

export const graphFaceText = {
  show: 'Show in the conversation',
  question: 'It waits for your answer in the conversation.',
  now: (took: string | undefined) => (took === undefined ? 'At work now.' : `At work for ${took}.`),
  held: 'It waits for a free agent, and starts as soon as one is.',
  limit: 'It waits for its agent’s usage limit to reset.',
  next: 'Still to come.',
  added: 'Added by a change to its steps; it runs once the steps before it are done.',
  stopped: 'Stopped before it finished.',
  proposed: 'A change to its steps, waiting for your say.',
  waiting: 'It waits for you in the conversation.',
  done: 'Done.',
}

export interface GraphFaceProps {
  graph: TaskGraph
  /** A stuck step's call, as the conversation draws it, answered where it opens. */
  stuck: (call: AttentionRequest) => ReactNode
  /** Permissions waiting, as the conversation draws them. */
  permissions: (calls: ReadonlyArray<AttentionRequest>) => ReactNode
  /** Goes to an item of the conversation by its id; with none, to the conversation as it is. */
  onShow: (itemId: string | undefined) => void
  className?: string
}

export function GraphFace({ graph, stuck, permissions, onShow, className }: GraphFaceProps) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <StepGraph
      className={className}
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
          <StepDetail facts={facts} took={card?.corner} stuck={stuck} permissions={permissions} onShow={onShow} />
        )
      }}
    />
  )
}

/** What a step's popover holds: the call waiting on it, else its report, else where it stands, in a line. */
function StepDetail({
  facts,
  took,
  stuck,
  permissions,
  onShow,
}: {
  facts: StepFacts
  took: string | undefined
  stuck: GraphFaceProps['stuck']
  permissions: GraphFaceProps['permissions']
  onShow: GraphFaceProps['onShow']
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
