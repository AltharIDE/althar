import { createContext, useContext } from 'react'

/*
 * Althar has no dark theme yet. The stories stage each direction on a dark
 * stand-in (Stage's `dark`), which maps the tokens on its own box; a card or
 * popover is portalled out of that box, so it takes the same class from
 * here. A real theme would set its tokens on the root and reach portals by
 * itself, and this would go.
 */
export const OverlayScheme = createContext<string | undefined>(undefined)

/** The class an overlay adds to be in its stage's scheme, if any. */
export const useOverlayScheme = () => useContext(OverlayScheme)
