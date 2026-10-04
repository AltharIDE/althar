import { Brand, BrandMark, Logo } from '@althar/ui'

import { LINKS } from '../content/facts'
import { BRAND } from '../content/home'
import { cx } from '../lib/cx'
import s from './Bar.module.css'

/** Where the shifts list lives. */
export const SHIFTS = '/shifts'

const PARTS = [
  { id: 'agents', name: 'Agents' },
  { id: 'why', name: 'Why more than one' },
  { id: 'coordinator', name: 'Coordinator' },
  { id: 'loop', name: 'Every task' },
] as const

/**
 * The developer pages' top bar: the mark, the homepage's parts, the shifts
 * list and GitHub. On cobalt over the homepage's first screen, on paper
 * elsewhere. `base` is the homepage's path when the bar is on another page.
 */
export function Bar({ tone, base = '', current }: { tone: 'blue' | 'paper'; base?: string; current?: 'shifts' }) {
  return (
    <header className={cx(s.bar, tone === 'blue' && s.blue)}>
      <a className={s.brand} href={base || '#top'}>
        <Logo size={24} className={s.logo} />
        <span>{BRAND}</span>
      </a>
      <nav className={s.nav} aria-label="Site">
        {PARTS.map((p) => (
          <a key={p.id} className={s.part} href={`${base}#${p.id}`}>
            {p.name}
          </a>
        ))}
        <a className={s.part} href={SHIFTS} aria-current={current === 'shifts' ? 'page' : undefined}>
          Shifts
        </a>
      </nav>
      <a className={s.github} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        GitHub
      </a>
    </header>
  )
}
