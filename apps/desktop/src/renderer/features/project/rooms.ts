import { type Pane, Room } from '@althar/ui'

/*
 * A project's home: the conversation with its coordinator, the board of its
 * work, or both side by side, as its panes' toggles say (the kit's
 * PaneToggles, at the end of its header); c and b toggle them. One always
 * shows: the toggle of the only pane showing does nothing. Both always fit:
 * the window is never narrower than the narrowest conversation beside the
 * least of the board. From its automations, artifacts or settings, a toggle
 * goes back home with its pane showing. The home's layout is a view
 * (Room.Both, Talk or Board), kept per project as the view it was last on;
 * the views have no shortcut of their own: ⌘ and a number belongs to the
 * window's tabs.
 */

/** The home, as it is laid out: both panes, or one alone. */
export type HomeRoom = Room.Both | Room.Talk | Room.Board

export const isHome = (room: Room): room is HomeRoom => room === Room.Both || room === Room.Talk || room === Room.Board

const alone: Record<Pane, HomeRoom> = { talk: Room.Talk, board: Room.Board }
const otherOf = (pane: Pane): Pane => (pane === 'talk' ? 'board' : 'talk')

/** Which panes show on a view: none away from the home. */
export const shownOf = (room: Room): Readonly<Record<Pane, boolean>> => ({
  talk: room === Room.Both || room === Room.Talk,
  board: room === Room.Both || room === Room.Board,
})

/**
 * The view after a pane's toggle: hidden where the other shows, shown beside it where it doesn't; the only pane showing
 * stays. Away from the home, back to its layout (`home`), the pane showing.
 */
export const toggled = (room: Room, home: HomeRoom, pane: Pane): HomeRoom => {
  if (!isHome(room)) return shownOf(home)[pane] ? home : Room.Both
  const shown = shownOf(room)
  if (!shown[pane]) return Room.Both
  return shown[otherOf(pane)] ? alone[otherOf(pane)] : room
}
