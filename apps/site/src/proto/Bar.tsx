import { useEffect, useState } from 'react'

import { cx } from '../lib/cx'
import s from './Bar.module.css'

/*
 * The bar along the foot of the prototype: one group for each part being
 * chosen, each with its directions, A, B, C… The group whose part is on
 * screen takes the keys: its letter picks a direction, ← and → step through
 * them. 1, 2 and 3 go to a part. What is picked is kept in the address, so a
 * link shows the same page.
 */

export interface Group {
  id: string
  label: string
  /** The id of the part on the page, to scroll to and to watch. */
  target: string
  directions: ReadonlyArray<{ key: string; name: string }>
}

export type Picks = Record<string, string>

const read = (groups: readonly Group[]): Picks => {
  const query = new URLSearchParams(window.location.search)
  return Object.fromEntries(
    groups.map((g) => {
      const asked = query.get(g.id)
      return [g.id, g.directions.some((d) => d.key === asked) ? asked! : g.directions[0]!.key]
    }),
  )
}

/** What is picked, read from and written to the address. */
export function usePicks(groups: readonly Group[]): [Picks, (group: string, key: string) => void] {
  const [picks, setPicks] = useState<Picks>(() => read(groups))
  const pick = (group: string, key: string) =>
    setPicks((was) => {
      const next = { ...was, [group]: key }
      const query = new URLSearchParams(window.location.search)
      for (const [id, value] of Object.entries(next)) query.set(id, value)
      // A page shared as a link may sit in a frame that keeps its address: there, the picks live in the page alone.
      try {
        window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
      } catch {}
      return next
    })
  return [picks, pick]
}

const go = (target: string) => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export function Bar({ groups, picks, pick }: { groups: readonly Group[]; picks: Picks; pick: (group: string, key: string) => void }) {
  const [active, setActive] = useState(groups[0]!.id)

  // The group whose part crosses the middle of the window.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive((was) => groups.find((g) => g.target === e.target.id)?.id ?? was)
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    for (const g of groups) {
      const el = document.getElementById(g.target)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
    // Watched again whenever a pick changes: a direction can put its part somewhere else on the page.
  }, [groups, picks])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea')) return
      const group = groups.find((g) => g.id === active)
      if (!group) return
      const at = group.directions.findIndex((d) => d.key === picks[group.id])
      const n = group.directions.length
      const letter = group.directions.find((d) => d.key === e.key.toLowerCase())
      if (letter) pick(group.id, letter.key)
      else if (e.key === 'ArrowRight') pick(group.id, group.directions[(at + 1) % n]!.key)
      else if (e.key === 'ArrowLeft') pick(group.id, group.directions[(at - 1 + n) % n]!.key)
      else if (/^[1-9]$/.test(e.key) && groups[Number(e.key) - 1]) go(groups[Number(e.key) - 1]!.target)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [groups, active, picks, pick])

  const current = groups.find((g) => g.id === active)!
  const name = current.directions.find((d) => d.key === picks[current.id])?.name

  return (
    <nav className={s.bar} aria-label="Directions">
      <p className={s.now}>
        <b>{current.label}</b> {picks[current.id]?.toUpperCase()} · {name}
      </p>
      <div className={s.groups}>
        {groups.map((g, i) => (
          <div key={g.id} className={cx(s.group, g.id === active && s.on)}>
            <button type="button" className={s.label} onClick={() => go(g.target)}>
              <kbd>{i + 1}</kbd> {g.label}
            </button>
            <div className={s.keys}>
              {g.directions.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={cx(s.key, picks[g.id] === d.key && s.picked)}
                  title={d.name}
                  aria-pressed={picks[g.id] === d.key}
                  onClick={() => {
                    pick(g.id, d.key)
                    setActive(g.id)
                  }}
                >
                  {d.key.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}
