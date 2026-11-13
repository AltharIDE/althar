import { Icon } from '../../foundations/Icon/Icon'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import s from './StartedTask.module.css'

/*
 * A task a lead started (ADR-097), where its thread says so: one chip that
 * stays one chip. It names the task, says where it stands on the board in the
 * board's own words (planned and counting down, working, waiting on you, its
 * pull request open with its checks, merged, done, abandoned), and which model
 * leads it; pressing it opens the task. The host keeps it current, so the end
 * shows on the same chip rather than in a line of its own.
 */

/** Where the task stands: a running task's status, or how a settled one ended. */
export type StartedTone = TaskStatus | 'merged' | 'abandoned'

export type StartedTaskProps = RootProps<
  'button',
  {
    /** The task's title. */
    title: string
    tone: StartedTone
    /** Where it stands, in the board's word for it: Working, Needs you, Merged. */
    word: string
    /** What more the board says of it, in a few words: starts in 12s, #812 · checks pass. */
    detail?: string | undefined
    /** The model that leads it. */
    model?: ModelInfo | undefined
  }
>

const isStatus = (tone: StartedTone): tone is TaskStatus => tone !== 'merged' && tone !== 'abandoned'

/** The mark beside the word: the board's glyph while it runs; a check for what merged; a stop for what was abandoned. */
function Mark({ tone }: { tone: StartedTone }) {
  if (isStatus(tone)) return <TaskGlyph status={tone} />
  return <Icon name={tone === 'merged' ? 'check' : 'stop'} size={11} />
}

/** A started task, as a chip: its title, where it stands and who leads it. It opens the task. */
export function StartedTask({ title, tone, word, detail, model, className, ...rest }: StartedTaskProps) {
  return (
    <button type="button" className={cx(s.chip, s[tone], className)} data-rhythm={Rhythm.Card} {...rest}>
      <span className={s.stands}>
        <Mark tone={tone} />
        {word}
      </span>
      <span className={s.title}>{title}</span>
      {detail !== undefined && detail !== '' && <span className={s.detail}>{detail}</span>}
      {model !== undefined && <Model model={model} short className={s.model} />}
    </button>
  )
}
