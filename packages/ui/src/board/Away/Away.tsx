import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Away.module.css'

/*
 * What agents did outside their worktrees since the person last looked, over
 * the board's lanes: merged, posted, moved an issue, started tasks. Newest
 * first, a row each: what it did, its task, when. Where it can be taken back,
 * the way, at the row's end (Revert it, Undo); where it can't now, why, in
 * the same place ("dana replied"). A revert of something already released is
 * still offered, with why it undoes less than it seems beside it. Under the
 * newest, how many earlier ones there are, to show them. × clears the list:
 * the next one starts from then.
 */

/** What kind of act it was, as its glyph says it. */
export type AwayKind = 'merge' | 'post' | 'issue' | 'start' | 'other'

const glyph: Record<AwayKind, IconName> = {
  merge: 'pr',
  post: 'comment',
  issue: 'move',
  start: 'create',
  other: 'external',
}

export interface AwayAct {
  readonly id: string
  readonly kind: AwayKind
  /** What it did: Merged #634 into main. */
  readonly what: string
  /** The task it was done for, by its title; absent for the coordinator's own. */
  readonly task?: string
  /** When, as the board says a time: 13:10. */
  readonly at: string
  /** How it is taken back, as its link says it: Revert it, Undo. Absent where it can't be. */
  readonly undo?: string
  /** Why it can't be taken back now, or what taking it back leaves: dana replied, Released in 0.8.4. */
  readonly cant?: string
  /** Being taken back, or taken back: said in the link's place. */
  readonly undoing?: string
  /** It was taken back: its words are struck through. */
  readonly undone?: boolean
  /** Taking it back failed: why, in the row's end. */
  readonly failed?: string
}

export interface AwayText {
  title: string
  since: (at: string) => string
  clear: string
  /** Read before a row's task, which is shown alone. */
  task: string
  earlier: (n: number) => string
}

export const awayText: AwayText = {
  title: 'While you were away',
  since: (at) => `since ${at}`,
  clear: 'Clear',
  task: 'Task',
  earlier: (n) => `${n} earlier`,
}

export type AwayProps = RootProps<
  'section',
  {
    /** When the person last looked, as the board says a time: 11:40. Absent before they ever did. */
    since?: string
    /** Newest first. */
    acts: ReadonlyArray<AwayAct>
    /** Takes one back, the way its row says. */
    onUndo?: (id: string) => void
    /** Opens the task a row was done for. */
    onOpen?: (id: string) => void
    /** Clears the list, until something else is done. */
    onClear: () => void
    /** How many acts are older than those shown, and the way to show them; nothing under the list without both. */
    earlier?: number
    onEarlier?: () => void
    text?: Partial<AwayText>
  }
>

export function Away({ since, acts, onUndo, onOpen, onClear, earlier = 0, onEarlier, className, text, ...rest }: AwayProps) {
  const t = { ...awayText, ...text }
  return (
    <section aria-label={t.title} className={cx(s.away, className)} {...rest}>
      <p className={s.head}>
        <span className={s.title}>{t.title}</span>
        {since !== undefined && <span className={s.since}>{t.since(since)}</span>}
        <IconButton icon="close" label={t.clear} size="small" tooltipAlign="end" className={s.clear} onClick={onClear} />
      </p>
      <ul className={s.acts}>
        {acts.map((act) => (
          <li key={act.id} className={s.act} data-undone={act.undone === true || undefined}>
            <Icon name={glyph[act.kind]} size={13} className={s.glyph} />
            <span className={s.what} title={act.what}>
              {act.what}
            </span>
            <span className={s.task}>
              {act.task !== undefined &&
                (onOpen === undefined ? (
                  <span title={act.task}>{act.task}</span>
                ) : (
                  <button type="button" className={s.open} title={act.task} onClick={() => onOpen(act.id)}>
                    <VisuallyHidden>{t.task} </VisuallyHidden>
                    {act.task}
                  </button>
                ))}
            </span>
            <span className={s.at}>{act.at}</span>
            {act.failed !== undefined ? (
              <span className={cx(s.cant, s.failed)} role="alert" title={act.failed}>
                {act.failed}
              </span>
            ) : (
              <span className={s.cant} title={act.cant}>
                {act.cant}
              </span>
            )}
            <span className={s.undo}>
              {act.undoing !== undefined ? (
                <span className={s.undoing}>{act.undoing}</span>
              ) : (
                act.undo !== undefined && onUndo !== undefined && <LinkButton onClick={() => onUndo(act.id)}>{act.undo}</LinkButton>
              )}
            </span>
          </li>
        ))}
      </ul>
      {earlier > 0 && onEarlier !== undefined && (
        <p className={s.earlier}>
          <LinkButton onClick={onEarlier}>{t.earlier(earlier)}</LinkButton>
        </p>
      )}
    </section>
  )
}
