// Scrappy: the project's views. In C its settings are one of them, after the board; elsewhere the app's own bar.
import { useEffect } from 'react'

import { nextRoom, ProjectBar as RealProjectBar, ROOMS } from '../../../../../../apps/desktop/src/renderer/features/project/ProjectBar'
import { BarEnd } from '../../../../../../apps/desktop/src/renderer/features/tabs/TabsFrame'
import { Room } from '../../../foundations/vocabulary'
import { roomSwitchText } from '../../../chrome/RoomSwitch/RoomSwitch'
import { Segmented } from '../../../primitives/Segmented/Segmented'
import { proto, useProto } from '../state'

export { nextRoom, ROOMS }

type View = Room | 'settings'

export function ProjectBar({ room, onRoom }: { room: Room; onRoom: (room: Room) => void }) {
  const { direction, settingsView } = useProto()
  // A project opens on its conversation or board, never on its settings.
  useEffect(() => () => proto.set({ settingsView: false }), [])
  if (direction !== 'C') return <RealProjectBar room={room} onRoom={onRoom} />
  const views: View[] = [...ROOMS, 'settings']
  return (
    <BarEnd>
      <Segmented<View>
        label={roomSwitchText.label}
        value={settingsView ? 'settings' : room}
        onChange={(view) => {
          if (view === 'settings') return proto.set({ settingsView: true })
          proto.set({ settingsView: false })
          onRoom(view)
        }}
        options={views.map((view) => ({ value: view, label: view === 'settings' ? 'Settings' : roomSwitchText.room[view] }))}
      />
    </BarEnd>
  )
}
