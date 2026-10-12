import { Logo } from '@althar/ui'
import { type RefObject, useEffect, useState } from 'react'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import s from './parts.module.css'

/** The footer's links, in two short groups. */
export const GROUPS = [
  {
    name: 'Althar',
    links: [
      { href: LINKS.releases, name: 'Download' },
      { href: LINKS.repo, name: 'GitHub' },
      { href: LINKS.issues, name: 'Issues' },
    ],
  },
  {
    name: 'Read',
    links: [
      { href: '/thesis', name: 'Thesis' },
      { href: '/shifts', name: 'Shifts' },
      { href: '/wallpaper', name: 'Wallpaper' },
    ],
  },
] as const

export const YEAR = 2026

/** The mark and the name, as the footer starts. */
export function Signature({ className }: { className?: string }) {
  return (
    <a className={cx(s.signature, className)} href="#top">
      <Logo size={26} />
      <span>Althar</span>
    </a>
  )
}

/** The links, in their groups. */
export function Links({ className }: { className?: string }) {
  return (
    <nav className={cx(s.links, className)} aria-label="Footer">
      {GROUPS.map((group) => (
        <div key={group.name}>
          <p>{group.name}</p>
          <ul>
            {group.links.map((link) => (
              <li key={link.name}>
                <a href={link.href}>{link.name}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Whether to hold still: reduced motion, or a still picture asked for with ?t. */
export const still = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')

/** Whether `ref` is on screen at all, for what draws on every frame only while it is seen. */
export function useOnScreen(ref: RefObject<Element | null>) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setOn(e?.isIntersecting ?? false), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return on
}
