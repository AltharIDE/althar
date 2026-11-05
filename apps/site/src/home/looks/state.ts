import { useSyncExternalStore } from 'react'

/*
 * Prototype: which look the homepage's sections wear, A, B, C or as they are
 * today, which first screen opens the page, and under Orrery how its sun is
 * drawn. The address keeps them (?look=b&hero=night&sun=2.5d), so a link
 * opens them again; keys 1 to 6 pick a look, ← and → step through them, H
 * steps through the first screens (⇧H back), S swaps the sun.
 * Swapping a look keeps the section you are reading where it was on the
 * screen.
 */

export type Look = 'A' | 'B' | 'C' | 'D' | 'E' | 'Today'

export const LOOKS: ReadonlyArray<{ value: Look; name: string }> = [
  { value: 'A', name: 'Flight chart' },
  { value: 'B', name: 'Approach chart' },
  { value: 'C', name: 'Cabin' },
  { value: 'D', name: 'Cloud sea' },
  { value: 'E', name: 'Dither' },
  { value: 'Today', name: 'Today' },
]

const lookOf = (word: string | null): Look | undefined => LOOKS.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value

let look: Look = lookOf(new URLSearchParams(window.location.search).get('look')) ?? 'A'
const listeners = new Set<() => void>()

export type HeroLook = 'Today' | 'Night' | 'Chart' | 'Cloud' | 'Dither'

export const HEROES: ReadonlyArray<{ value: HeroLook; name: string }> = [
  { value: 'Today', name: 'Today' },
  { value: 'Night', name: 'Orrery' },
  { value: 'Cloud', name: 'Cloud' },
]

const heroOf = (word: string | null): HeroLook | undefined => HEROES.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value

let hero: HeroLook = heroOf(new URLSearchParams(window.location.search).get('hero')) ?? 'Today'

export type SunLook = '3D' | '2.5D'

export const SUNS: ReadonlyArray<{ value: SunLook; name: string }> = [
  { value: '3D', name: '3D' },
  { value: '2.5D', name: '2.5D' },
]

let sun: SunLook =
  SUNS.find((one) => one.value.toLowerCase() === new URLSearchParams(window.location.search).get('sun')?.toLowerCase())?.value ?? '3D'

/** The address, with `key` set to `value`. */
const keep = (key: string, value: string) => {
  const params = new URLSearchParams(window.location.search)
  params.set(key, value)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}

/** The sections whose place on the screen a swap keeps, top to bottom. */
const PLACES = ['independent', 'coordinator', 'review', 'flow', 'edge', 'end'] as const

/** Where the reader is: the section nearest above the screen's upper third, and how far from the top it stands; or how far from the page's foot, in the footer. */
type Place = { id: string; top: number } | { fromFoot: number } | null
let held: Place = null

const placeNow = (): Place => {
  const main = document.getElementById('main')
  if (!main) return null
  const box = main.getBoundingClientRect()
  // Still at the first screen or the band: nothing above it changes.
  if (box.top > 0) return null
  if (box.bottom < window.innerHeight * 0.4) return { fromFoot: document.documentElement.scrollHeight - window.scrollY }
  let place: Place = { id: 'main', top: box.top }
  for (const id of PLACES) {
    const top = document.getElementById(id)?.getBoundingClientRect().top
    if (top !== undefined && top <= window.innerHeight * 0.34) place = { id, top }
  }
  return place
}

/** Puts the reader back where they were, in the new look. */
export const keepPlace = () => {
  const place = held
  if (!place) return
  if ('fromFoot' in place) return window.scrollTo({ top: document.documentElement.scrollHeight - place.fromFoot, behavior: 'instant' })
  const top = document.getElementById(place.id)?.getBoundingClientRect().top
  if (top !== undefined) window.scrollTo({ top: window.scrollY + top - place.top, behavior: 'instant' })
}

export const go = (next: Look) => {
  if (next === look) return
  held = placeNow()
  look = next
  keep('look', next.toLowerCase())
  for (const on of listeners) on()
}

/** Opens the page on another first screen; it is the same height as the others, so nothing below it moves. */
export const goHero = (next: HeroLook) => {
  if (next === hero) return
  hero = next
  keep('hero', next.toLowerCase())
  for (const on of listeners) on()
}

/** Draws the Orrery's sun the other way. */
export const goSun = (next: SunLook) => {
  if (next === sun) return
  sun = next
  keep('sun', next.toLowerCase())
  for (const on of listeners) on()
}

const subscribe = (on: () => void) => {
  listeners.add(on)
  return () => void listeners.delete(on)
}

export const useLook = () =>
  useSyncExternalStore(
    subscribe,
    () => look,
    () => look,
  )

export const useHero = () =>
  useSyncExternalStore(
    subscribe,
    () => hero,
    () => hero,
  )

export const useSun = () =>
  useSyncExternalStore(
    subscribe,
    () => sun,
    () => sun,
  )

/** Keys 1 to 6 pick a look, ← and → step through them, H and ⇧H the first screens, S the sun; never while typing, or on a control that takes the arrows itself. */
export const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
  if (event.key === 'h' || event.key === 'H') {
    const at = HEROES.findIndex((one) => one.value === hero)
    const step = event.shiftKey ? HEROES.length - 1 : 1
    event.preventDefault()
    return goHero(HEROES[(at + step) % HEROES.length]!.value)
  }
  if ((event.key === 's' || event.key === 'S') && hero === 'Night') {
    event.preventDefault()
    return goSun(sun === '3D' ? '2.5D' : '3D')
  }
  if (event.shiftKey) return
  if (event.key.startsWith('Arrow') && target?.closest('[role=radiogroup], [role=tablist]')) return
  const at = LOOKS.findIndex((one) => one.value === look)
  const picked =
    event.key === 'ArrowRight'
      ? LOOKS[(at + 1) % LOOKS.length]
      : event.key === 'ArrowLeft'
        ? LOOKS[(at - 1 + LOOKS.length) % LOOKS.length]
        : /^[1-9]$/.test(event.key)
          ? LOOKS[Number(event.key) - 1]
          : undefined
  if (!picked) return
  event.preventDefault()
  go(picked.value)
}
