import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { StuckAnswer } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../Ask/Ask'
import { Terminal } from '../Terminal/Terminal'
import s from './Stuck.module.css'

/*
 * A task that couldn't finish, asking you what next. Charrette tries on its
 * own first: runs the step again, repairs what it can, hands the step to
 * another agent. Only when none of that works does it come to you, with
 * what it tried, the lead's read of why, and the output that keeps failing.
 * It waits on you, so it is violet like every ask; only the failures inside
 * it are red. Once answered it folds to one line, with Undo.
 */

export interface StuckAttempt {
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
  retry: string
  retryLabel: string
  abandon: string
  told: string
  retried: (agent: string) => string
  retriedNote: string
  abandoned: string
  abandonedNote: string
  undo: string
}

export const stuckText: StuckText = {
  kicker: 'Stuck',
  after: (step, tries) => `${step}, after ${tries} ${tries === 1 ? 'try' : 'tries'}`,
  tried: 'What it tried',
  read: 'Why, as the lead reads it',
  tell: 'Tell the lead',
  tellPlaceholder: 'What should it do instead?',
  send: 'Send to the lead',
  cancel: 'Cancel',
  retry: 'Try another agent',
  retryLabel: 'Hand the step to',
  abandon: 'Abandon',
  told: 'Told the lead',
  retried: (agent) => `Handed to ${agent}`,
  retriedNote: 'the step starts again from the task’s record',
  abandoned: 'Abandoned',
  abandonedNote: 'the branch and what it found are kept',
  undo: 'Undo',
}

type Answer = { kind: StuckAnswer.Told; note: string } | { kind: StuckAnswer.Retried; agent: ModelInfo } | { kind: StuckAnswer.Abandoned }

export interface StuckProps {
  /** The step that can't finish: Verify. */
  step: string
  /** What keeps going wrong, in a sentence. */
  what: ReactNode
  /** What Charrette tried on its own, in order. */
  tried: readonly StuckAttempt[]
  /** The lead's read of why, and who the lead is. */
  read?: { by: ModelInfo; says: ReactNode }
  /** The output that keeps failing, as it last ran. */
  output?: StuckOutput
  /** Other agents that could take the step. Without them, no Try another agent. */
  agents?: readonly StuckAgent[]
  onTell?: (note: string) => void
  onRetry?: (model: ModelInfo) => void
  onAbandon?: () => void
  text?: Partial<StuckText>
}

export function Stuck({ step, what, tried, read, output, agents = [], onTell, onRetry, onAbandon, text }: StuckProps) {
  const t = { ...stuckText, ...text }
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [telling, setTelling] = useState(false)

  if (answer) {
    const undo = () => setAnswer(null)
    switch (answer.kind) {
      case StuckAnswer.Told:
        return (
          <AskAnswered said={t.told} onUndo={undo} undo={t.undo}>
            <AskNote>· {answer.note}</AskNote>
          </AskAnswered>
        )
      case StuckAnswer.Retried:
        return (
          <AskAnswered said={t.retried(answer.agent.short)} onUndo={undo} undo={t.undo}>
            <AskNote>· {t.retriedNote}</AskNote>
          </AskAnswered>
        )
      case StuckAnswer.Abandoned:
        return (
          <AskAnswered denied said={t.abandoned} onUndo={undo} undo={t.undo}>
            <AskNote>· {t.abandonedNote}</AskNote>
          </AskAnswered>
        )
    }
  }

  return (
    <AskCard icon="stop" kicker={t.kicker} who={t.after(step, tried.length)} what={what}>
      <section className={s.section}>
        <h4 className={s.label}>{t.tried}</h4>
        <ol className={s.tried}>
          {tried.map((a) => (
            <li key={a.what} className={s.attempt}>
              <Icon name="close" size={10} className={s.failed} />
              <span className={s.what}>{a.what}</span>
              <span className={s.result}>{a.result}</span>
            </li>
          ))}
        </ol>
      </section>
      {read && (
        <section className={s.section}>
          <h4 className={s.label}>{t.read}</h4>
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
      {telling ? (
        <div className={s.tell}>
          <NoteForm
            placeholder={t.tellPlaceholder}
            submit={t.send}
            cancel={t.cancel}
            onSubmit={(note) => {
              setTelling(false)
              setAnswer({ kind: StuckAnswer.Told, note })
              onTell?.(note)
            }}
            onCancel={() => setTelling(false)}
          />
        </div>
      ) : (
        <AskFoot>
          <Button variant="signal" onClick={() => setTelling(true)}>
            {t.tell}
          </Button>
          {agents.length > 0 && (
            <Menu
              label={t.retryLabel}
              width={300}
              trigger={
                <Button variant="default" icon="agents">
                  {t.retry}
                </Button>
              }
            >
              {agents.map((a) => (
                <MenuItem
                  key={a.model.id}
                  description={a.note}
                  onSelect={() => {
                    setAnswer({ kind: StuckAnswer.Retried, agent: a.model })
                    onRetry?.(a.model)
                  }}
                >
                  <Model model={a.model} />
                </MenuItem>
              ))}
            </Menu>
          )}
          <Button
            variant="quiet"
            onClick={() => {
              setAnswer({ kind: StuckAnswer.Abandoned })
              onAbandon?.()
            }}
          >
            {t.abandon}
          </Button>
        </AskFoot>
      )}
    </AskCard>
  )
}
