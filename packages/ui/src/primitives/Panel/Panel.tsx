import { useId, type ComponentProps, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './Panel.module.css'

type Element = 'section' | 'form'

export type PanelProps<E extends Element = 'section'> = {
  /** section for a panel you read and change in place; form for one you submit. */
  as?: E
  /** Whose it is, above the title: Meridian · project rules. */
  kicker?: string
  title: string
  lede?: string
  /** A last line, or the buttons that submit it. */
  foot?: ReactNode
  children: ReactNode
} & Omit<ComponentProps<E>, 'title' | 'children'>

/**
 * A sheet of settings on the page: a kicker, a title and a line under it,
 * then its rows (FormRow), then a foot. Named by its title. Its rows
 * stack when the sheet is narrow, because the sheet is their container.
 */
export function Panel<E extends Element = 'section'>({ as, kicker, title, lede, foot, children, className, ...rest }: PanelProps<E>) {
  const titleId = useId()
  const Tag = (as ?? 'section') as 'section'
  return (
    <Tag aria-labelledby={titleId} className={cx(s.panel, className)} {...(rest as ComponentProps<'section'>)}>
      <header className={s.head}>
        {kicker && <span className={s.kicker}>{kicker}</span>}
        <h2 id={titleId} className={s.title}>
          {title}
        </h2>
        {lede && <p className={s.lede}>{lede}</p>}
      </header>
      {children}
      {foot && <footer className={s.foot}>{foot}</footer>}
    </Tag>
  )
}
