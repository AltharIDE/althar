import { SidePanel, SidePanelBody, SidePanelTitle } from '@althar/ui'

import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import { useConnections } from '../connections/useConnections'

/** The code hosts and trackers, beside a task's outputs, for connecting the one its pull request would be on: as the project's menu opens them. */
export function ConnectPanel({ onClose }: { onClose: () => void }) {
  return (
    <SidePanel label={connectionsText.label} head={<SidePanelTitle>{connectionsText.label}</SidePanelTitle>} onClose={onClose}>
      <SidePanelBody>
        <ConnectionsView model={useConnections()} />
      </SidePanelBody>
    </SidePanel>
  )
}
