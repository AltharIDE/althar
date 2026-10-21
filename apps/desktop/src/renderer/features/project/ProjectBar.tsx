import { Room, RoomSwitch } from '@althar/ui'

import { BarEnd } from '../tabs/TabsFrame'

/*
 * A project's end of the window's bar, beside the tabs: its views, its
 * automations, its settings the last of them, and nothing else. What needs
 * the person in its work is on its front page under the bar; an automation
 * that paused itself is a dot on Automations, a connection that needs them a
 * dot on Settings. Tasks start from the conversation, never from a button. The
 * views have no shortcut of their own: ⌘ and a number belongs to the tabs,
 * and b steps through the views of its work.
 */

export function ProjectBar({
  room,
  onRoom,
  settingsNeedYou,
  automationsNeedYou = false,
}: {
  /** The project's view, which the bar starts with. */
  room: Room
  onRoom: (room: Room) => void
  /** Something in its settings waits on the person, such as a connection to sign in again. */
  settingsNeedYou: boolean
  /** One of its automations paused itself, and says why. */
  automationsNeedYou?: boolean
}) {
  return (
    <BarEnd>
      <RoomSwitch
        value={room}
        onChange={onRoom}
        needsYou={settingsNeedYou}
        automationsNeedYou={automationsNeedYou}
        text={{ key: () => '' }}
      />
    </BarEnd>
  )
}

/** The views of its work, in the order b steps through them; from its automations or its settings, b goes to the first. */
export const ROOMS: readonly Room[] = [Room.Talk, Room.Board, Room.Both]

/** The view after this one, round the end. */
export const nextRoom = (room: Room): Room => ROOMS[(ROOMS.indexOf(room) + 1) % ROOMS.length] ?? Room.Talk
