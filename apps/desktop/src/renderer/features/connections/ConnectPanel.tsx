import type { Service } from '@althar/contracts'
import { SidePanel, SidePanelBody, SidePanelTitle } from '@althar/ui'

import { ConnectFlow, text } from './ConnectFlow'
import s from './Connections.module.css'
import { useConnect } from './useConnect'
import { serviceName } from './ways'

/*
 * Connecting one service beside what needs it: a project's conversation, a
 * task's outputs. The walk is the same card Settings shows, in a side
 * panel; its way back steps back a step, as Escape does, and Escape at the
 * start closes it.
 */

export interface ConnectPanelProps {
  service: Service
  /** A connection to sign in again. */
  again?: string
  onClose: () => void
}

export function ConnectPanel({ service, again, onClose }: ConnectPanelProps) {
  const flow = useConnect({ service, again: again ?? null, onClose })
  const title = again === undefined ? text.connect(serviceName(service)) : text.again(serviceName(service))
  return (
    <SidePanel
      label={title}
      head={<SidePanelTitle>{title}</SidePanelTitle>}
      {...(flow.way === null ? {} : { onBack: () => void (flow.back() || onClose()) })}
      onClose={onClose}
      onKeyDown={(event) => {
        // Escape steps back a step before it closes the panel.
        if (event.key === 'Escape' && !event.defaultPrevented && flow.back()) event.preventDefault()
      }}
    >
      <SidePanelBody className={s.sideBody}>
        <div className={s.side}>
          <ConnectFlow model={flow} compact />
        </div>
      </SidePanelBody>
    </SidePanel>
  )
}
