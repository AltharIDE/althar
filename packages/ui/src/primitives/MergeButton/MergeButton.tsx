import type { ReactElement, ReactNode } from 'react'

import { Button, type ButtonProps } from '../Button/Button'
import { Menu, MenuItem } from '../Menu/Menu'
import { NextStep } from '../NextStep/NextStep'
import { SplitButton } from '../SplitButton/SplitButton'

export interface MergeButtonText {
  merge: string
  more: string
  options: string
  withoutQueue: string
  bypassNote: string
}

export const mergeButtonText: MergeButtonText = {
  merge: 'Merge',
  more: 'Other ways to merge',
  options: 'Merge options',
  withoutQueue: 'Merge without queue',
  bypassNote: 'Merge directly using your permission to bypass branch protections.',
}

export interface MergeButtonProps extends Omit<ButtonProps, 'onClick' | 'variant' | 'children'> {
  children?: ReactNode
  onMerge?: () => void
  /** Given only where the host explicitly allows this viewer to bypass its queue. */
  onBypassQueue?: () => void
  queued?: boolean
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
