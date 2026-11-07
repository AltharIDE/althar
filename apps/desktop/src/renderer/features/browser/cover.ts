import { useEffect, useState } from 'react'

/*
 * Whether something of the window's own is over the page beside the
 * conversation (ADR-099). The page is a native view laid over the window,
 * so the window's menus, popovers, cards and dialogs would open under it:
 * while one is over the page's place, the window shows a picture of the
 * page there instead, and the view steps aside. Everything that opens over
 * the window (Radix's popovers, menus, tooltips and dialogs) is put at the
 * end of the document's body, outside the app's own root, so watching the
 * body's children is enough to know.
 */

interface Place {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const meets = (a: DOMRect, b: Place) =>
  a.width > 0 && a.height > 0 && a.left < b.x + b.width && a.right > b.x && a.top < b.y + b.height && a.bottom > b.y

/*
 * What draws over the window: a popover's, menu's or tooltip's content, a
 * dialog, and a dialog's scrim. Not the containers portals leave in the
 * body, which can span the window and draw nothing.
 */
const OVER = '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [data-state="open"]'

/** Whether any of what opens over the window, past its root, is over the place now. */
export const coveredNow = (root: Element | null, place: Place): boolean => {
  for (const child of document.body.children) {
    if (child === root || child.contains(root) || !(child instanceof HTMLElement) || child.hidden) continue
    const drawn = [...(child.matches(OVER) ? [child] : []), ...child.querySelectorAll(OVER)]
    if (drawn.some((one) => meets(one.getBoundingClientRect(), place))) return true
  }
  return false
}

/** Whether something of the window's is over `place`, as the body's children come and go and as what they draw settles. */
export const useCovered = (place: Place | null, root: () => Element | null): boolean => {
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    if (place === null) {
      setCovered(false)
      return
    }
    let frames: Array<number> = []
    const look = () => setCovered(coveredNow(root(), place))
    // What opens is placed a frame or two after it is added: looked at as it is added, and again as it settles.
    const soon = () => {
      for (const frame of frames) cancelAnimationFrame(frame)
      look()
      frames = [requestAnimationFrame(() => (look(), (frames = [requestAnimationFrame(look)])))]
    }
    const watching = new MutationObserver(soon)
    watching.observe(document.body, { childList: true })
    soon()
    return () => {
      watching.disconnect()
      for (const frame of frames) cancelAnimationFrame(frame)
    }
  }, [place, root])
  return covered
}
