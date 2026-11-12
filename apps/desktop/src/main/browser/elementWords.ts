import type { Picked } from './picked'

/*
 * An element in words (ADR-100): how a comment says what it is on, and how
 * the lead reads the element it clicked, so both read the same. Pure and
 * Node-free, so the window's comments and the main process share them.
 */

/** A width and a height as a person says a size: `320 × 120`. */
export const sized = (width: number, height: number): string => `${width} × ${height}`

/** An element's size as its box says it. */
export const sizeLine = (picked: Picked): string => sized(picked.rect.width, picked.rect.height)

/** What something is on: the element at a glance, its words where it has any, and a size, ``On `span.needs` (“x64”), 80 × 24``. */
export const onLine = (label: string, words: string, size: string): string =>
  `On \`${label}\`${words === '' ? '' : ` (“${words}”)`}, ${size}`

/** The element a comment, or a click, is on: ``On `span.needs` (“x64”), 80 × 24``. */
export const elementLine = (picked: Picked): string => onLine(picked.label, picked.text, sizeLine(picked))

/** The selector that finds it again, ``Selector: `span.needs` ``. */
export const selectorLine = (selector: string): string => `Selector: \`${selector}\``
