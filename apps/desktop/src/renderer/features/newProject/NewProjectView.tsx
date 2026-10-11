import { useState } from 'react'

import { NewProject } from '@althar/ui/screens'

import { device, platform } from '../../shared/device'
import { codeHostOf } from '../../shared/remotes'
import { ConnectDialog, type Opening, openingFor } from '../connections/ConnectDialog'
import type { ConnectionsModel } from '../connections/useConnections'
import s from './NewProject.module.css'
import type { NewProjectModel } from './useNewProject'

/*
 * A new project's tab: the kit's NewProject, the project as it takes shape,
 * named first and then given its folders. Connect, for a code host it
 * isn't connected to, opens that host's walk in over it, as a project's
 * settings do. Made, the tab becomes the project's own; closed, or left
 * with Escape, nothing is made.
 */

export const text = {
  /** The kit's words, with this computer's name and keys. */
  page: () => ({
    found: `On ${device.this}`,
    foundLike: (name: string) => `On ${device.this}, named like ${name}`,
    more: (count: number) => `${count} more on ${device.this}`,
    createKbd: platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter',
  }),
}

export function NewProjectView({
  model,
  connections,
  onCreated,
  onClose,
}: {
  model: NewProjectModel
  connections: ConnectionsModel
  /** It was made: its tab opens on it. */
  onCreated: (projectId: string) => void
  /** Escape: nothing is made, and the tab closes. */
  onClose: () => void
}) {
  const [connecting, setConnecting] = useState<Opening | null>(null)
  const { draft } = model
  if (draft === null) return null
  return (
    <div className={s.window}>
      <NewProject
        seed={draft.id}
        name={draft.name}
        onNameChange={model.rename}
        ink={model.ink}
        onInkChange={model.colour}
        taken={model.taken}
        folders={model.folders}
        onRemove={model.leaveOut}
        onChoose={() => void model.choose()}
        onDrop={(files) => void model.drop(files)}
        found={model.found}
        onAdd={(id) => void model.add(id)}
        findings={model.findings}
        onConnect={(host) => {
          // A finding is by its host's name, which the connections say the code host of.
          const product = codeHostOf({ host, path: '' }, connections.list).product
          setConnecting(product === null ? 'all' : openingFor(connections.list, product, host))
        }}
        onCreate={() =>
          void model.create().then((made) => {
            if (made !== null) onCreated(made.id)
          })
        }
        onCancel={onClose}
        creating={draft.creating}
        {...(draft.error === null ? {} : { error: draft.error })}
        text={text.page()}
      />
      {connecting !== null && <ConnectDialog model={connections} opening={connecting} onClose={() => setConnecting(null)} />}
    </div>
  )
}
