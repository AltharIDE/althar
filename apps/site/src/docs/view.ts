import { createContext, type MouseEvent, useContext } from 'react'

/*
 * Which direction the docs are drawn in, and which of their two screens:
 * the docs' home, or the one page written out. Both are in the address
 * (`?v=b&p=home`), so a direction can be linked to.
 */

export const DIRECTIONS = [
  { id: 'a', name: 'Reading', note: 'The thesis’s sheet: contents beside one column' },
  { id: 'b', name: 'Side by side', note: 'Words on the left, the app on a stage that follows them' },
  { id: 'c', name: 'Story', note: 'One idea a screen, as the homepage tells it' },
  { id: 'd', name: 'Questions', note: 'Asked the way someone new would, answered first' },
] as const

export type Direction = (typeof DIRECTIONS)[number]['id']
export type Screen = 'home' | 'page'

export interface View {
  v: Direction
  p: Screen
}

export const FIRST: View = { v: 'a', p: 'page' }

export const viewOf = (search: string): View => {
  const q = new URLSearchParams(search)
  const v = DIRECTIONS.find((d) => d.id === q.get('v'))?.id ?? FIRST.v
  const p = q.get('p') === 'home' ? 'home' : 'page'
  return { v, p }
}

export const hrefOf = (view: View) => `/docs?v=${view.v}&p=${view.p}`

const MOVED = 'docs:moved'

/** Follow the address as the switcher, a link or the browser's back button changes it. */
export const onMove = (on: () => void) => {
  window.addEventListener(MOVED, on)
  window.addEventListener('popstate', on)
  return () => {
    window.removeEventListener(MOVED, on)
    window.removeEventListener('popstate', on)
  }
}

/** Show another view, in place: the address changes, the page doesn't reload. */
export const move = (view: View) => {
  window.history.replaceState(null, '', hrefOf(view))
  window.dispatchEvent(new Event(MOVED))
}

interface Docs extends View {
  go: (to: Partial<View>) => void
}

export const DocsView = createContext<Docs>({ ...FIRST, go: () => {} })

/** The view, and a link to another screen of the same direction that changes it in place. */
export function useDocs() {
  const docs = useContext(DocsView)
  const link = (p: Screen) => ({
    href: hrefOf({ v: docs.v, p }),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      docs.go({ p })
    },
  })
  /** A page that isn't written yet: it goes to the docs' home, and says why. */
  const unwritten = { ...link('home'), title: 'Not written yet: this goes to the docs’ home' }
  return { ...docs, link, unwritten }
}
