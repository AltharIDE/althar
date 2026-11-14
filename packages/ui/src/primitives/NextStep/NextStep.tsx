import type { ReactElement, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../Button/Button'
import { SplitButton } from '../SplitButton/SplitButton'
import s from './NextStep.module.css'

/*
 * What a card offers to do, without opening it: its last row, a strip the
 * card's width, a hairline over it and between two steps. A step has no
 * button shape: its words, centred, the person's own to do (push, merge,
 * answer) in violet, last. So whatever the card shows above, what to do is
 * always in the same place, at its foot. The card places the strip edge to
 * edge.
 */

export type NextStepsProps = RootProps<'div', { children: ReactNode }>

/** A card's strip: one next step, or two side by side, the violet one last. */
export function NextSteps({ children, className, ...rest }: NextStepsProps) {
  return (
    <div className={cx(s.steps, className)} {...rest}>
      {children}
    </div>
  )
}

export type NextStepProps = RootProps<
  'span',
  {
    children: ReactNode
    /**
     * Does the step right here, without opening the task: the words become a
     * button of their own, above the card's. Without it, the words are a
     * link: they are the card's, and pressing them opens its task.
     */
    onPress?: () => void
    /** What a screen reader hears in place of the words: Push 13 commits to #189. */
    label?: string
    /** The step is under way: the button says `doing` and ignores presses, but stays focusable. */
    busy?: boolean
    disabled?: boolean
    /** The words while it is under way: Pushing 13 commits. */
    doing?: ReactNode
    /** Violet, for the person's own to do (push, merge, answer); in ink otherwise. */
    signal?: boolean
    /** It goes somewhere, as a task's Open does: an arrow after its words, as a link's have. */
    arrow?: boolean
    menu?: (trigger: ReactElement) => ReactNode
    moreLabel?: string
  }
>

/**
 * One next step, in a card's strip: Push 3 commits, Accept and merge. Where
 * it can be done from the card it is a button (`onPress`), which does it and
 * leaves the card where it is; where it needs the lead (Ask the lead to fix
 * it), it is words with an arrow, a link into the task, which the card itself
 * opens.
 */
export function NextStep({
  children,
  className,
  onPress,
  label,
  busy = false,
  disabled = false,
  doing,
  signal = false,
  arrow = false,
  menu,
  moreLabel,
  ...rest
}: NextStepProps) {
  if (onPress === undefined)
    return (
      <span className={cx(s.step, s.words, signal && s.signal, className)} {...rest}>
        {children}
        <Icon name="arrow" size={11} />
      </span>
    )
  const main = {
    busy,
    disabled,
    ...(label === undefined ? {} : { 'aria-label': label }),
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      onPress()
    },
    children: busy && doing !== undefined ? doing : children,
  }
  return (
    <span className={cx(s.step, s.act, className)} {...rest}>
      {menu !== undefined && moreLabel !== undefined ? (
        <SplitButton
          {...main}
          size="small"
          variant="quiet"
          className={s.split}
          mainClassName={cx(s.press, signal && s.signal)}
          moreClassName={cx(s.press, s.more, signal && s.signal)}
          menu={menu}
          moreLabel={moreLabel}
        />
      ) : (
        <Button
          {...main}
          size="small"
          variant="quiet"
          {...(arrow ? { trailingIcon: 'arrow' as const } : {})}
          className={cx(s.press, signal && s.signal)}
        >
          {main.children}
        </Button>
      )}
    </span>
  )
}
