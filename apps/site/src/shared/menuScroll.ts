/*
 * How far the page may move under an open phone menu before the menu
 * closes. A short swipe stays under the card; a real scroll puts it away.
 */

/** Pixels of scroll, either way, that an open menu allows before it closes. */
export const MENU_SCROLL_SLACK = 80

/** Whether the page has left the place where the menu opened, past `slack`. */
export function scrolledAway(openedAt: number, scrollY: number, slack = MENU_SCROLL_SLACK): boolean {
  return Math.abs(scrollY - openedAt) > slack
}
