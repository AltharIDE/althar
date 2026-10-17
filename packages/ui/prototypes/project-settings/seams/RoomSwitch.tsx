// Scrappy: the project's views in the window's bar. Today's: Conversation, Board, Both. A to D: Home (what Both was), Conversation, Board, then Settings.
import { RoomSwitch as Real, Room, type RoomSwitchProps, Segmented } from '../../../src/index'
import { useThings } from '../parts'
import { proto, useProto } from '../state'

type View = Room | 'settings'

export function RoomSwitch(props: RoomSwitchProps) {
  const p = useProto()
  const things = useThings()
  if (p.direction === 'Today') return <Real {...props} />
  const value: View = p.showing === 'open' ? 'settings' : props.value
  return (
    <Segmented<View>
      label="View"
      value={value}
      onChange={(view) => {
        // D opens on its overview; the others on General.
        if (view === 'settings') return proto.set({ showing: 'open', section: p.direction === 'D' ? null : 'general' })
        proto.set({ showing: 'closed' })
        props.onChange(view)
      }}
      options={[
        { value: Room.Both, label: 'Home' },
        { value: Room.Talk, label: 'Conversation', ...(props.news === true ? { dot: 'new' as const, dotLabel: 'new messages' } : {}) },
        { value: Room.Board, label: 'Board' },
        // A connection that needs the person says so on Settings, as a section of the app's Settings does.
        { value: 'settings', label: 'Settings', ...(things.troubles > 0 ? { dot: 'yours' as const, dotLabel: 'needs you' } : {}) },
      ]}
    />
  )
}
