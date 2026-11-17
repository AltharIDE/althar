import { type MouseEvent, type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button, type ButtonProps } from '../Button/Button'
import { Menu, MenuItem } from '../Menu/Menu'
import { ANSWERS_WITHIN, answerPress, notePress } from '../MergeFeel/feel'
import { NextStep } from '../NextStep/NextStep'
import { SplitButton } from '../SplitButton/SplitButton'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './MergeButton.module.css'

export interface MergeButtonText {
  merge: string
  more: string
  options: string
  withoutQueue: string
  bypassNote: string
  merging: string
  queued: string
  merged: string
}

export const mergeButtonText: MergeButtonText = {
  merge: 'Merge',
  more: 'Other ways to merge',
  options: 'Merge options',
  withoutQueue: 'Merge without queue',
  bypassNote: 'Merge directly using your permission to bypass branch protections.',
  merging: 'Merging',
  queued: 'In the queue',
  merged: 'Merged',
}

/** Where a merge stands once pressed: shown in the button's place, so it can't be pressed again. */
export type MergeStanding = 'merging' | 'queued' | 'merged'

export interface MergeButtonProps extends Omit<ButtonProps, 'onClick' | 'variant' | 'children'> {
  children?: ReactNode
  onMerge?: () => void
  /** Given only where the host explicitly allows this viewer to bypass its queue. */
  onBypassQueue?: () => void
  queued?: boolean
  /**
   * Where the merge stands once pressed, in the button's place at once: Merging from the press, then In the queue or Merged
   * as the host says. While it stands anywhere, nothing merges it again; in the queue, the queue can still be bypassed.
   */
  standing?: MergeStanding | null
  /** A board card's action strip, with the same menu and keyboard behavior. */
  strip?: boolean
  variant?: 'default' | 'signal' | 'quiet'
  text?: Partial<MergeButtonText>
}

/** Merge normally by default; bypassing the queue is a separate, explicitly named action. */
export function MergeButton({
  onMerge,
  onBypassQueue,
  queued = false,
  standing = null,
  strip = false,
  variant = 'signal',
  text,
  ...button
}: MergeButtonProps) {
  const t = { ...mergeButtonText, ...text }
  const children = button.children ?? t.merge
  // Pressed here: how wide it was, so Merging keeps its room, and when, so the press is answered once, here.
  const [pressed, setPressed] = useState<{ readonly width: number; readonly at: number } | null>(null)
  const answer = useRef<HTMLSpanElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const check = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    if (standing !== 'merging' || pressed === null || answer.current === null) return
    if (performance.now() - pressed.at < ANSWERS_WITHIN) answerPress(answer.current, ring.current, check.current)
  }, [standing, pressed])
  // Each press noted, so a card that moves as it is pressed answers it where it goes (MergeFeel).
  const press = (width: number, then: (() => void) | undefined) => {
    const at = performance.now()
    notePress(at)
    setPressed({ width, at })
    then?.()
  }
  const merge =
    onMerge === undefined
      ? undefined
      : (event: MouseEvent<HTMLButtonElement>) => {
          const el = event.currentTarget
          const whole = el.parentElement?.getAttribute('role') === 'group' ? el.parentElement : el
          press(whole.offsetWidth, onMerge)
        }
  const menu = (trigger: ReactElement) => (
    <Menu trigger={trigger} label={t.more} align="end" width={280}>
      <MenuItem description={t.bypassNote} onSelect={() => press(0, onBypassQueue)} disabled={button.busy || button.disabled}>
        {t.withoutQueue}
      </MenuItem>
    </Menu>
  )
  // Pressed: Merge, still where it was and as wide, gives, a ring spreads from it, and a check draws in; Merging, to whoever reads.
  if (standing === 'merging' && !strip)
    return (
      <span
        ref={answer}
        role="status"
        data-merge=""
        data-standing={standing}
        className={cx(
          s.pressed,
          variant === 'signal' ? s.onSignal : s.onPaper,
          button.size === 'small' && s.pressedSmall,
          button.className,
        )}
        style={pressed === null ? button.style : { ...button.style, minWidth: pressed.width }}
      >
        <span className={s.room} aria-hidden="true">
          {children}
        </span>
        <svg ref={check} className={s.check} viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M5 13L9 17L19 7" />
        </svg>
        <VisuallyHidden>{t.merging}</VisuallyHidden>
        <span ref={ring} className={s.ring} aria-hidden="true" />
      </span>
    )
  if (standing !== null && !strip) {
    const said = (
      <span
        role="status"
        className={cx(s.standing, button.size === 'small' && s.small, button.className)}
        style={button.style}
        data-standing={standing}
      >
        {standing === 'merged' ? <Icon name="check" size={11} /> : <span className={s.dot} aria-hidden="true" />}
        <span>{standing === 'queued' ? t.queued : t.merged}</span>
      </span>
    )
    if (standing !== 'queued' || onBypassQueue === undefined) return said
    return (
      <span className={s.pair}>
        {said}
        {menu(
          <Button size={button.size} variant="quiet" aria-label={t.more} trailingIcon="chevronD" disabled={button.disabled}>
            {t.options}
          </Button>,
        )}
      </span>
    )
  }
  if (standing !== null && strip)
    return (
      <NextStep busy doing={standing === 'merging' ? t.merging : standing === 'queued' ? t.queued : t.merged} onPress={() => {}}>
        {children}
      </NextStep>
    )
  if (queued)
    return onBypassQueue === undefined
      ? null
      : menu(
          <Button {...button} variant="quiet" aria-label={t.more} trailingIcon="chevronD">
            {t.options}
          </Button>,
        )
  if (onMerge === undefined) return null
  if (strip)
    return (
      <NextStep
        onPress={() => press(0, onMerge)}
        signal={variant === 'signal'}
        busy={button.busy}
        disabled={button.disabled}
        label={button['aria-label']}
        {...(onBypassQueue === undefined ? {} : { menu, moreLabel: t.more })}
      >
        {children}
      </NextStep>
    )
  return onBypassQueue === undefined ? (
    <Button {...button} variant={variant} onClick={merge} data-merge="">
      {children}
    </Button>
  ) : (
    <SplitButton {...button} variant={variant} onClick={merge} menu={menu} moreLabel={t.more} data-merge="">
      {children}
    </SplitButton>
  )
}
