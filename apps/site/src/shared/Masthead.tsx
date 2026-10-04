import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { LINKS } from '../content/facts'
import s from './Masthead.module.css'

/*
 * The bar along the top, pinned: the mark at a size it can be read at, the
 * page's parts numbered like the sheets of a set with the one you're on
 * picked out, as Set's title block does, the thesis, and Set's button to
 * follow along.
 */

export interface Part {
  id: string
  no: string
  name: string
}

/** Where the thesis is read, on this site. */
export const THESIS = '/thesis'

/** The landing page's parts, numbered as the bar shows them. */
export const PARTS: readonly Part[] = [
  { id: 'site', no: '01', name: 'The site' },
  { id: 'what', no: '02', name: 'What it is' },
  { id: 'agents', no: '03', name: 'Agents' },
  { id: 'task', no: '04', name: 'One task' },
  { id: 'knows', no: '05', name: 'What it knows' },
  { id: 'stands', no: '06', name: 'Where it stands' },
]

/** `base` is the landing page's path, when the bar is shown on another page. */
export function Masthead({ current, base = '' }: { current: string; base?: string }) {
  const parts = PARTS
  const bar = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = bar.current
    if (!el) return
    const onScroll = () => {
      if (window.scrollY > 8) el.dataset.scrolled = ''
      else delete el.dataset.scrolled
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header ref={bar} className={s.bar}>
      <a className={s.brand} href={`${base}#${parts[0]?.id ?? 'main'}`}>
        <Logo size={30} />
        <span>Althar</span>
      </a>
      <nav className={s.nav} aria-label="On this page">
        {parts.map((p) => (
          <a key={p.id} className={s.part} href={`${base}#${p.id}`} aria-current={p.id === current ? 'location' : undefined}>
            <span>{p.no}</span>
            {p.name}
          </a>
        ))}
        <i className={s.sep} aria-hidden="true" />
        <a className={s.thesis} href={THESIS} aria-current={current === 'thesis' ? 'page' : undefined}>
          Thesis
        </a>
      </nav>
      <a className={s.follow} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        <span className={s.followLong}>Follow on GitHub</span>
        <span className={s.followShort}>GitHub</span>
      </a>
    </header>
  )
}
