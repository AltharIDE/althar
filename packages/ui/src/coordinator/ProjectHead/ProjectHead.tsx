import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu } from '../../primitives/Menu/Menu'
import s from './ProjectHead.module.css'

/*
 * The head of a project's conversation, over the thread in its column: what
 * the project is (its intent, or its name), a quiet line under it, and the
 * project's menu beside them, as the prototype has it: two lines, nothing
 * under them. The title is the screen's heading. `side` is the narrow head of
 * the conversation beside the board, on its raised column.
 */

export interface ProjectHeadText {
  /** The menu button's name. */
  menu: (title: string) => string
}

export const projectHeadText: ProjectHeadText = {
  menu: (title) => `${title} options`,
}

export type ProjectHeadProps = RootProps<
  'header',
  {
    title: string
    /** The quiet line under the title: where the project is, or when its intent was set. */
    meta?: ReactNode
    /** The menu's items (MenuItem); without them there is no menu. */
    menu?: ReactNode
    /** Beside the board, in a narrow column. */
    side?: boolean
    text?: Partial<ProjectHeadText>
  }
>

export function ProjectHead({ title, meta, menu, side = false, text, className, ...rest }: ProjectHeadProps) {
  const t = { ...projectHeadText, ...text }
  return (
    <header className={cx(s.head, side && s.side, className)} {...rest}>
      <div className={s.measure}>
        <div className={s.row}>
          <div className={s.words}>
            <h1 className={s.title}>{title}</h1>
            {meta != null && <p className={s.meta}>{meta}</p>}
          </div>
          {menu != null && (
            <Menu
              label={t.menu(title)}
              align="end"
              width={220}
              trigger={<IconButton icon="more" label={t.menu(title)} className={s.menu} />}
            >
              {menu}
            </Menu>
          )}
        </div>
      </div>
    </header>
  )
}
