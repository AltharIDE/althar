import type { Picked } from '../main/browser/picked'
import { labelOf, selectorOf } from './selector'

/*
 * An element as the lead reads it from a comment, and as the comment's card
 * shows it: a selector that finds it again, its words, where it is, and how
 * the page drew it (its font, its colour and the colour behind it), read in
 * the page's isolated world, where the page's own scripts can't change what
 * these functions do.
 */

const LONGEST = 300

/** Its words as one line, cut short: each run of text apart, as the page lays them out apart; else what it is called. */
export const textOf = (element: Element): string => {
  const document = element.ownerDocument
  const walker = document.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  const pieces: Array<string> = []
  let length = 0
  for (let node = walker.nextNode(); node !== null && length <= LONGEST; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent !== null && (parent.localName === 'script' || parent.localName === 'style' || parent.localName === 'noscript')) continue
    const piece = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (piece === '') continue
    pieces.push(piece)
    length += piece.length + 1
  }
  const words =
    pieces.join(' ') ||
    element.getAttribute('aria-label') ||
    element.getAttribute('alt') ||
    element.getAttribute('title') ||
    element.getAttribute('placeholder') ||
    ''
  const line = words.replace(/\s+/g, ' ').trim()
  return line.length > LONGEST ? `${line.slice(0, LONGEST - 1)}…` : line
}

const two = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')

/** A computed colour as `#rrggbb`, with its alpha where it is see-through; any other form (`oklch(…)`) as it is. */
export const hexOf = (colour: string): string => {
  const found = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(colour.trim())
  if (found === null) return colour.trim()
  const [, r, g, b, a] = found
  const alpha = a === undefined ? 1 : a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a)
  return `#${two(Number(r))}${two(Number(g))}${two(Number(b))}${alpha < 1 ? two(alpha * 255) : ''}`
}

const clear = (colour: string) => {
  const trimmed = colour.replace(/\s/g, '')
  return trimmed === 'transparent' || /^rgba\(\d+,\d+,\d+,0\)$/.test(trimmed) || trimmed.endsWith('/0)')
}

/** The colour behind it: its own background, or the first of its ancestors' that isn't clear; white where none is set. */
export const backgroundOf = (element: Element, style: (element: Element) => CSSStyleDeclaration): string => {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    const colour = style(at).backgroundColor
    if (colour !== '' && !clear(colour)) return hexOf(colour)
  }
  return '#ffffff'
}

/** Its font as the card says it: size, weight and its first family, `12px · 400 · Inter Variable`. */
export const fontOf = (style: CSSStyleDeclaration): string => {
  const family = (style.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
  return [style.fontSize, style.fontWeight, family].filter((part) => part !== '').join(' · ')
}

/** Everything a comment carries of the element, as the main process checks it (picked.ts). */
export const describe = (element: Element, view: Window): Picked => {
  const style = (at: Element) => view.getComputedStyle(at)
  const own = style(element)
  const box = element.getBoundingClientRect()
  return {
    selector: selectorOf(element),
    label: labelOf(element),
    text: textOf(element),
    rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    font: fontOf(own),
    colour: hexOf(own.color),
    background: backgroundOf(element, style),
    page: { width: view.innerWidth, height: view.innerHeight },
  }
}
