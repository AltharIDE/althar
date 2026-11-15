/** Which side of its trigger an overlay opens on. */
export type OverlayPlacement = 'above' | 'below' | 'left' | 'right'
/** Which edge of its trigger an overlay lines up with. */
export type OverlayAlign = 'start' | 'end' | 'center'

/** Radix's name for a placement. */
export const radixSide = (p: OverlayPlacement) => (p === 'above' ? 'top' : p === 'below' ? 'bottom' : p)
