import { useState, type ReactNode } from 'react'

import { LimitAnswer, unreachable } from '../../foundations/vocabulary'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { useControlled } from '../../lib/controlled'
import type { RootProps } from '../../lib/props'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import s from './RateLimit.module.css'

/** A model the paused work could move to. */
export interface RateLimitOption {
  /** Which choice it is, where two share a model, as two accounts of one agent do. The model's id without one. */
  id?: string
  model: ModelInfo
  /** How it is reached, or why it can't take the work: via Codex · work. */
  note: string
  /** Can't take the work now: out of usage itself. */
  busy?: boolean
}

/** Work the limit paused: the lead, a step, a sub-agent. */
export interface PausedWork {
  id: string
  label: string
  model: ModelInfo
}

/** What you told the paused work to do. */
export type RateLimitResult = { kind: LimitAnswer.Moved; model: ModelInfo } | { kind: LimitAnswer.Waiting } | { kind: LimitAnswer.Again }

export interface RateLimitText {
  kicker: string
  /** Whose limit, and until when; null where it didn't say. */
  what: (runtime: string, resets: string | null) => string
  /** What it paused, around the list of paused work. */
  paused: (items: ReactNode) => ReactNode
  /** Between items of that list: before item i of n. */
  separator: (i: number, n: number) => string
  /** Every model it could move to is out too. */
  noneFree: string
  continueWith: string
  choose: string
  /** The menu's heading, for one piece of work paused or several. */
  menu: (several: boolean) => string
  note: (several: boolean) => string
  wait: (resets: string) => string
  again: (runtime: string) => string
  moved: (model: string) => string
  movedNote: string
  waiting: (resets: string) => string
  waitingNote: string
  tryingAgain: (runtime: string) => string
}

export const rateLimitText: RateLimitText = {
  kicker: 'Out of usage',
  what: (runtime, resets) =>
    resets === null
      ? `${runtime} reached its usage limit and didn’t say when it resets.`
      : `${runtime} reached its usage limit, until ${resets}.`,
  paused: (items) => <>Paused {items}.</>,
  separator: (i, n) => (i === n - 1 ? ' and ' : ', '),
  noneFree: 'No other model is free now.',
  continueWith: 'Continue with',
  choose: 'Choose another model',
  menu: (several) => (several ? 'Move the paused work to' : 'Continue the step with'),
  note: (several) =>
    several
      ? 'Moves the lead and every paused step. Each picks up from the task’s record.'
      : 'Whichever you pick picks up from the task’s record.',
  wait: (resets) => `Wait until ${resets}`,
  again: (runtime) => `Try ${runtime} again`,
  moved: (model) => `Moved to ${model}`,
  movedNote: 'the step picks up from the task’s record',
  waiting: (resets) => `Waiting until ${resets}`,
  waitingNote: 'the step runs again then',
  tryingAgain: (runtime) => `Trying ${runtime} again`,
}

export type RateLimitProps = RootProps<
  'div',
  {
    /** Whose limit: the agent, with the account where it has several. */
    runtime: string
    /** When it resets, in words; null where it didn't say. */
    resets: string | null
    /** The step it paused, at the right of the head. */
    step?: string
    options?: readonly RateLimitOption[]
    /** Everything the limit paused, where it is more than the step: the lead, steps, their sub-agents. */
    affects?: readonly PausedWork[]
    /** Move the paused work to a model, by its option's id. Without it there is no model to choose. */
    onSwap?: (id: string) => void
    /** Keep the work's place until the reset. Offered only where the reset is known. */
    onWait?: () => void
    /** Try the same agent again: for one that didn't say when it resets. */
    onAgain?: () => void
    /** The option the button offers, by id, when the consumer holds it. */
    pick?: string
    /** The option offered first. By default, the first that is not busy. */
    defaultPick?: string
    onPickChange?: (id: string) => void
    /** The answer, when the consumer holds it: null for not yet answered. */
    result?: RateLimitResult | null
    /** Start already answered, when the component holds the answer: from history. */
    defaultResult?: RateLimitResult | null
    text?: Partial<RateLimitText>
  }
>

const idOf = (option: RateLimitOption) => option.id ?? option.model.id

/**
 * An agent's account reached its usage limit, and the project says to ask
 * (ADR-013). The work it paused waits on you, so it is violet like every ask:
 * whose limit and until when, the models free now to move the work to, each
 * with how it is reached, and waiting for the reset; or, where the agent
 * didn't say when that is, trying it again. Under the project's other rules
 * the work moves or waits on its own and the thread says so in a line; see
 * LimitMoved. Once answered it folds to one line.
 */
export function RateLimit({
  runtime,
  resets,
  step,
  options = [],
  affects = [],
  onSwap,
  onWait,
  onAgain,
  pick: pickProp,
  defaultPick,
  onPickChange,
  result: resultProp,
  defaultResult = null,
  text,
  className,
  ...rest
}: RateLimitProps) {
  const t = { ...rateLimitText, ...text }
  const free = options.filter((o) => !o.busy)
  const [pick, setPick] = useControlled(pickProp, defaultPick ?? (free[0] === undefined ? '' : idOf(free[0])), onPickChange)
  const [result, setResult] = useControlled<RateLimitResult | null>(resultProp, defaultResult)
  const [answeredHere, setAnsweredHere] = useState(false)
  const give = (r: RateLimitResult) => {
    setAnsweredHere(true)
    setResult(r)
  }
  // One held here that has gone out since gives way to the first that is free; one the consumer holds stays theirs.
  const picked = free.find((o) => idOf(o) === pick) ?? (pickProp === undefined ? free[0] : undefined)
  const several = affects.length > 1

  if (result) {
    const line = { className, focusOnMount: answeredHere }
    switch (result.kind) {
      case LimitAnswer.Moved:
        return (
          <AskAnswered said={t.moved(result.model.short)} {...line}>
            <AskNote>· {t.movedNote}</AskNote>
          </AskAnswered>
        )
      case LimitAnswer.Waiting:
        return (
          <AskAnswered said={t.waiting(resets ?? '')} {...line}>
            <AskNote>· {t.waitingNote}</AskNote>
          </AskAnswered>
        )
      case LimitAnswer.Again:
        return <AskAnswered said={t.tryingAgain(runtime)} {...line} />
      default:
        return unreachable(result)
    }
  }

  const moving = onSwap && picked
  const waiting = onWait && resets !== null
  return (
    <AskCard icon="clock" kicker={t.kicker} who={step} what={t.what(runtime, resets)} className={className} {...rest}>
      {affects.length > 0 && (
        <p className={s.meta}>
          {t.paused(
            affects.map((a, i) => (
              <span key={a.id}>
                {i > 0 && t.separator(i, affects.length)}
                {a.label} (<Model model={a.model} short />)
              </span>
            )),
          )}
        </p>
      )}
      {onSwap && !picked && <p className={s.meta}>{t.noneFree}</p>}
      {(moving || waiting || onAgain) && (
        <AskFoot>
          {moving && (
            <SplitButton
              variant="signal"
              onClick={() => {
                onSwap(idOf(picked))
                give({ kind: LimitAnswer.Moved, model: picked.model })
              }}
              moreLabel={t.choose}
              menu={(trigger) => (
                <Menu label={t.menu(several)} align="start" width={320} trigger={trigger} note={t.note(several)}>
                  <MenuRadioGroup label={t.menu(several)} value={idOf(picked)} onChange={setPick}>
                    {options.map((o) => (
                      <MenuRadioItem key={idOf(o)} value={idOf(o)} disabled={o.busy} description={o.note}>
                        <Model model={o.model} />
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </Menu>
              )}
            >
              {t.continueWith} <Model model={picked.model} short className={s.picked} />
            </SplitButton>
          )}
          {waiting && (
            <Button
              variant={moving ? 'default' : 'signal'}
              onClick={() => {
                onWait()
                give({ kind: LimitAnswer.Waiting })
              }}
            >
              {t.wait(resets)}
            </Button>
          )}
          {onAgain && (
            <Button
              variant={moving || waiting ? 'default' : 'signal'}
              onClick={() => {
                onAgain()
                give({ kind: LimitAnswer.Again })
              }}
            >
              {t.again(runtime)}
            </Button>
          )}
        </AskFoot>
      )}
    </AskCard>
  )
}
