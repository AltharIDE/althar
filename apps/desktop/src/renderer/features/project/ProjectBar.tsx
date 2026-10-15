import { Room, RoomSwitch } from '@althar/ui'

import { BarEnd } from '../tabs/TabsFrame'

/*
 * A project's end of the window's bar, beside the tabs: its views, and
 * nothing else. What needs the person, and the project's settings, are on
 * its front page under the bar. Tasks start from the conversation, never
 * from a button. The views have no shortcut of their own: ⌘ and a number
 * belongs to the tabs, and b steps through the views.
 */

export function ProjectBar({
  room,
  onRoom,
}: {
  /** The project's view, which the bar starts with. */
  room: Room
  onRoom: (room: Room) => void
}) {
  return (
    <BarEnd>
      <RoomSwitch value={room} onChange={onRoom} text={{ key: () => '' }} />
    </BarEnd>
  )
}

/** The views in the order b steps through them. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
