import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './TaskPreviews.module.css'

/*
 * Under a setting new projects start with, the projects whose own value
 * differs from it, each with its value, and a way to bring every project in
 * line with it. A few are named with their values; more, by their first
 * names and how many others. The whole list, each with its value, shows on
 * hover or focus, as does a name cut short. It sits in the row's note.
 * Bringing them in line goes out to the consumer, which says while it
 * works and if it failed.
 */

/** A project whose own value differs, and that value in words: Open a pull request for review, Off. */
export interface DifferingProject {
  id: string
  name: string
  value: string
}

export interface DiffersLineText {
  /** One project and its value: fnt: Off. */
  differs: (name: string, value: string) => string
  /** The first projects by name, and how many more: fnt, althar and 6 more. */
  many: (names: readonly string[], more: number) => string
  use: string
  using: string
  retry: string
}

export const differsLineText: DiffersLineText = {
  differs: (name, value) => `${name}: ${value}`,
  many: (names, more) => `${names.join(', ')} and ${more} more`,
  use: 'Use this in every project',
  using: 'Using it in every project…',
  retry: 'Try again',
}

/** Most projects named with their values on the line; past that, the first two by name and a count. */
const NAMED = 3
const FIRST = 2

export type DiffersLineProps = RootProps<
  'span',
  {
    projects: readonly DifferingProject[]
    /** Gives every project this value. Without it, no button. */
    onUseEverywhere?: () => void
    /** Giving it to every project now. */
    busy?: boolean
    /** Why it couldn't, said beside the button, which tries again. */
    error?: string
    text?: Partial<DiffersLineText>
  }
>

/** The projects whose own value differs from what new projects start with, and Use this in every project. Nothing where none differ. */
export function DiffersLine({ projects, onUseEverywhere, busy = false, error, text, className, ...rest }: DiffersLineProps) {
  const t = { ...differsLineText, ...text }
  if (projects.length === 0) return null
  const line =
    projects.length <= NAMED
      ? projects.map((one) => t.differs(one.name, one.value)).join(' · ')
      : t.many(
          projects.slice(0, FIRST).map((one) => one.name),
          projects.length - FIRST,
        )
  const card = (
    <ul className={s.list}>
      {projects.map((one) => (
        <li key={one.id}>{t.differs(one.name, one.value)}</li>
      ))}
    </ul>
  )
  return (
    <span className={cx(s.differs, className)} {...rest}>
      <HoverCard card={card} width={280}>
        {/* focusable, so the whole list opens for the keyboard as for the pointer */}
        <span className={s.which} tabIndex={0}>
          {line}
        </span>
      </HoverCard>
      {error !== undefined && !busy && (
        <span className={s.failed} role="alert">
          {error}
        </span>
      )}
      {onUseEverywhere !== undefined && (
        <LinkButton className={s.use} onClick={busy ? undefined : onUseEverywhere} aria-busy={busy || undefined}>
          {busy ? t.using : error === undefined ? t.use : t.retry}
        </LinkButton>
      )}
    </span>
  )
}
