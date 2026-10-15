import type { ReactElement, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button, type ButtonProps } from '../Button/Button'
import s from './SplitButton.module.css'

/*
 * One action with its alternatives beside it: the button does the likely
 * thing, and the chevron opens a menu of the others. The consumer builds the
 * menu; SplitButton hands it the chevron to use as its trigger. The two sit
 * in a group, named by the main action.
 */

export interface SplitButtonProps extends Omit<ButtonProps, 'variant'> {
  /** Signal for the one way on an ask offers first; both halves take it. */
  variant?: 'default' | 'signal'
  /** The chevron's accessible name: what choosing does, such as "Choose another model". */
  moreLabel: string
  /** Renders the menu of alternatives around the given trigger, usually a Menu. */
  menu: (trigger: ReactElement) => ReactNode
}

export function SplitButton({ moreLabel, menu, variant = 'default', size = 'medium', className, ...main }: SplitButtonProps) {
  return (
    <span role="group" className={cx(s.split, size === 'small' && s.small, variant === 'signal' && s.signal, className)}>
      <Button {...main} variant={variant} size={size} className={s.main} />
      {menu(
        /* while the main action works, its alternatives wait too */
        <Button variant={variant} size={size} className={s.more} aria-label={moreLabel} disabled={main.disabled || main.busy}>
          <Icon name="chevronD" size={10} />
        </Button>,
      )}
    </span>
  )
}
