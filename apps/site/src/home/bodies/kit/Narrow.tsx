import { useMedia } from '../../../lib/browser'

/** Whether the page is at most `px` wide: by default a phone's width, where pictures lay themselves out for it. */
export const useNarrow = (px = 699) => useMedia(`(max-width: ${px}px)`)
