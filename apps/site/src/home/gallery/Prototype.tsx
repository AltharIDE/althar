import { type ComponentType, useEffect, useRef, useState } from 'react'

import { Footer } from '../../shared/footer/Footer'
import { Nav, NavSpace } from '../../shared/Nav'
import { DesktopBody } from '../bodies/desktop/DesktopBody'
import { RunsOn } from '../bodies/RunsOn'
import { Hero } from '../Hero'
import h from '../Home.module.css'
import { Film, Strip, Tabs, Wall } from './directions'
import g from './gallery.module.css'
import type { Place } from './parts'

/*
 * Prototype: a gallery of the app on the homepage, a few directions, on the
 * real page. Keys 0 and A–D swap the direction, P where it stands (after the
 * first screen, or before the download), G goes to it. ?d=a&p=end opens it
 * so; &shot hides the bar, for screenshots. Delete once a direction is picked.
 */

interface Direction {
  key: string
  name: string
  idea: string
  place: Place | null
  Body: ComponentType<{ place: Place }> | null
}

const DIRECTIONS: readonly Direction[] = [
  { key: '0', name: 'Now', idea: 'The page as it is, with no gallery.', place: null, Body: null },
  {
    key: 'a',
    name: 'Tabs',
    idea: 'One screen large, named tabs under it; it moves on by itself until you pick one.',
    place: 'top',
    Body: Tabs,
  },
  { key: 'b', name: 'Strip', idea: 'Every screen in a row you scroll sideways; open one to see it whole.', place: 'end', Body: Strip },
  { key: 'c', name: 'Film', idea: 'The changelog’s moving drawings, played as one task, chapter by chapter.', place: 'top', Body: Film },
  { key: 'd', name: 'Wall', idea: 'Every screen at once, at its own shape; open one to see it whole.', place: 'end', Body: Wall },
]

const PLACES: Record<Place, string> = { top: 'After the first screen', end: 'Before the download' }

const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')

export function Prototype() {
  const [key, setKey] = useState(() => DIRECTIONS.find((d) => d.key === params.get('d'))?.key ?? 'b')
  const dir = DIRECTIONS.find((d) => d.key === key) ?? DIRECTIONS[1]!
  const [placed, setPlaced] = useState<Place | null>(() => {
    const p = params.get('p')
    return p === 'top' || p === 'end' ? p : null
  })
  const place: Place = placed ?? dir.place ?? 'top'
  // Swapping goes to where the gallery stands; opening the page doesn't, unless asked (&go).
  const shown = useRef(`${key}-${place}`)
  useEffect(() => {
    document.title = 'Gallery · prototype'
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', key)
    if (placed) url.searchParams.set('p', placed)
    else url.searchParams.delete('p')
    url.searchParams.delete('go')
    history.replaceState(null, '', url)
  }, [key, placed])
  useEffect(() => {
    const now = `${key}-${place}`
    if (shown.current === now) return
    shown.current = now
    requestAnimationFrame(() => document.getElementById('gallery')?.scrollIntoView({ block: 'start' }))
  }, [key, place])
  useEffect(() => {
    if (params.has('go')) requestAnimationFrame(() => document.getElementById('gallery')?.scrollIntoView({ block: 'start' }))
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('textarea, input, [contenteditable], [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const d = DIRECTIONS.find((x) => x.key === k)
      if (d) {
        setKey(d.key)
        setPlaced(null)
      } else if (k === 'p') setPlaced((p) => ((p ?? dir.place ?? 'top') === 'top' ? 'end' : 'top'))
      else if (k === 'g') document.getElementById('gallery')?.scrollIntoView({ block: 'start' })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [dir.place])

  const gallery = dir.Body ? <dir.Body place={place} /> : null
  return (
    <div className={h.page} id="top">
      <Nav opening />
      <Hero nav={<NavSpace />} />
      <div className={h.night}>
        <RunsOn />
      </div>
      <DesktopBody key={`${key}-${place}`} first={place === 'top' ? gallery : null} last={place === 'end' ? gallery : null} />
      <Footer />
      {!SHOT && <div className={g.barSpace} />}
      {!SHOT && (
        <nav className={g.bar} aria-label="Directions">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={d.key === key}
              title={d.idea}
              onClick={() => {
                setKey(d.key)
                setPlaced(null)
              }}
            >
              <kbd>{d.key.toUpperCase()}</kbd> {d.name}
            </button>
          ))}
          <span className={g.sep} />
          <button type="button" disabled={!dir.Body} onClick={() => setPlaced(place === 'top' ? 'end' : 'top')}>
            <kbd>P</kbd> {PLACES[place]}
          </button>
          <button type="button" disabled={!dir.Body} onClick={() => document.getElementById('gallery')?.scrollIntoView({ block: 'start' })}>
            <kbd>G</kbd> Go to it
          </button>
          <span className={g.sep} />
          <span className={g.idea}>{dir.idea}</span>
        </nav>
      )}
    </div>
  )
}
