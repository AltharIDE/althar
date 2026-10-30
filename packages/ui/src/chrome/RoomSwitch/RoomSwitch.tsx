import { Room } from '../../foundations/vocabulary'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'

/*
 * The project window's only navigation: home (the conversation and the board side
 * by side), the conversation, the board, its automations, or the project's
 * settings in their place. A dot says the conversation has news while you are
 * elsewhere, and a violet one that something waits on you there: an
 * automation that paused itself, or something in the settings, such as a
 * connection to sign in again. What waits on you in the work isn't the
 * board's: the chip beside it says it, whichever view is on. A task has no
 * place here: it takes the window, and its bar goes back with a BackCrumb.
 * In the app the views are a project's header's faces (ProjectHeader), drawn
 * from roomOptions; the switch on its own is for a bar of its own.
 * The shortcuts are the consumer's to bind; the switch names them.
 */

export interface RoomSwitchText {
  label: string
  room: Record<Room, string>
  /** The shortcut, as the tooltip shows it: ⌘1; empty where there is none. */
  key: (n: number) => string
  news: string
  yours: string
}

export const roomSwitchText: RoomSwitchText = {
  label: 'View',
  room: {
    [Room.Both]: 'Home',
    [Room.Talk]: 'Conversation',
    [Room.Board]: 'Board',
    [Room.Automations]: 'Automations',
    [Room.Settings]: 'Settings',
  },
  key: (n) => `⌘${n}`,
  news: 'new messages',
  yours: 'needs you',
}

const ROOMS = [Room.Both, Room.Talk, Room.Board, Room.Automations, Room.Settings] as const

export interface RoomSwitchProps {
  value: Room
  onChange: (room: Room) => void
  /** The conversation has something you haven't seen. */
  news?: boolean
  /** Something in the project's settings waits on you. */
  needsYou?: boolean
  /** One of its automations paused itself, and says why. */
  automationsNeedYou?: boolean
  className?: string
  text?: Partial<RoomSwitchText>
}

export interface RoomOptionsOf {
  news?: boolean
  needsYou?: boolean
  automationsNeedYou?: boolean
  text?: Partial<RoomSwitchText>
}

/** The views as a switch's options, each with its dot: the switch's own, and a project's header's faces (ProjectHeader). */
export function roomOptions({ news, needsYou, automationsNeedYou, text }: RoomOptionsOf = {}): SegmentedOption<Room>[] {
  const t = { ...roomSwitchText, ...text }
  const yours = (room: Room) => (room === Room.Settings && needsYou === true) || (room === Room.Automations && automationsNeedYou === true)
  const dotOf = (room: Room): Pick<SegmentedOption<Room>, 'dot' | 'dotLabel'> =>
    room === Room.Talk && news === true ? { dot: 'new', dotLabel: t.news } : yours(room) ? { dot: 'yours', dotLabel: t.yours } : {}
  return ROOMS.map((room, i) => {
    const key = t.key(i + 1)
    return {
      value: room,
      label: t.room[room],
      // Its name is on it; a tooltip only says its shortcut, where it has one.
      ...(key === '' ? {} : { tooltip: { label: t.room[room], kbd: key } }),
      ...dotOf(room),
    }
  })
}

export function RoomSwitch({ value, onChange, news, needsYou, automationsNeedYou, className, text }: RoomSwitchProps) {
  const t = { ...roomSwitchText, ...text }
  return (
    <Segmented
      label={t.label}
      value={value}
      onChange={onChange}
      className={className}
      options={roomOptions({
        ...(news === undefined ? {} : { news }),
        ...(needsYou === undefined ? {} : { needsYou }),
        ...(automationsNeedYou === undefined ? {} : { automationsNeedYou }),
        ...(text === undefined ? {} : { text }),
      })}
    />
  )
}
