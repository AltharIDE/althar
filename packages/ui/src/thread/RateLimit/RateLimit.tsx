import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import s from './RateLimit.module.css'

/** An agent the paused work could move to. */
export interface RateLimitOption {
  model: ModelInfo
  /** Why it is a choice, or why not. */
  note: string
  /** Already working on something else. */
  busy?: boolean
}

/** Work the limit paused: the lead, a step, a sub-agent. */
export interface PausedWork {
  id: string
  label: string
  model: ModelInfo
}

export interface RateLimitText {
  title: (runtime: string) => string
  /** What it paused, around the list of paused work. */
  paused: (items: ReactNode) => ReactNode
  /** Between items of that list: before item i of n. */
  separator: (i: number, n: number) => string
  resumes: (resets: string) => string
  keepsPlace: string
  continueWith: string
  choose: string
  /** The menu's heading, for one agent paused or several. */
  menu: (several: boolean) => string
  note: (several: boolean) => string
}

export const rateLimitText: RateLimitText = {
  title: (runtime) => `${runtime} usage limit reached`,
  paused: (items) => <>Paused {items}.</>,
  separator: (i, n) => (i === n - 1 ? ' and ' : ', '),
  resumes: (resets) => `Resumes on its own at ${resets}.`,
  keepsPlace: 'The task keeps its place.',
  continueWith: 'Continue with',
  choose: 'Choose another agent',
  menu: (several) => (several ? 'Move the paused work to' : 'Continue the task with'),
  note: (several) =>
    several
      ? 'Moves the lead and every paused step. Each picks up from the task record.'
      : 'Whichever you pick reads the task record, not this thread.',
}

export type RateLimitProps = RootProps<
  'section',
  {
    runtime: string
    resets: string
    options?: readonly RateLimitOption[]
    /** Everything the limit paused: the lead, steps, their sub-agents. */
    affects?: readonly PausedWork[]
    /** Move the paused work to a model, by id. Without it there is no choice to make: the card only says when work resumes. */
    onSwap?: (id: string) => void
    /** The model the button offers, by id, when the consumer holds it. */
    pick?: string
    /** The model offered first. By default, the first that is not busy. */
    defaultPick?: string
    onPickChange?: (id: string) => void
    text?: Partial<RateLimitText>
  }
>

/**
 * The runtime said no for now. A limit belongs to a runtime's account, not
 * to one agent, so it stops every agent on that runtime at once. One card per
 * runtime, naming what it paused, and one choice that moves all of it.
 * Usually the project's rule makes that choice and this card never shows;
 * see LimitMoved.
 */
export function RateLimit({
  runtime,
  resets,
  options = [],
  affects = [],
  onSwap,
  pick: pickProp,
  defaultPick,
  onPickChange,
  text,
  className,
  ...rest
}: RateLimitProps) {
  const t = { ...rateLimitText, ...text }
  const [pick, setPick] = useControlled(pickProp, defaultPick ?? options.find((o) => !o.busy)?.model.id ?? '', onPickChange)
  const picked = options.find((o) => o.model.id === pick && !o.busy)?.model
  const several = affects.length > 1
  return (
    <section className={cx(s.limit, className)} aria-label={t.title(runtime)} {...rest}>
      <Icon name="clock" size={12} />
      <span className={s.main}>
        <span className={s.title}>{t.title(runtime)}</span>
        <span className={s.meta}>
          {affects.length > 0 ? (
            <>
              {t.paused(
                affects.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && t.separator(i, affects.length)}
                    {a.label} (<Model model={a.model} short />)
                  </span>
                )),
              )}{' '}
              {t.resumes(resets)}
            </>
          ) : (
            <>
              {t.resumes(resets)} {t.keepsPlace}
            </>
          )}
        </span>
      </span>
      {onSwap && picked && (
        <SplitButton
          onClick={() => onSwap(picked.id)}
          moreLabel={t.choose}
          menu={(trigger) => (
            <Menu label={t.menu(several)} align="end" width={320} trigger={trigger} note={t.note(several)}>
              <MenuRadioGroup label={t.menu(several)} value={pick} onChange={setPick}>
                {options.map((o) => (
                  <MenuRadioItem key={o.model.id} value={o.model.id} disabled={o.busy} hint={o.note}>
                    <Model model={o.model} />
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </Menu>
          )}
        >
          {t.continueWith} <Model model={picked} short strong />
        </SplitButton>
      )}
    </section>
  )
}
