import { useId, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../Heading/Heading'
import s from './Panel.module.css'

interface PanelOwn {
  /** Whose it is, above the title: Meridian · project rules. */
  kicker?: string
  title: string
  lede?: string
  /** A last line, or the buttons that submit it. */
  foot?: ReactNode
  children: ReactNode
  /** The title's rank in the page's outline. */
  headingLevel?: HeadingLevel
}

/** section for a panel you read and change in place; form for one you submit. */
export type PanelProps = RootProps<'section', PanelOwn & { as?: 'section' }> | RootProps<'form', PanelOwn & { as: 'form' }>

/**
 * A sheet of settings on the page: a kicker, a title and a line under it,
 * then its rows (FormRow), then a foot. Named by its title. Its rows
 * stack when the sheet is narrow, because the sheet is their container.
 */
export function Panel(props: PanelProps) {
  const titleId = useId()
  const inner = ({ kicker, title, lede, foot, children, headingLevel = 2 }: PanelOwn) => (
    <>
      <header className={s.head}>
        {kicker && <span className={s.kicker}>{kicker}</span>}
        <Heading level={headingLevel} id={titleId} className={s.title}>
          {title}
        </Heading>
        {lede && <p className={s.lede}>{lede}</p>}
      </header>
      {children}
      {foot && <footer className={s.foot}>{foot}</footer>}
    </>
  )
  if (props.as === 'form') {
    const { as: _, kicker, title, lede, foot, children, headingLevel, className, ...rest } = props
    return (
      <form aria-labelledby={titleId} className={cx(s.panel, className)} {...rest}>
        {inner({ kicker, title, lede, foot, children, headingLevel })}
      </form>
    )
  }
  const { as: _, kicker, title, lede, foot, children, headingLevel, className, ...rest } = props
  return (
    <section aria-labelledby={titleId} className={cx(s.panel, className)} {...rest}>
      {inner({ kicker, title, lede, foot, children, headingLevel })}
    </section>
  )
}
