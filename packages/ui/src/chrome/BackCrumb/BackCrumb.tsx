import { Icon } from '../../foundations/Icon/Icon'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Kbd } from '../../primitives/Kbd/Kbd'
import s from './BackCrumb.module.css'

/*
 * When a task takes the whole window, the way out sits where the eye
 * starts, like a breadcrumb: back to the project, with its key, then which
 * task this is.
 */

export interface BackCrumbText {
  label: string
  back: (to: string) => string
}

export const backCrumbText: BackCrumbText = { label: 'Where you are', back: (to) => `Back to ${to}` }

export interface BackCrumbProps {
  /** Where back goes: the project's name. */
  to: string
  onBack: () => void
  /** The key that goes back, shown; the consumer binds it. */
  kbd?: string
  /** Where you are now: the task's number. */
  task?: string
  title?: string
  /** The title as the page's heading, at this rank, where the bar is all the head the page has. */
  titleLevel?: HeadingLevel
  text?: Partial<BackCrumbText>
}

export function BackCrumb({ to, onBack, kbd, task, title, titleLevel, text }: BackCrumbProps) {
  const t = { ...backCrumbText, ...text }
  return (
    <nav className={s.crumb} aria-label={t.label}>
      <button type="button" className={s.back} onClick={onBack} aria-label={t.back(to)}>
        <Icon name="arrow" size={12} className={s.arrow} />
        {to}
        {kbd && <Kbd>{kbd}</Kbd>}
      </button>
      {(task || title) && (
        <>
          <span className={s.sep} aria-hidden="true">
            /
          </span>
          <span className={s.here} aria-current="page">
            {task && <span className={s.task}>{task}</span>}
            {title &&
              (titleLevel === undefined ? (
                <span className={s.title}>{title}</span>
              ) : (
                // One line, however long it was written: the whole of it on hover.
                <Heading level={titleLevel} className={s.title} title={title}>
                  {title}
                </Heading>
              ))}
          </span>
        </>
      )}
    </nav>
  )
}
