import type { Box, Picked } from './picked'

/*
 * What the lead and the coordinator do on a page beside their conversation
 * (ADR-100, agents driving pages): the shapes the in-page driver
 * (src/overlay/driver.ts, run in the page's isolated world) answers in, and
 * the main process (drive.ts) asks in. Node-free, so the page's script and
 * the main process share them. Everything the driver returns crosses from a
 * page's document to the main process, so the main process reads each part
 * as untrusted, as it does a picked element (picked.ts).
 */

/** An element the lead names: a reference from its last snapshot (`e12`), or a CSS selector. One of the two. */
export interface Target {
  readonly ref?: string
  readonly selector?: string
}

/** Why the driver couldn't do what it was asked, in words for the lead. */
export interface Failed {
  readonly ok: false
  readonly why: string
}

export interface Done {
  readonly ok: true
}

/** An element found, scrolled into view, with where to press it and how the page draws it. */
export interface Found {
  readonly ok: true
  /** Its reference, the same on every snapshot while the element stays on the page. */
  readonly ref: string
  /** What it is, as the snapshot says: `button`, `link`, `textbox`; `generic` where it has no role. */
  readonly role: string
  /** What it is called to a person using a screen reader. */
  readonly name: string
  /** Its box in the page's CSS pixels from the top left of what shows, after scrolling it into view. */
  readonly rect: Box
  /** Where to press it: the middle of the part of it that shows. */
  readonly at: { readonly x: number; readonly y: number }
  /** How the comment overlay describes it: selector, label, words, size, font and colours (describe.ts). */
  readonly picked: Picked
  /** Another element that would take a press at `at`, as `div.modal`, or null where the element itself would. */
  readonly covered: string | null
  readonly disabled: boolean
  /** A field the lead can type in: an input, a textarea, or a content-editable element. */
  readonly editable: boolean
  /** Whether any part of it shows in the viewport. */
  readonly inView: boolean
}

export type Located = Found | Failed

export interface Snapshot {
  readonly ok: true
  /** The tree as indented lines, `- button "Save" [ref=e12]`. */
  readonly text: string
  /** How many elements it holds. */
  readonly nodes: number
  /** Whether it stopped at the limit, with more of the page unread. */
  readonly truncated: boolean
}

export interface Layout {
  /** The viewport, in CSS pixels. */
  readonly width: number
  readonly height: number
  readonly scrollX: number
  readonly scrollY: number
  /** The whole document. */
  readonly contentWidth: number
  readonly contentHeight: number
}

export type Scrolled =
  | { readonly ok: true; readonly x: number; readonly y: number; readonly atStart: boolean; readonly atEnd: boolean }
  | Failed

export type Filled = { readonly ok: true; readonly value: string } | Failed
export type Chosen = { readonly ok: true; readonly chosen: ReadonlyArray<string> } | Failed
export type Described = { readonly ok: true; readonly picked: Picked } | Failed

/** What `has` looks for on the page: words on it, a selector's element, or a reference's. All the given must hold. */
export interface Query {
  readonly text?: string
  readonly selector?: string
  readonly ref?: string
}

/**
 * The in-page driver, `globalThis.__altharDriver` in the page's isolated
 * world (src/overlay/driver.ts). It reads and prepares; the main process
 * presses, types and scrolls with real input events, so the page sees what
 * it would from a person. Every method is synchronous and returns plain data.
 */
export interface Driver {
  /** The page's accessibility tree with references, all of it or one element's subtree, stopping at `limit` elements. */
  snapshot(scope: Target | null, limit: number): Snapshot | Failed
  /** Finds an element, scrolling it into view when `scroll` is set. */
  locate(target: Target, scroll: boolean): Located
  /** Gives it the page's focus, so keys and inserted text go to it. */
  focus(target: Target): Done | Failed
  /** Selects what a field holds, so text inserted replaces it. */
  selectAll(target: Target): Done | Failed
  /** Sets a field's value as typing would and tells the page (`input`, `change`), for where real typing didn't take. */
  fill(target: Target, text: string, replace: boolean): Filled
  /** What a field holds now, or null where it holds nothing a person types. */
  valueOf(target: Target): string | null
  /** Chooses the options of a `select` by label or value. */
  select(target: Target, values: ReadonlyArray<string>): Chosen
  /** Scrolls the page, or an element: to its top or bottom, a page up or down, or by pixels (positive is down). */
  scroll(target: Target | null, to: 'top' | 'bottom' | 'up' | 'down' | null, by: number | null): Scrolled
  /** Whether what is asked for is on the page now. */
  has(query: Query): boolean
  /** How the comment overlay describes an element. */
  describe(target: Target): Described
  /**
   * How many presses, keys and wheel turns the page has had from a real
   * input device (`isTrusted`), since this document began. The main process
   * counts its own and yields when there are more: that is the person.
   */
  input(): number
  /** The page's viewport and document, in CSS pixels. */
  layout(): Layout
  /** Outlines a box for a moment, for the person to see where the lead is. Nothing in the page changes or hears of it. */
  mark(rect: Box): void
  /** Takes the lead's outlines away at once, so a picture of the page shows the page alone; how many there were. */
  unmark(): number
}

export const isDriving = (value: unknown): value is Driver => typeof value === 'object' && value !== null
