import { Room } from '../../foundations/vocabulary'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'

/*
 * The project window's only navigation: the conversation, the board, or
 * both side by side. A dot says the conversation has news while you are on
 * the board, and a violet one that something on the board waits on you.
 * While one of the project's tasks has the window, none of them is on, and
 * choosing one goes back to the project in it. The task last opened can sit
 * after them, by its title, as the way back to it, on while it has the
 * window. The shortcuts are the consumer's to bind; the switch names them.
 */

export interface RoomSwitchText {
  label: string
  room: Record<Room, string>
  /** The shortcut, as the tooltip shows it: ⌘1; empty where there is none. */
  key: (n: number) => string
  news: string
  yours: (n: number) => string
}

export const roomSwitchText: RoomSwitchText = {
  label: 'View',
  room: { [Room.Talk]: 'Conversation', [Room.Board]: 'Board', [Room.Both]: 'Both' },
  key: (n) => `⌘${n}`,
  news: 'new messages',
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
}

const ROOMS = [Room.Talk, Room.Board, Room.Both] as const

/* news on the conversation; calls waiting on the board */
function dotOf(room: Room, news: boolean | undefined, yours: number): 'new' | 'yours' | undefined {
  if (room === Room.Talk && news) return 'new'
  if (room === Room.Board && yours > 0) return 'yours'
  return undefined
}

function dotLabelOf(dot: 'new' | 'yours' | undefined, yours: number, t: RoomSwitchText): string | undefined {
  if (dot === 'new') return t.news
  if (dot === 'yours') return t.yours(yours)
  return undefined
}

/** The task last opened, as the switch's last choice. */
export const TASK = 'task'

/** A title cut to what a choice holds, and whether it was. */
const shortOf = (title: string, most = 28) =>
  title.length <= most ? { label: title, cut: false } : { label: `${title.slice(0, most - 1).trimEnd()}…`, cut: true }

export interface RoomSwitchProps {
  /** The view on, or the task when it has the window; null while another task of the project has it. */
  value: Room | typeof TASK | null
  onChange: (room: Room) => void
  /** The project's task last opened: its title, and going back to it. */
  task?: { readonly title: string; readonly onOpen: () => void }
  /** The conversation has something you haven't seen. */
  news?: boolean
  /** How many calls on the board wait on you. */
  yours?: number
  className?: string
  text?: Partial<RoomSwitchText>
}

export function RoomSwitch({ value, onChange, task, news, yours = 0, className, text }: RoomSwitchProps) {
  const t = { ...roomSwitchText, ...text }
  const views: SegmentedOption<Room | typeof TASK>[] = ROOMS.map((room, i) => {
    const dot = dotOf(room, news, yours)
    return {
      value: room,
      label: t.room[room],
      tooltip: { label: t.room[room], ...(t.key(i + 1) === '' ? {} : { kbd: t.key(i + 1) }) },
      dot,
      dotLabel: dotLabelOf(dot, yours, t),
    }
  })
  const short = task === undefined ? null : shortOf(task.title)
  const last: SegmentedOption<Room | typeof TASK>[] =
    task === undefined || short === null
      ? []
      : [{ value: TASK, label: short.label, ...(short.cut ? { tooltip: { label: task.title } } : {}) }]
  return (
    <Segmented
      label={t.label}
      value={value === TASK && task === undefined ? null : value}
      onChange={(chosen) => (chosen === TASK ? task?.onOpen() : onChange(chosen))}
      className={className}
      options={[...views, ...last]}
    />
  )
}
