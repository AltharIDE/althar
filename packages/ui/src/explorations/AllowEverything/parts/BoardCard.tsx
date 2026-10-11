import type { ReactNode } from 'react'

import { CardTitle } from '../../../board/Board/CardTitle'
import b from '../../../board/Board/Board.module.css'
import { workCardText, type WorkCardProps } from '../../../board/WorkCard/WorkCard'
import w from '../../../board/WorkCard/WorkCard.module.css'
import { TaskStatus } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { Model } from '../../../primitives/Model/Model'
import { StepTrack, trackOf } from '../../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { CARD, OTHER_CARD } from '../fixtures'
import s from './BoardCard.module.css'

/*
 * The board's WorkCard, as it would be with a mark in its top line, after
 * what kind of work it is. The real card has no place for one yet, so this
 * is its markup and its own styles, with the mark added; nothing else is
 * changed.
 */

type CardProps = Omit<WorkCardProps, 'status' | 'current' | 'text' | 'added' | 'note' | 'seen'>

export function BoardCard({ mark, task, kind, title, steps, at, elapsed, lead, onStep, onOpen }: CardProps & { mark?: ReactNode }) {
  const t = workCardText
  return (
    <article className={cx(b.card, w.work, w.running)}>
      <div className={b.top}>
        <span className={w.status}>
          <TaskGlyph status={TaskStatus.Running} />
          <VisuallyHidden>{t.status[TaskStatus.Running]}</VisuallyHidden>
        </span>
        <span className={b.ref}>{t.task(task)}</span>
        {kind && <span>{kind}</span>}
        {mark}
        <span className={cx(b.at, w.elapsed)}>{elapsed}</span>
      </div>
      <CardTitle onOpen={onOpen}>{title}</CardTitle>
      <StepTrack steps={trackOf(steps, at)} status={TaskStatus.Running} className={w.track} />
      <div className={w.step}>
        <span className={w.now}>{steps[at]}</span>
        {onStep?.map((m) => (
          <Model key={m.id} model={m} short className={w.agent} />
        ))}
        <span className={w.of}>{t.of(at + 1, steps.length)}</span>
      </div>
      <div className={b.foot}>
        <span className={w.lead}>
          {t.lead} <Model model={lead} short className={w.leadModel} />
        </span>
      </div>
    </article>
  )
}

/** A lane of the board's running work: task 418, and another beside it that has no mark. */
export function Lane({ mark, label }: { mark?: ReactNode; label: string }) {
  return (
    <section className={s.lane} aria-label={label}>
      <BoardCard {...CARD} mark={mark} />
      <BoardCard {...OTHER_CARD} />
    </section>
  )
}
