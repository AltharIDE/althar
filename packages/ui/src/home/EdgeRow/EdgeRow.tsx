import type { ReactNode } from 'react'

import { TaskStatus, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { type ProjectRef, ProjectWord } from '../ProjectWord/ProjectWord'
import s from './EdgeRow.module.css'

/*
 * A task as the edge of the screen lists it, in the island round the notch
 * or under Althar's item in the menu bar: where it stands, its title, and a
 * quiet line under it with its project. One that waits on you names the kind
 * of call in violet, and can hold what it asks and its answers, so a quick
 * one is answered there without opening Althar. Its title opens it in Althar.
 */

export type EdgeRowProps = RootProps<
  'div',
  {
    status: TaskStatus
    project: ProjectRef
    title: string
    /** What kind of call waits on you: Permission, Ready to accept. Only for one that does. */
    kind?: string
    /** The quiet line's end: how long it has waited (4m ago), where it is (Implement · Codex · 41m), or what it waits for. */
    meta?: string
    /** What it asks, under the line: a NeedCommand, or a sentence. */
    detail?: ReactNode
    /** Its answers: Buttons, the one that matters most in violet. */
    actions?: ReactNode
    /** Open its task in Althar. Without it, the title is words. */
    onOpen?: () => void
    /** It has just come in: its ring goes out quicker for a moment. */
    fresh?: boolean
  }
>

function Glyph({ status, fresh }: { status: TaskStatus; fresh: boolean }) {
  switch (status) {
    // Running stays still; only what waits on you rings.
    case TaskStatus.Running:
      return <LiveDot />
    case TaskStatus.Yours:
      return <LiveDot signal ping urgent={fresh} />
    case TaskStatus.Paused:
    case TaskStatus.Stopped:
    case TaskStatus.Done:
      return <TaskGlyph status={status} />
    default:
      return unreachable(status)
  }
}

export function EdgeRow({ status, project, title, kind, meta, detail, actions, onOpen, fresh = false, className, ...rest }: EdgeRowProps) {
  return (
    <div className={cx(s.row, className)} data-status={status} {...rest}>
      <span className={s.glyph}>
        <Glyph status={status} fresh={fresh} />
      </span>
      <div className={s.main}>
        {onOpen ? (
          <button type="button" className={cx(s.title, s.open)} onClick={onOpen}>
            {title}
          </button>
        ) : (
          <span className={s.title}>{title}</span>
        )}
        <span className={s.meta}>
          <ProjectWord project={project} />
          {kind && <span className={s.kind}>{kind}</span>}
          {meta && <span className={s.note}>{meta}</span>}
        </span>
        {detail && <div className={s.detail}>{detail}</div>}
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </div>
  )
}
