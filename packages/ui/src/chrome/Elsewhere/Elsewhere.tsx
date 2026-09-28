import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import s from './Elsewhere.module.css'

/*
 * Another project needs you, said once in the bar, without a sidebar: the
 * project you are in keeps the window, and the one that wants you is a word
 * away. One project by name, with how many calls; more than one, by count,
 * and pressing it opens the switcher. With none, nothing shows.
 */

export interface ElsewhereProject {
  id: string
  name: string
  /** Calls waiting on you there. */
  yours: number
}

export interface ElsewhereText {
  many: (n: number) => string
  go: (name: string, n: number) => string
}

export const elsewhereText: ElsewhereText = {
  many: (n) => `${n} other projects`,
  go: (name, n) => `Go to ${name}: ${n === 1 ? '1 call waits' : `${n} calls wait`} on you`,
}

export interface ElsewhereProps {
  /** The other projects; those with nothing waiting are left out. */
  projects: readonly ElsewhereProject[]
  onPick: (id: string) => void
  /** More than one waits: open the switcher. */
  onMore: () => void
  text?: Partial<ElsewhereText>
}

export function Elsewhere({ projects, onPick, onMore, text }: ElsewhereProps) {
  const t = { ...elsewhereText, ...text }
  const waiting = projects.filter((p) => p.yours > 0)
  const [one] = waiting
  if (!one) return null
  if (waiting.length === 1)
    return (
      <ActionButton tone="strong" onClick={() => onPick(one.id)} aria-label={t.go(one.name, one.yours)}>
        <span className={s.dot} aria-hidden="true" />
        {one.name}
        <span className={s.n}>{one.yours}</span>
      </ActionButton>
    )
  return (
    <ActionButton tone="strong" onClick={onMore}>
      <span className={s.dot} aria-hidden="true" />
      {t.many(waiting.length)}
    </ActionButton>
  )
}
