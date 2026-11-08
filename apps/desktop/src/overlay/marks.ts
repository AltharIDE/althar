import type { Box } from '../main/browser/picked'

/*
 * The lead's outline (ADR-100, agents driving pages): a box drawn for a
 * moment round the element it is acting on, so the person sees where. It is
 * drawn into the overlay's closed shadow root, over the page and out of its
 * reach, and never takes the pointer, so the page sees nothing of it. Kept
 * apart from the overlay so it can be tested on any element.
 */

/** How long an outline holds before it fades, how long it fades, and how many show at once. */
export const MARK = { holdMs: 1_000, fadeMs: 400, most: 8 } as const

/** The class an outline has, and the one that fades it: the overlay's style gives both. */
export const MARK_CLASS = 'lead'
export const MARK_FADING = 'fading'

/** Outlines a box in `layer`; `mounted` makes sure the layer is in the page first. */
export const markIn = (layer: Element, mounted: () => void) => {
  return (rect: Box): void => {
    const sides = [rect.x, rect.y, rect.width, rect.height]
    if (!sides.every(Number.isFinite) || rect.width < 1 || rect.height < 1) return
    mounted()
    const outline = document.createElement('div')
    outline.className = MARK_CLASS
    Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    layer.append(outline)
    // The oldest goes when there are too many, so a long run of actions never piles up.
    while (layer.children.length > MARK.most) layer.firstElementChild?.remove()
    setTimeout(() => outline.classList.add(MARK_FADING), MARK.holdMs)
    setTimeout(() => outline.remove(), MARK.holdMs + MARK.fadeMs)
  }
}
