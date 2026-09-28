/** Which side of its trigger an overlay opens on. */
export type OverlayPlacement = 'above' | 'below'
/** Which edge of its trigger an overlay lines up with. */
export type OverlayAlign = 'start' | 'end'

/** Radix's name for a placement. */
export const radixSide = (p: OverlayPlacement) => (p === 'above' ? 'top' : 'bottom')
