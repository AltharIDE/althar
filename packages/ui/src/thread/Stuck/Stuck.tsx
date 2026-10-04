import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { StuckAnswer, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { useRefocus } from '../../lib/refocus'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../Ask/Ask'
import { Terminal } from '../Terminal/Terminal'
import s from './Stuck.module.css'

/*
 * A task that couldn't finish, asking you what next. Althar tries on its
 * own first: runs the step again, repairs what it can, hands the step to
 * another agent. Only when none of that works does it come to you, with
 * what it tried, the lead's read of why, and the output that keeps failing.
 * It waits on you, so it is violet like every ask; only the failures inside
 * it are red. Once answered it folds to one line, with Undo.
 */

export interface StuckAttempt {
  id: string
  /** What was tried: Ran it again, Codex took the step. */
  what: string
  /** How it went: failed the same way. */
  result: string
}

export interface StuckAgent {
  model: ModelInfo
  /** Why it might do better, or what it costs: Codex · 38% of this week used. */
  note?: string
}

export interface StuckOutput {
  command?: string
  lines: string[]
  exit?: number
}

export interface StuckText {
  kicker: string
  after: (step: string, tries: number) => string
  tried: string
  read: string
  tell: string
  tellPlaceholder: string
  send: string
  cancel: string
  empty: string
  retry: string
  retryLabel: string
  again: string
  abandon: string
  told: string
  retried: (agent: string) => string
  retriedNote: string
  tryingAgain: string
  abandoned: string
  abandonedNote: string
  undo: string
}

export const stuckText: StuckText = {
  kicker: 'Stuck',
  after: (step, tries) => (tries === 0 ? step : `${step}, after ${tries} ${tries === 1 ? 'try' : 'tries'}`),
  tried: 'What it tried',
  read: 'Why, as the lead reads it',
  tell: 'Tell the lead',
  tellPlaceholder: 'What should it do instead?',
  send: 'Send to the lead',
  cancel: 'Cancel',
  empty: 'Say what it should do first',
  retry: 'Try another agent',
  retryLabel: 'Hand the step to',
  again: 'Try again',
  abandon: 'Abandon',
  told: 'Told the lead',
  retried: (agent) => `Handed to ${agent}`,
  retriedNote: 'the step starts again from the task’s record',
  tryingAgain: 'Trying again',
  abandoned: 'Abandoned',
  abandonedNote: 'the branch and what it found are kept',
  undo: 'Undo',
}

/** What you told a stuck task to do. */
export type StuckResult =
  | { kind: StuckAnswer.Told; note: string }
  | { kind: StuckAnswer.Retried; agent: ModelInfo }
  | { kind: StuckAnswer.Again }
  | { kind: StuckAnswer.Abandoned }

export interface StuckProps {
  /** The step that can't finish: Verify. */
  step: string
  /** What keeps going wrong, in a sentence. */
  what: ReactNode
  /** What Althar tried on its own, in order. */
  tried: readonly StuckAttempt[]
  /** The lead's read of why, and who the lead is. */
  read?: { by: ModelInfo; says: ReactNode }
  /** The output that keeps failing, as it last ran. */
  output?: StuckOutput
  /** Other agents that could take the step. Without them, no Try another agent. */
  agents?: readonly StuckAgent[]
  /** Tell the lead what to do instead. Without it, no Tell the lead. */
  onTell?: (note: string) => void
  /** Hand the step to another agent. Without it (or `agents`), no Try another agent. */
  onRetry?: (model: ModelInfo) => void
  /** Run the step again as it was, for one no agent does: Althar's own, such as opening the pull request. Without it, no Try again. */
  onAgain?: () => void
  /** Settle the task without finishing it. Without it, no Abandon. */
  onAbandon?: () => void
  /** Take an answer back. Without it there is no Undo, as when the lead has already acted on it. */
  onUndo?: (result: StuckResult) => void
  /** The answer, when the consumer holds it: null for not yet answered. */
  result?: StuckResult | null
  /** Start already answered, when the component holds the answer: from history. */
  defaultResult?: StuckResult | null
  /** The rank of its section headings in the page's outline. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<StuckText>
}

export function Stuck({
  step,
  what,
  tried,
  read,
  output,
  agents = [],
  onTell,
  onRetry,
  onAgain,
  onAbandon,
  onUndo,
  result: resultProp,
  defaultResult = null,
  headingLevel = 4,
  className,
  text,
}: StuckProps) {
  const t = { ...stuckText, ...text }
  const [result, setResult] = useControlled<StuckResult | null>(resultProp, defaultResult)
  const [telling, setTelling] = useState(false)
  const tellRef = useRefocus<HTMLButtonElement>(telling)
  const [answeredHere, setAnsweredHere] = useState(false)
  const give = (r: StuckResult) => {
    setAnsweredHere(true)
    setResult(r)
  }

  if (result) {
    const undo = onUndo
      ? () => {
          setAnsweredHere(false)
          setResult(null)
          onUndo(result)
        }
      : undefined
    const line = { className, onUndo: undo, undo: t.undo, focusOnMount: answeredHere }
    switch (result.kind) {
      case StuckAnswer.Told:
        return (
          <AskAnswered said={t.told} {...line}>
            <AskNote>· {result.note}</AskNote>
          </AskAnswered>
        )
      case StuckAnswer.Retried:
        return (
          <AskAnswered said={t.retried(result.agent.short)} {...line}>
            <AskNote>· {t.retriedNote}</AskNote>
          </AskAnswered>
        )
      case StuckAnswer.Again:
        return <AskAnswered said={t.tryingAgain} {...line} />
      case StuckAnswer.Abandoned:
        return (
          <AskAnswered denied said={t.abandoned} {...line}>
            <AskNote>· {t.abandonedNote}</AskNote>
          </AskAnswered>
        )
      default:
        return unreachable(result)
    }
  }

  const retrying = onRetry && agents.length > 0
  return (
    <AskCard icon="stop" kicker={t.kicker} who={t.after(step, tried.length)} what={what} className={className}>
      {/* when it came straight to you, as when the agent couldn't start, there is nothing it tried */}
      {tried.length > 0 && (
        <section className={s.section}>
          <Heading level={headingLevel} className={s.label}>
            {t.tried}
          </Heading>
          <ol className={s.tried}>
            {tried.map((a) => (
              <li key={a.id} className={s.attempt}>
                <Icon name="close" size={10} className={s.failed} />
                <span className={s.what}>{a.what}</span>
                <span className={s.result}>{a.result}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {read && (
        <section className={s.section}>
          <Heading level={headingLevel} className={s.label}>
            {t.read}
          </Heading>
          <p className={s.read}>
            <Model model={read.by} short />
            {read.says}
          </p>
        </section>
      )}
      {output && (
        <div className={s.output}>
          <Terminal command={output.command} lines={output.lines} exit={output.exit} />
        </div>
      )}
      {telling && onTell ? (
        <div className={s.tell}>
          <NoteForm
            text={{ placeholder: t.tellPlaceholder, submit: t.send, cancel: t.cancel, empty: t.empty }}
            onSubmit={(note) => {
              setTelling(false)
              onTell(note)
              give({ kind: StuckAnswer.Told, note })
            }}
            onCancel={() => setTelling(false)}
          />
        </div>
      ) : (
        (onTell || retrying || onAgain || onAbandon) && (
          <AskFoot>
            {onTell && (
              <Button ref={tellRef} variant="signal" onClick={() => setTelling(true)}>
                {t.tell}
              </Button>
            )}
            {retrying && (
              <Menu
                label={t.retryLabel}
                width={300}
                trigger={
                  // The first way on is the one to take, unless the lead can be told.
                  <Button variant={onTell ? 'default' : 'signal'} icon="agents">
                    {t.retry}
                  </Button>
                }
              >
                {agents.map((a) => (
                  <MenuItem
                    key={a.model.id}
                    description={a.note}
                    onSelect={() => {
                      onRetry(a.model)
                      give({ kind: StuckAnswer.Retried, agent: a.model })
                    }}
                  >
                    <Model model={a.model} />
                  </MenuItem>
                ))}
              </Menu>
            )}
            {onAgain && (
              <Button
                variant={onTell || retrying ? 'default' : 'signal'}
                onClick={() => {
                  onAgain()
                  give({ kind: StuckAnswer.Again })
                }}
              >
                {t.again}
              </Button>
            )}
            {onAbandon && (
              <Button
                variant="quiet"
                onClick={() => {
                  onAbandon()
                  give({ kind: StuckAnswer.Abandoned })
                }}
              >
                {t.abandon}
              </Button>
            )}
          </AskFoot>
        )
      )}
    </AskCard>
  )
}
