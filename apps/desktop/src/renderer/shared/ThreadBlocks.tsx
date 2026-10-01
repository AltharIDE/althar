import { Fragment, type ReactNode } from 'react'

import {
  CodeBlock,
  FindingState,
  Markdown,
  Plan,
  Prose,
  Reasoning,
  Review,
  type ReviewFinding,
  Severity,
  Step,
  StepState,
  ThreadDivider,
  Tool,
  Turn,
  Verdict,
  WorkedFor,
  You,
} from '@charrette/ui'

import { modelInfo } from './agents'
import type { Block, Part, StepResult, TaskCardContent } from './thread'
import s from './ThreadBlocks.module.css'

/*
 * A thread's blocks as the kit draws them, the same in a task and in the
 * coordinator's thread. A turn's work folds under how long it worked, or is
 * working, with its last message open under it; a step's result stands open
 * under the work that led to it. A task's card is the host's
 * to draw, since what it can do with one is the host's.
 */

/** How long a command can be before its row, at the thread's width, clips it. */
const LONG_COMMAND = 72

export const text = {
  thought: 'Thought',
  shell: 'Shell',
  step: { implement: 'Implement', review: 'Review', settle: 'Settle' } satisfies Record<StepResult['step'], string>,
}

const SEVERITY: Readonly<Record<StepResult['findings'][number]['severity'], Severity>> = {
  blocking: Severity.High,
  major: Severity.High,
  minor: Severity.Medium,
  nit: Severity.Low,
}

function PartView({ part }: { part: Part }) {
  switch (part.kind) {
    case 'message':
      return <Markdown source={part.text} />
    case 'thought':
      return (
        <Reasoning took="" text={{ thought: () => text.thought }}>
          <Prose dim>{part.text}</Prose>
        </Reasoning>
      )
    case 'tool':
      return (
        <Tool
          kind={part.toolKind}
          verb={part.verb}
          target={part.target}
          state={part.state}
          {...(part.command === null ? {} : { copy: part.command })}
        >
          {/* A command too long for its row, or over several lines, opens to show all of it. */}
          {part.command !== null && (part.command.includes('\n') || part.command.length > LONG_COMMAND) ? (
            <CodeBlock code={part.command} lang={text.shell} />
          ) : undefined}
        </Tool>
      )
    case 'plan':
      return <Plan steps={part.steps} />
    case 'notice':
      return <p className={s[part.tone]}>{part.text}</p>
  }
}

/** What a step reported: the lead's summary, open under its work, or the review's verdict and findings. */
function StepView({ id, result, of, agentName }: { id: string; result: StepResult; of: number; agentName: (id: string | null) => string }) {
  const model = result.agentId === null ? undefined : modelInfo({ id: result.agentId, name: agentName(result.agentId) }, null)
  if (result.step !== 'review')
    return (
      <Step
        n={result.step === 'implement' ? 1 : of}
        of={of}
        label={text.step[result.step]}
        state={StepState.Done}
        {...(model === undefined ? {} : { model })}
        defaultOpen
        detail={<Markdown source={result.summary} />}
      />
    )
  // The lead settles findings on its own for now: what the review found is left to it.
  const findings: ReadonlyArray<ReviewFinding> = result.findings.map((finding, index) => ({
    id: `${id}-${index}`,
    severity: SEVERITY[finding.severity],
    at: finding.file === null ? '' : finding.line === null ? finding.file : `${finding.file}:${finding.line}`,
    by: model === undefined ? [] : [model],
    state: FindingState.Lead,
    claim: finding.claim,
  }))
  return (
    <>
      <Review
        n={of}
        of={of}
        reviewers={model === undefined ? [] : [{ model }]}
        verdict={result.verdict === 'pass' ? Verdict.Pass : Verdict.Changes}
        defaultFindings={findings}
        {...(result.round > 0 ? { round: result.round + 1 } : {})}
      />
      {result.summary !== '' && (
        <div className={s.said}>
          <Markdown source={result.summary} />
        </div>
      )}
    </>
  )
}

export function ThreadBlocks({
  blocks,
  agentName,
  card,
  queued,
}: {
  blocks: ReadonlyArray<Block>
  agentName: (id: string | null) => string
  /** Draws a task's card, in the coordinator's thread. */
  card?: (card: TaskCardContent) => ReactNode
  /** What a message still waiting says: who reads it next. */
  queued?: string
}) {
  // A task that was reviewed has two steps; the review, and settling it, are the second.
  const of = blocks.some((block) => block.kind === 'step' && block.result.step !== 'implement') ? 2 : 1
  return blocks.map((block) => {
    switch (block.kind) {
      case 'you':
        return (
          <You key={block.id} at={block.at} delivery={block.delivery} {...(queued === undefined ? {} : { text: { queued } })}>
            {block.text}
          </You>
        )
      case 'divider':
        return (
          <ThreadDivider key={block.id} icon="agents">
            {block.text}
          </ThreadDivider>
        )
      case 'step':
        return <StepView key={block.id} id={block.id} result={block.result} of={of} agentName={agentName} />
      case 'card':
        return <Fragment key={block.id}>{card?.(block.card)}</Fragment>
      case 'turn':
        return (
          <Turn key={block.id} model={modelInfo({ id: block.agentId ?? 'agent', name: agentName(block.agentId) }, null)} at={block.at}>
            {block.work.length > 0 && (
              <WorkedFor took={block.took} live={block.live} {...(block.doing === null ? {} : { summary: block.doing })}>
                {block.work.map((part) => (
                  <PartView key={part.id} part={part} />
                ))}
              </WorkedFor>
            )}
            {block.said.map((part) => (
              <PartView key={part.id} part={part} />
            ))}
          </Turn>
        )
    }
  })
}
