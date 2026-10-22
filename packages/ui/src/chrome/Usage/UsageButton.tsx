import { ChromeButton, type ChromeButtonProps } from '../ChromeButton/ChromeButton'

/*
 * The way to the usage view, always in the window's bar. With warnings not
 * yet seen it carries a small count, and its name says how many, so a
 * screen reader hears it too. While the view is open it stays lit.
 */

export interface UsageButtonText {
  label: string
  /** Its name with the warnings waiting. */
  waiting: (n: number) => string
}

export const usageButtonText: UsageButtonText = {
  label: 'Usage',
  waiting: (n) => (n === 1 ? 'Usage, 1 warning not seen' : `Usage, ${n} warnings not seen`),
}

export interface UsageButtonProps extends Omit<ChromeButtonProps, 'icon' | 'label' | 'count'> {
  /** Warnings the person has not seen. */
  waiting?: number
  text?: Partial<UsageButtonText>
}

export function UsageButton({ waiting = 0, text, ...rest }: UsageButtonProps) {
  const t = { ...usageButtonText, ...text }
  return (
    <ChromeButton
      icon="load"
      label={t.label}
      count={waiting}
      aria-haspopup="dialog"
      aria-label={waiting > 0 ? t.waiting(waiting) : t.label}
      {...rest}
    />
  )
}
