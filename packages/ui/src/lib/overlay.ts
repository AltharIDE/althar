import { createContext } from 'react'

/** Which side of its trigger an overlay opens on. */
export type OverlayPlacement = 'above' | 'below' | 'left' | 'right'
/** Which edge of its trigger an overlay lines up with. */
export type OverlayAlign = 'start' | 'end' | 'center'

/** Radix's name for a placement. */
export const radixSide = (p: OverlayPlacement) => (p === 'above' ? 'top' : p === 'below' ? 'bottom' : p)

/**
 * The box a row or card keeps its popovers and menus within, so one opened from it, though portaled out of it, stays beside it:
 * shifted, and narrowed where it is wider than the box, rather than hanging over what lies beside. Radix keeps to the viewport alone
 * without it.
 */
export const OverlayBoundary = createContext<Element | null>(null)
