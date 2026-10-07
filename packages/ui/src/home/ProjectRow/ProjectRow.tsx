import type { ReactNode } from 'react'

import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import type { ProjectRef } from '../ProjectWord/ProjectWord'
import s from './ProjectRow.module.css'

/*
 * A project in the home's list of projects, and the way into it. Its mark
 * carries where it stands (an arc while work runs, a dot while something
 * waits on you, faded while nothing is going on), and the words beside it
 * say the same: how many need you, how many run, and what its lead task is
 * doing now. A project with nothing going on says when it last did.
 */

export interface ProjectRowText {
  yours: (n: number) => string
  running: (n: number) => string
  /** What its lead task is doing: Review on 419. */
  now: (step: string, task: string) => string
  /** A quiet project with nothing else to say. */
  idle: string
}

export const projectRowText: ProjectRowText = {
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  running: (n) => `${n} running`,
  now: (step, task) => `${step} on ${task}`,
  idle: 'Nothing running',
}

/** What a project's lead task is doing now. */
export interface ProjectNow {
  step: string
  task: string
  /** Who is on the step. */
  who: ModelInfo
}

export interface ProjectRowProps {
  project: ProjectRef
  /** Tasks running in it, held ones included. */
  running: number
  /** Calls in it that wait on you. */
  yours: number
  /** Work in it is moving now, not only held: the arc goes round its mark. As long as something runs, unless told. */
  moving?: boolean
  now?: ProjectNow
  /** What a quiet project says instead: Last task Friday. */
  note?: string
  /** The shortcut that opens it: ⌘1. */
  kbd?: string
  /** Open the project. Without it, the row is words. */
  onOpen?: () => void
  className?: string
  text?: Partial<ProjectRowText>
}

export function ProjectRow({ project, running, yours, moving = running > 0, now, note, kbd, onOpen, className, text }: ProjectRowProps) {
  const t = { ...projectRowText, ...text }
  const active = running + yours > 0
  const content: ReactNode = (
    <>
      <ProjectMark seed={project.seed} ink={project.ink} running={moving} yours={yours > 0} quiet={!active} className={s.mark} />
      <span className={s.name}>{project.name}</span>
      {kbd && <Kbd className={s.kbd}>{kbd}</Kbd>}
      {active ? (
        <span className={s.status}>
          {yours > 0 && (
            <span className={s.yours}>
              <i aria-hidden="true" />
              {t.yours(yours)}
            </span>
          )}
          {running > 0 && (
            <span className={s.running}>
              <LiveDot />
              {t.running(running)}
            </span>
          )}
        </span>
      ) : (
        <span className={s.note}>{note ?? t.idle}</span>
      )}
      {now && (
        <span className={s.now}>
          <span className={s.doing}>{t.now(now.step, now.task)}</span>
          <Model model={now.who} short />
        </span>
      )}
    </>
  )
  const look = cx(s.row, !active && s.quiet, className)
  if (!onOpen) return <div className={look}>{content}</div>
  return (
    <button type="button" className={cx(look, s.button)} onClick={onOpen}>
      {content}
    </button>
  )
}
