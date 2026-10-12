import { useEffect, useRef, useState } from 'react'

import type { ConnectionList, Product } from '@althar/contracts'
import { Button, Dialog, dialogText } from '@althar/ui'

import { hostnameOf } from '../../shared/remotes'
import { ConnectFlow } from './ConnectFlow'
import { type Connecting, ConnectionsView, text as connectionsText } from './ConnectionsView'
import s from './Connections.module.css'
import { type ConnectModel, useConnect } from './useConnect'
import type { ConnectionsModel } from './useConnections'
import { serviceName, serviceOfProduct } from './ways'

/*
 * Connecting over a project's view, its settings, its repositories or a new
 * project: a dialog. Opened on one service, it is that service's walk in, at
 * a sign-in card's width, a step at a time, and it closes as the walk ends.
 * Opened on all of them, it is the code hosts and trackers in two columns,
 * as Settings shows them, and Connect on one walks in to it in their place,
 * coming back to them as the walk ends. The walk's way back, before the
 * title, steps it back, as Escape does; at its start it goes back to the
 * list, and opened on one service, Escape there closes it. While a walk is
 * open, a press outside leaves it open.
 */

export const text = { done: 'Done', backToList: connectionsText.backToList }

/** How wide it is: the code hosts beside the trackers, or a walk in, as a sign-in card. */
const WIDTH = { all: 720, walk: 480 } as const

/** What Connect opens on: the walk in to one service, or all of them. */
export type Opening = Connecting | 'all'

/**
 * What Connect opens on for a product on a server, by its host name (the
 * hosted service's where it is null): its connection's sign-in again, where
 * that is all it needs; the service's walk in, where it isn't connected;
 * and all of them, where it is, to see it or let it go.
 */
export const openingFor = (list: ConnectionList | null, product: Product, at: string | null): Opening => {
  const hosted = list?.products.find((option) => option.product === product)?.hostedUrl ?? null
  const host = at ?? (hosted === null ? null : hostnameOf(hosted))
  const there = (list?.connections ?? []).filter(
    (connection) => connection.product === product && (host === null || hostnameOf(connection.webUrl) === host),
  )
  if (there.some((connection) => connection.state === 'ready')) return 'all'
  const service = serviceOfProduct(product)
  const [out] = there
  return out === undefined ? { service } : { service, again: out.id }
}

export interface ConnectDialogProps {
  model: ConnectionsModel
  opening: Opening
  onClose: () => void
}

export function ConnectDialog({ model, opening, onClose }: ConnectDialogProps) {
  const listed = opening === 'all'
  const [walk, setWalk] = useState<Connecting | null>(listed ? null : opening)
  // Each walk opened starts afresh.
  const [walks, setWalks] = useState(0)
  // The walk as it stands, for its way back; and whether it is a step in, past its ways.
  const flow = useRef<ConnectModel | null>(null)
  const [stepped, setStepped] = useState(false)
  const toList = () => {
    setWalk(null)
    setStepped(false)
  }
  const ended = listed ? toList : onClose
  // A step in, the way back steps the walk back; at its ways, it goes back to all of them, where it came from there.
  const backs = stepped || (walk !== null && listed)
  const back = () => {
    if (!stepped) toList()
    else if (flow.current?.back() !== true) ended()
  }

  // One dialog throughout, so focus goes back to what opened it, whichever it shows as it closes.
  return (
    <Dialog
      title={walk === null ? connectionsText.label : serviceName(walk.service)}
      width={walk === null ? WIDTH.all : WIDTH.walk}
      className={s.dialog}
      onClose={onClose}
      {...(backs ? { onBack: back } : {})}
      holding={walk !== null}
      {...(walk === null ? { actions: <Button onClick={onClose}>{text.done}</Button> } : {})}
      text={{ back: stepped ? dialogText.back : text.backToList }}
    >
      {walk === null ? (
        <ConnectionsView
          model={model}
          columns
          onConnect={(next) => {
            setWalk(next)
            setWalks((n) => n + 1)
          }}
        />
      ) : (
        <Walk
          key={walks}
          connecting={walk}
          onEnd={ended}
          onFlow={(model) => {
            flow.current = model
            setStepped(model.way !== null)
          }}
        />
      )}
    </Dialog>
  )
}

/** A walk in, as the card the dialog holds. */
function Walk({
  connecting,
  onEnd,
  onFlow,
}: {
  connecting: Connecting
  /** It ended: connected, or stepped back from its start. */
  onEnd: () => void
  /** The walk as it stands, for the dialog's way back. */
  onFlow: (model: ConnectModel) => void
}) {
  const model = useConnect({ ...connecting, onClose: onEnd })
  useEffect(() => onFlow(model))
  return <ConnectFlow model={model} />
}
