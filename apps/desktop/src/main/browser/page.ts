import type { Refusal, SignInService } from './addresses'
import type { Viewport } from './devices'
import type { Asked } from './guards'
import type { Box, Picked } from './picked'

/*
 * A page beside a conversation as the window sees it (ADR-100): what the
 * main process tells it of the page, and what pointing at it hands back.
 * Node-free, so the window and the preload share it.
 */

/** The one quiet line under the page's bar, where something was refused, sent out, asked for or went wrong. */
export type PageLine =
  /** An address that isn't a web page, typed, linked to or redirected to: the page stays where it was. */
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  /** A sign-in to one of Althar's services, opened in the person's browser instead. */
  | { readonly kind: 'sign-in'; readonly service: SignInService }
  /** A permission the page asked for, which pages here never get. */
  | { readonly kind: 'asked'; readonly asked: Asked; readonly host: string }
  /** A download, never kept here: offered to the person's browser where it has a web address. */
  | { readonly kind: 'download'; readonly name: string; readonly offered: boolean }
  /** The address didn't answer: a run that stopped, a host that isn't there. */
  | { readonly kind: 'failed'; readonly host: string }
  /** The page's process stopped. */
  | { readonly kind: 'gone' }

export interface PageState {
  /** The task or project whose conversation the page is beside. */
  readonly owner: string
  /** What it shows now; empty before anything loaded. */
  readonly address: string
  readonly title: string
  readonly loading: boolean
  readonly back: boolean
  readonly forward: boolean
  readonly viewport: Viewport
  /** The person is pointing at it, to comment. */
  readonly pointing: boolean
  readonly line: PageLine | null
  /** The lead (or the coordinator, beside its conversation) is acting on it now, or did a moment ago. */
  readonly working: boolean
}

/** An element pointed at, or found again, with what the window draws the comment over. */
export interface Pointed {
  readonly picked: Picked
  /** The element and a margin round it, as a PNG's data address; null where none of it shows. */
  readonly crop: string | null
  readonly cropSize: { readonly width: number; readonly height: number } | null
  /** The page as it is, as a picture the window shows in its place while the comment is written. */
  readonly still: string
  /** How much smaller than its size the page is drawn: 1 at the panel's own size. */
  readonly scale: number
  /** Where the element is in that picture, in the window's pixels from the picture's top left. */
  readonly at: Box
  /** The page's address and the size it was at. */
  readonly address: string
  readonly viewport: Viewport
}

/** A comment's pin on the page it was made on. */
export interface PagePin {
  readonly n: number
  readonly selector: string
  readonly address: string
}

/** What the person pressed in the page that the window acts on: Comment, the address field. */
export type PageKey = 'comment' | 'address'

/** Where a page is told to go: back, forward, again, or stop loading. */
export type PageMove = 'back' | 'forward' | 'reload' | 'stop'

export const isPageMove = (value: unknown): value is PageMove =>
  value === 'back' || value === 'forward' || value === 'reload' || value === 'stop'
