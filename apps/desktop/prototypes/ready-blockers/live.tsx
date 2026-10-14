import { Kbd, Segmented } from '@althar/ui'
import { useEffect, useState } from 'react'

import { DIRECTIONS, type Direction } from './directions'
import s from './live.module.css'
import { Board, Bug, Home, States } from './stage'

/*
 * The live page: one screen of the app (the board, the home, or every state
 * on its card), under one direction at a time, chosen from a slim bar at the
 * foot. Switching swaps the direction in place: the same screen, the same
 * scroll, the home not read again. The URL says which: ?d=A&s=board. Keys:
 * 1–6 and ← → for the direction, B, H and S for the screen.
 */

type Screen = 'board' | 'home' | 'states'

const SCREENS: ReadonlyArray<{ readonly value: Screen; readonly label: string; readonly key: string }> = [
  { value: 'board', label: 'Board', key: 'B' },
  { value: 'home', label: 'Home', key: 'H' },
  { value: 'states', label: 'Every state', key: 'S' },
]

/** The direction and screen the URL asks for; A on the board, the chosen direction, where it asks for none. */
const fromUrl = (): { direction: Direction; screen: Screen } => {
  const params = new URLSearchParams(window.location.search)
  const d = (params.get('d') ?? 'A').toUpperCase()
  const screen = SCREENS.find((one) => one.value === params.get('s'))?.value ?? 'board'
  const direction = DIRECTIONS.find((one) => one.letter === d || (d === 'TODAY' && one.key === 'today')) ?? DIRECTIONS[1] ?? DIRECTIONS[0]
  if (direction === undefined) throw new Error('No directions')
  return { direction, screen }
}

const toUrl = (direction: Direction, screen: Screen) => {
  const url = new URL(window.location.href)
  url.searchParams.set('d', direction.letter)
  url.searchParams.set('s', screen)
  window.history.replaceState(null, '', url)
  document.title = `What blocks a ready card · ${direction.key === 'today' ? 'Today' : direction.name}`
}

export function Live() {
  const [{ direction, screen }, setShown] = useState(fromUrl)
  const at = DIRECTIONS.indexOf(direction)
  const show = (next: Partial<{ direction: Direction; screen: Screen }>) => setShown((now) => ({ ...now, ...next }))

  useEffect(() => toUrl(direction, screen), [direction, screen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      // In a field, or on the bar's own choices (whose arrows are theirs), keys are left alone.
      if (target?.closest('input, textarea, [contenteditable], [role="radiogroup"]')) return
      const digit = Number(event.key)
      const picked =
        Number.isInteger(digit) && digit >= 1 && digit <= DIRECTIONS.length
          ? DIRECTIONS[digit - 1]
          : event.key === 'ArrowRight'
            ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
            : event.key === 'ArrowLeft'
              ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
              : undefined
      const screened = SCREENS.find((one) => one.key === event.key.toUpperCase())
      if (picked !== undefined) show({ direction: picked })
      else if (screened !== undefined) show({ screen: screened.value })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at])

  return (
    <div className={s.live} data-direction={direction.letter} data-screen={screen}>
      <main className={screen === 'states' ? `${s.screen} ${s.scrolls}` : s.screen}>
        {screen === 'board' && <Board direction={direction} />}
        {screen === 'home' && <Home direction={direction} />}
        {screen === 'states' && (
          <div className={s.sheet}>
            <States direction={direction} />
            {direction.key === 'today' && (
              <section className={s.bug}>
                <h2>The known checks bug</h2>
                <p>
                  Until #159 merged this morning, the board gave AcceptCard only the passed count, so 3 of 5 still running read “All 2
                  checks passed”. Main’s board now says “2 of 5 checks passed”; AcceptCard, still in the kit and used by the site, keeps the
                  bug.
                </p>
                <Bug />
              </section>
            )}
          </div>
        )}
      </main>
      <nav className={s.bar} aria-label="Directions">
        <Segmented
          label="Direction"
          options={DIRECTIONS.map((one, i) => ({
            value: one.key,
            label: one.key === 'today' ? 'Today' : `${one.letter} · ${one.short}`,
            kbd: String(i + 1),
          }))}
          value={direction.key}
          onChange={(key) => show({ direction: DIRECTIONS.find((one) => one.key === key) ?? direction })}
        />
        <p className={s.tagline} title={direction.gist}>
          {direction.tagline}
        </p>
        <Segmented
          label="Screen"
          options={SCREENS.map((one) => ({ value: one.value, label: one.label, kbd: one.key }))}
          value={screen}
          onChange={(value) => show({ screen: value })}
        />
        <span className={s.keys} aria-hidden="true">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </span>
        <a className={s.compare} href="compare.html">
          Side by side
        </a>
      </nav>
    </div>
  )
}
