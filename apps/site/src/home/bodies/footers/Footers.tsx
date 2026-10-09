import { Engraving } from './Engraving'
import { Lens } from './Lens'
import { Print } from './Print'
import { TouchLight } from './TouchLight'

/*
 * The page's last word, four ways, while one is picked: ?footer= engraving
 * (the default), print, light or lens. Each says the same three lines and
 * carries the same links.
 */

export const STATEMENT = ['The most beautiful', 'IDE ever built', 'at your fingertips'] as const

export const FOOTERS = { engraving: Engraving, print: Print, light: TouchLight, lens: Lens } as const
export type FooterName = keyof typeof FOOTERS

const pick = (): FooterName => {
  const asked = new URLSearchParams(window.location.search).get('footer')
  return asked && asked in FOOTERS ? (asked as FooterName) : 'engraving'
}

export function Footer() {
  const Chosen = FOOTERS[pick()]
  return <Chosen />
}
