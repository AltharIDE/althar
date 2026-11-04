import { useSyncExternalStore } from 'react'

/*
 * Prototype: which look the homepage's sections wear, A to F or as they are
 * today. The address keeps it (?look=b), so a link opens it again; keys 1 to
 * 7 pick one, ← and → step through them. Swapping keeps the section you are
 * reading where it was on the screen.
 */

export type Look = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'Today'

export const LOOKS: ReadonlyArray<{ value: Look; name: string }> = [
  { value: 'A', name: 'Night descent' },
  { value: 'B', name: 'Engraved plates' },
  { value: 'C', name: 'Ruled paper' },
  { value: 'D', name: 'Above the clouds' },
  { value: 'E', name: 'Horizon' },
  { value: 'F', name: 'Cyanotype' },
  { value: 'Today', name: 'Today' },
]

const lookOf = (word: string | null): Look | undefined => LOOKS.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value

let look: Look = lookOf(new URLSearchParams(window.location.search).get('look')) ?? 'A'
const listeners = new Set<() => void>()

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
  const params = new URLSearchParams(window.location.search)
  params.set('look', next.toLowerCase())
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
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

/** Keys 1 to 7 pick a look, ← and → step through them; never while typing, or on a control that takes the arrows itself. */
export const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
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
