import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { StuckAnswer, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { useRefocus } from '../../lib/refocus'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
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

/** Who could take the step: a menu of models, where picking one hands it the step. */
export interface StuckHandOn {
  /** The models offered at once, the best bet first, then the pinned ones; the one that failed isn't among them. */
  models: readonly ModelInfo[]
  /** Hand the step to a model. */
  onHandOn: (model: ModelInfo) => void
  /** Open every model, in a browser the consumer shows, which hands the step to the one picked there with `handTo`. Without it, no All models. */
  onBrowse?: (handTo: (model: ModelInfo) => void) => void
  /** How many models there are in all, beside All models. */
  count?: number
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
  /** The menu of models' name. */
  retryLabel: string
  /** The menu's last row, which opens every model. */
  all: string
  again: string
  abandon: string
  told: string
  retried: (agent: string) => string
  /** Beside what was answered, where there is something to add; none by default. */
  retriedNote?: string
  tryingAgain: string
  abandoned: string
  abandonedNote?: string
  undo: string
  report: string
}

export const stuckText: StuckText = {
  kicker: 'Stuck',
  after: (step, tries) => (tries === 0 ? step : `${step}, after ${tries} ${tries === 1 ? 'try' : 'tries'}`),
  tried: 'What it tried',
  read: 'Why',
  tell: 'Tell the lead',
  tellPlaceholder: 'What should it do instead?',
  send: 'Send to the lead',
  cancel: 'Cancel',
  empty: 'Say what it should do first',
  retry: 'Continue with another model',
  retryLabel: 'Continue with',
  all: 'All models',
  again: 'Try again',
  abandon: 'Abandon this step',
  told: 'Told the lead',
  retried: (agent) => `Continuing with ${agent}`,
  tryingAgain: 'Trying again',
  abandoned: 'Abandoned',
  undo: 'Undo',
  report: 'Report this',
}

/** The ways on a card answers with: tell the lead, hand the step on, try it again, or abandon it. */
export type StuckWay = 'tell' | 'retry' | 'again' | 'abandon'

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
  /** What the agent itself said, under it, where it said something short. */
  said?: string
  /** What Althar tried on its own, in order. */
  tried: readonly StuckAttempt[]
  /** How many tries, where one line of `tried` stands for several (Tried again 3 times); else one for each line. */
  tries?: number
  /** The lead's read of why, and who the lead is. */
  read?: { by: ModelInfo; says: ReactNode }
  /** The output that keeps failing, as it last ran. */
  output?: StuckOutput
  /** Hand the step to another model, picked in a menu. Without it, no Continue with another model. */
  handOn?: StuckHandOn
  /** Tell the lead what to do instead. Without it, no Tell the lead. */
  onTell?: (note: string) => void
  /** Run the step again as it was, on the agent it was on, or Althar's own, such as opening the pull request. Without it, no Try again. */
  onAgain?: () => void
  /**
   * The way to take, first, as the card's own button, and the others after
   * it: Try again where the connection or the session failed rather than the
   * work, Abandon where going on without the step is the likely answer.
   * Without it, the first of telling the lead, handing the step on and
   * trying again that the card offers.
   */
  primary?: StuckWay
  /**
   * What puts it right elsewhere, such as signing the agent in again in
   * Settings, or connecting the repository's host: the card's own button,
   * first. It doesn't answer the card; Try again does, once it is put right.
   */
  fix?: { label: string; onFix: () => void }
  /** Settle the task without finishing it. Without it, no Abandon. */
  onAbandon?: () => void
  /** Report it as a problem with Althar, at the end of its answers. Without it, no Report this. */
  onReport?: () => void
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
  said,
  tried,
  tries = tried.length,
  read,
  output,
  handOn,
  onTell,
  onAgain,
  primary,
  fix,
  onAbandon,
  onReport,
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
            {t.retriedNote !== undefined && <AskNote>· {t.retriedNote}</AskNote>}
          </AskAnswered>
        )
      case StuckAnswer.Again:
        return <AskAnswered said={t.tryingAgain} {...line} />
      case StuckAnswer.Abandoned:
        return (
          <AskAnswered denied said={t.abandoned} {...line}>
            {t.abandonedNote !== undefined && <AskNote>· {t.abandonedNote}</AskNote>}
          </AskAnswered>
        )
      default:
        return unreachable(result)
    }
  }

  const retrying = handOn !== undefined
  const handTo = (model: ModelInfo) => {
    handOn?.onHandOn(model)
    give({ kind: StuckAnswer.Retried, agent: model })
  }
  const offered: Record<StuckWay, boolean> = {
    tell: onTell !== undefined,
    retry: retrying,
    again: onAgain !== undefined,
    abandon: onAbandon !== undefined,
  }
  // The way to take, where the card offers it; else the first of telling, handing on and trying again it offers.
  const chosen = primary !== undefined && offered[primary] ? primary : (['tell', 'retry', 'again'] as const).find((way) => offered[way])
  // What puts it right comes before everything, as the card's own button; the way to take follows it, in ink.
  const variant = (way: StuckWay) => (way !== chosen ? (way === 'abandon' ? 'quiet' : 'default') : fix ? 'default' : 'signal')
  const ways: Record<StuckWay, ReactNode> = {
    tell: onTell && (
      <Button key="tell" ref={tellRef} variant={variant('tell')} onClick={() => setTelling(true)}>
        {t.tell}
      </Button>
    ),
    retry: handOn && (
      <Menu
        key="retry"
        label={t.retryLabel}
        width={300}
        trigger={
          <Button variant={variant('retry')} icon="agents">
            {t.retry}
          </Button>
        }
      >
        {handOn.models.map((model) => (
          <MenuItem key={model.id} onSelect={() => handTo(model)}>
            <Model model={model} />
          </MenuItem>
        ))}
        {handOn.onBrowse && (
          <>
            {handOn.models.length > 0 && <MenuSeparator />}
            <MenuItem hint={handOn.count} onSelect={() => handOn.onBrowse?.(handTo)}>
              {t.all}
            </MenuItem>
          </>
        )}
      </Menu>
    ),
    again: onAgain && (
      <Button
        key="again"
        variant={variant('again')}
        onClick={() => {
          onAgain()
          give({ kind: StuckAnswer.Again })
        }}
      >
        {t.again}
      </Button>
    ),
    abandon: onAbandon && (
      <Button
        key="abandon"
        variant={variant('abandon')}
        onClick={() => {
          onAbandon()
          give({ kind: StuckAnswer.Abandoned })
        }}
      >
        {t.abandon}
      </Button>
    ),
  }
  const order: ReadonlyArray<StuckWay> = ['tell', 'retry', 'again', 'abandon']
  return (
    <AskCard icon="stop" kicker={t.kicker} who={t.after(step, tries)} what={what} className={className}>
      {said !== undefined && <p className={s.said}>{said}</p>}
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
        (fix || onTell || retrying || onAgain || onAbandon || onReport) && (
          <AskFoot className={s.foot}>
            {fix && (
              <Button variant="signal" onClick={fix.onFix}>
                {fix.label}
              </Button>
            )}
            {chosen !== undefined && ways[chosen]}
            {order.filter((way) => way !== chosen).map((way) => ways[way])}
            {onReport && (
              <LinkButton className={s.report} onClick={onReport}>
                {t.report}
              </LinkButton>
            )}
          </AskFoot>
        )
      )}
    </AskCard>
  )
}
