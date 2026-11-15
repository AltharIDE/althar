import type { ReactElement, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button, type ButtonProps } from '../Button/Button'
import { Menu, MenuItem } from '../Menu/Menu'
import { NextStep } from '../NextStep/NextStep'
import { Spinner } from '../Spinner/Spinner'
import { SplitButton } from '../SplitButton/SplitButton'
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
  const menu = (trigger: ReactElement) => (
    <Menu trigger={trigger} label={t.more} align="end" width={280}>
      <MenuItem description={t.bypassNote} onSelect={() => onBypassQueue?.()} disabled={button.busy || button.disabled}>
        {t.withoutQueue}
      </MenuItem>
    </Menu>
  )
  if (standing !== null && !strip) {
    const said = (
      <span
        role="status"
        className={cx(s.standing, button.size === 'small' && s.small, button.className)}
        style={button.style}
        data-standing={standing}
      >
        {standing === 'merging' ? (
          <Spinner size="small" />
        ) : standing === 'merged' ? (
          <Icon name="check" size={11} />
        ) : (
          <span className={s.dot} aria-hidden="true" />
        )}
        <span>{standing === 'merging' ? t.merging : standing === 'queued' ? t.queued : t.merged}</span>
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
        onPress={onMerge}
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
    <Button {...button} variant={variant} onClick={onMerge}>
      {children}
    </Button>
  ) : (
    <SplitButton {...button} variant={variant} onClick={onMerge} menu={menu} moreLabel={t.more}>
      {children}
    </SplitButton>
  )
}
