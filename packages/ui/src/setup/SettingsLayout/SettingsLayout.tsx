import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Panel } from '../../primitives/Panel/Panel'
import s from './SettingsLayout.module.css'

/*
 * A page of settings, laid out alike wherever there is one (Althar's own, a
 * project's): down the side, the way to each section, a SettingsNav and
 * what goes with it; beside it, the section open, on a sheet of its own
 * with a line on what it is for. The side stays in sight while a long
 * section scrolls. On a smaller window the side narrows and the margins
 * close first, so the sheet keeps the room; on a narrow one the side goes
 * over the sheet.
 */

export interface SettingsLayoutProps {
  /** Down the side: the sections, and what goes above or under them. */
  side: ReactNode
  /** The section open, by its id: another is a sheet of its own, so nothing half done in one carries over to the next. */
  section: string
  /** The section's name, the page's heading. */
  title: string
  /** What the section is for, in a line. */
  lede?: string
  /** What is in the section. */
  children: ReactNode
  /** The title's rank: the page's own, or one under the heading of what the settings are of, such as a project's name. */
  headingLevel?: HeadingLevel
  className?: string
}

export function SettingsLayout({ side, section, title, lede, children, headingLevel = 1, className }: SettingsLayoutProps) {
  return (
    <div className={cx(s.page, className)}>
      <div className={s.columns}>
        <aside className={s.side}>{side}</aside>
        <main className={s.main}>
          <Panel key={section} title={title} {...(lede === undefined ? {} : { lede })} headingLevel={headingLevel}>
            <div className={s.body}>{children}</div>
          </Panel>
        </main>
      </div>
    </div>
  )
}
