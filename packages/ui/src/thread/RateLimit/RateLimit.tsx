import { useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { Menu, MenuNote, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import s from './RateLimit.module.css'

export interface Alternative {
  model: ModelInfo
  /** Why it is a choice, or why not. */
  note: string
  /** Already working on something else. */
  busy?: boolean
}

export interface Paused {
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

export interface RateLimitProps {
  runtime: string
  resets: string
  options?: Alternative[]
  /** Everything the limit paused: the lead, steps, their sub-agents. */
  affects?: Paused[]
  /** Move the paused work to a model, by id. */
  onSwap?: (id: string) => void
  text?: Partial<RateLimitText>
}

/**
 * The runtime said no for now. A limit belongs to a runtime's account, not
 * to one agent, so it stops every agent on that runtime at once. One card per
 * runtime, naming what it paused, and one choice that moves all of it.
 * Usually the project's rule makes that choice and this card never shows;
 * see LimitMoved.
 */
export function RateLimit({ runtime, resets, options = [], affects = [], onSwap, text }: RateLimitProps) {
  const t = { ...rateLimitText, ...text }
  const [pick, setPick] = useState(options.find((o) => !o.busy)?.model.id)
  const picked = options.find((o) => o.model.id === pick)?.model
  const several = affects.length > 1
  return (
    <section className={s.limit} aria-label={t.title(runtime)}>
      <Icon name="clock" size={12} />
      <span className={s.main}>
        <span className={s.title}>{t.title(runtime)}</span>
        <span className={s.meta}>
          {affects.length > 0 ? (
            <>
              {t.paused(
                affects.map((a, i) => (
                  <span key={a.label}>
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
      {pick && picked && (
        <SplitButton
          onClick={() => onSwap?.(pick)}
          moreLabel={t.choose}
          menu={(trigger) => (
            <Menu label={t.menu(several)} align="end" width={320} trigger={trigger}>
              <MenuRadioGroup label={t.menu(several)} value={pick} onChange={setPick}>
                {options.map((o) => (
                  <MenuRadioItem key={o.model.id} value={o.model.id} disabled={o.busy} hint={o.note}>
                    <Model model={o.model} />
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuNote>{t.note(several)}</MenuNote>
            </Menu>
          )}
        >
          {t.continueWith} <Model model={picked} short strong />
        </SplitButton>
      )}
    </section>
  )
}
