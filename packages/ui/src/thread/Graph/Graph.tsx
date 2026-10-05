import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { AllowedBy, GraphAnswer, GraphNodeState, unreachable } from '../../foundations/vocabulary'
import { cssVars } from '../../lib/cssVars'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { useOnScreen } from '../../lib/onScreen'
import { Button } from '../../primitives/Button/Button'
import { Disclosure, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { StepMore } from '../Step/Step'
import s from './Graph.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * How a task's graph changes, in the thread. A change inside what the run may
 * already do applies at once and says so in one line; for a few seconds it
 * can be undone, and the nodes it adds are held until then, so undoing costs
 * nothing. A change that needs more than the run was given waits for you.
 */

export interface GraphNode {
  id: string
  label: string
  state: GraphNodeState
}

function Mark({ state }: { state: GraphNodeState }) {
  switch (state) {
    case GraphNodeState.Done:
      return <Icon name="check" size={9} />
    case GraphNodeState.Now:
      return <span className={s.dot} aria-hidden="true" />
    case GraphNodeState.Stopped:
      return <Icon name="square" size={8} />
    case GraphNodeState.Added:
      return <Icon name="plus" size={9} />
    case GraphNodeState.Next:
      return null
    default:
      return unreachable(state)
  }
}

export interface GraphStripText {
  /** Each node's state, for assistive technology. */
  state: Record<GraphNodeState, string>
  label: string
}

export const graphStripText: GraphStripText = {
  state: {
    [GraphNodeState.Done]: 'done',
    [GraphNodeState.Now]: 'running',
    [GraphNodeState.Next]: 'next',
    [GraphNodeState.Added]: 'added',
    [GraphNodeState.Stopped]: 'stopped',
  },
  label: 'The task’s steps',
}

/** The task's nodes in a row. Added nodes are dashed until they run; a stopped attempt stays, hollow. */
export function GraphStrip({ nodes, text }: { nodes: readonly GraphNode[]; text?: Partial<GraphStripText> }) {
  const t = { ...graphStripText, ...text }
  return (
    <ol className={s.strip} aria-label={t.label}>
      {nodes.map((node, i) => (
        <li key={node.id} className={s.item}>
          {i > 0 && <i className={s.edge} aria-hidden="true" />}
          <span className={cx(s.node, s[node.state])}>
            <Mark state={node.state} />
            {node.label}
            <VisuallyHidden>, {t.state[node.state]}</VisuallyHidden>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Who changed the graph: the lead, with its reason, or one of the project's rules. */
export type GraphCause = { by: AllowedBy.Lead; lead: ModelInfo; why: string } | { by: AllowedBy.Rule; rule: string }

function Cause({ cause, project, t }: { cause: GraphCause; project: string; t: GraphChangedText }) {
  switch (cause.by) {
    case AllowedBy.Rule:
      return <>{t.byRule(cause.rule, project)}</>
    case AllowedBy.Lead:
      return <>{t.byModel(<Model model={cause.lead} short />, cause.why)}</>
    default:
      return unreachable(cause)
  }
}

export interface GraphChangedText {
  changed: string
  undone: string
  rev: (n: number) => string
  undo: string
  /** Seconds left to undo, beside Undo. Not part of its name, so the name holds still. */
  left: (seconds: number) => string
  detail: string
  byRule: (rule: string, project: string) => string
  byModel: (model: ReactNode, why: string) => ReactNode
}

export const graphChangedText: GraphChangedText = {
  changed: 'Graph changed',
  undone: 'Graph change undone',
  rev: (n) => `rev ${n}`,
  undo: 'Undo',
  left: (n) => `${n}s`,
  detail: 'What changed',
  byRule: (rule, project) => `Added by ${project}’s rule: ${rule}. Rules apply without asking.`,
  byModel: (model, why) => (
    <>
      Proposed by {model} {why}. Inside what this run may already do, so it applied without asking.
    </>
  ),
}

export interface GraphChangedProps extends Disclosable {
  /** The graph's revision after the change. */
  rev: number
  /** The change, in a line. */
  summary: string
  nodes: readonly GraphNode[]
  /** Each thing the change did, in a sentence. */
  ops: readonly string[]
  cause: GraphCause
  project: string
  /** Settled: past the time to undo, as the consumer knows it. Takes effect whenever it turns true. */
  settled?: boolean
  /** Seconds the change can be undone for, once seen. */
  undoFor?: number
  /** Undo the change. Without it, there is no Undo. */
  onUndo?: () => void
  className?: string
  text?: Partial<GraphChangedText>
}

/**
 * A graph change that applied without asking: one line, which opens to what
 * changed and why; Undo for a few seconds, counted from when you first see
 * it. The count holds while you point at the line or are in it, so it never
 * runs out under your hand.
 */
export function GraphChanged({
  rev,
  summary,
  nodes,
  ops,
  cause,
  project,
  settled = false,
  undoFor = 10,
  onUndo,
  className,
  text,
  ...disclosure
}: GraphChangedProps) {
  const t = { ...graphChangedText, ...text }
  const [undone, setUndone] = useState(false)
  const [own, setLeft] = useState(undoFor)
  const [held, setHeld] = useState({ pointer: false, focus: false })
  const ref = useRef<HTMLDivElement>(null)
  const left = settled ? 0 : own

  /* the time to undo starts when the line is first on screen, not when it arrives */
  const onScreen = useOnScreen(ref, { threshold: 1, enabled: !settled })
  const [seen, setSeen] = useState(onScreen)
  if (onScreen && !seen) setSeen(true)
  const holding = held.pointer || held.focus
  useEffect(() => {
    if (!seen || undone || holding || left <= 0) return
    const id = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [seen, left, undone, holding])

  const canUndo = onUndo !== undefined && left > 0 && !undone
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Change} className={cx(s.changed, undone && s.undone, className)}>
      <div
        ref={ref}
        className={s.row}
        onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
        onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
        onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setHeld((h) => ({ ...h, focus: false }))
        }}
      >
        <Icon name="branch" size={11} />
        <span className={s.title}>{undone ? t.undone : t.changed}</span>
        <span className={s.summary}>· {summary}</span>
        <span className={s.rev}>· {t.rev(undone ? rev - 1 : rev)}</span>
        <StepMore label={t.detail} />
        <span className={s.line} aria-hidden="true" />
        {canUndo && (
          <Button
            size="small"
            className={s.undo}
            style={cssVars({ '--left': left / undoFor })}
            onClick={() => {
              setUndone(true)
              onUndo()
            }}
          >
            {t.undo}
            <span className={s.left} aria-hidden="true">
              {t.left(left)}
            </span>
          </Button>
        )}
      </div>
      <Fold>
        <div className={s.body}>
          <GraphStrip nodes={nodes} />
          <ul className={s.ops}>
            {ops.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
          <p className={s.why}>
            <Cause cause={cause} project={project} t={t} />
          </p>
        </div>
      </Fold>
    </Disclosure>
  )
}

export interface GraphProposalText {
  kicker: string
  proposes: string
  needs: string
  budget: string
  apply: string
  keep: string
  said: Record<GraphAnswer, string>
  undo: string
}

export const graphProposalText: GraphProposalText = {
  kicker: 'Graph change needs your OK',
  proposes: 'proposes',
  needs: 'Needs',
  budget: 'Budget',
  apply: 'Apply change',
  keep: 'Keep the current graph',
  said: { [GraphAnswer.Apply]: 'Graph change applied', [GraphAnswer.Keep]: 'Kept the current graph' },
  undo: 'Undo',
}

export interface GraphProposalProps {
  by: ModelInfo
  /** The change, in a sentence. */
  what: string
  nodes: readonly GraphNode[]
  /** What it needs that the run was not given. */
  needs: string
  /** What it costs. */
  budget: string
  /** The answer, when the consumer holds it: null for not yet answered. */
  answer?: GraphAnswer | null
  /** Start already answered, when the component holds the answer. */
  defaultAnswer?: GraphAnswer | null
  onAnswer?: (answer: GraphAnswer) => void
  /** Take the answer back. Without it there is no Undo. */
  onUndo?: (answer: GraphAnswer) => void
  className?: string
  text?: Partial<GraphProposalText>
}

/** A graph change that needs more than the run was given waits for you, as an ask. */
export function GraphProposal({
  by,
  what,
  nodes,
  needs,
  budget,
  answer: answerProp,
  defaultAnswer = null,
  onAnswer,
  onUndo,
  className,
  text,
}: GraphProposalProps) {
  const t = { ...graphProposalText, ...text }
  const [answer, setAnswer] = useControlled<GraphAnswer | null>(answerProp, defaultAnswer)
  const [answeredHere, setAnsweredHere] = useState(false)
  const give = (a: GraphAnswer) => {
    onAnswer?.(a)
    setAnsweredHere(true)
    setAnswer(a)
  }
  if (answer) {
    return (
      <AskAnswered
        className={className}
        denied={answer === GraphAnswer.Keep}
        said={t.said[answer]}
        undo={t.undo}
        focusOnMount={answeredHere}
        onUndo={
          onUndo &&
          (() => {
            setAnsweredHere(false)
            setAnswer(null)
            onUndo(answer)
          })
        }
      >
        <AskNote>· {what}</AskNote>
      </AskAnswered>
    )
  }
  return (
    <AskCard
      className={className}
      icon="branch"
      kicker={t.kicker}
      who={
        <>
          <Model model={by} short /> {t.proposes}
        </>
      }
      what={what}
    >
      <div className={s.proposed}>
        <GraphStrip nodes={nodes} />
      </div>
      <KeyValues
        keyWidth={64}
        items={[
          [t.needs, needs],
          [t.budget, budget],
        ]}
      />
      <AskFoot>
        <Button variant="signal" onClick={() => give(GraphAnswer.Apply)}>
          {t.apply}
        </Button>
        <Button variant="quiet" onClick={() => give(GraphAnswer.Keep)}>
          {t.keep}
        </Button>
      </AskFoot>
    </AskCard>
  )
}
