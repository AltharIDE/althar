import { Button, Dialog } from '@althar/ui'

import { ConnectionsView, text as connectionsText } from './ConnectionsView'
import s from './Connections.module.css'
import type { ConnectionsModel } from './useConnections'

/*
 * The code hosts and trackers, opened over a project's view or its
 * repositories to connect the host its work goes to: the services' two
 * columns, as settings shows them, with room to sign one in.
 */

export const text = { done: 'Done' }

export function ConnectDialog({ model, onClose }: { model: ConnectionsModel; onClose: () => void }) {
  return (
    <Dialog
      title={connectionsText.label}
      width={720}
      className={s.dialog}
      onClose={onClose}
      actions={<Button onClick={onClose}>{text.done}</Button>}
    >
      <ConnectionsView model={model} columns />
    </Dialog>
  )
}
