import { useEffect } from 'react'

import { BackCrumb, Heading, Runtimes, TitleBar } from '@althar/ui'

import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import type { ConnectionsModel } from '../connections/useConnections'
import { runtimesOf, StartError } from '../start/StartView'
import type { StartModel } from '../start/useStart'
import s from './Settings.module.css'

/*
 * Settings: the agents on this Mac, each with its accounts, and the code
 * hosts and trackers Althar is connected to. The home's bar shows the
 * agents' marks and says when one needs something; this is where it gets it.
 */

export const text = {
  title: 'Settings',
  back: 'Home',
  agents: 'Agents on this Mac',
  connecting: 'Looking at the agents on this Mac…',
}

export function SettingsView({ model, connections, onBack }: { model: StartModel; connections: ConnectionsModel; onBack: () => void }) {
  // Escape goes back home, as the crumb does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === document.body) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={s.window}>
      <TitleBar>
        <BackCrumb to={text.back} title={text.title} onBack={onBack} />
      </TitleBar>
      <main className={s.scroll}>
        <div className={s.page}>
          <StartError model={model} />
          <section aria-labelledby="agents" className={s.section}>
            <Heading level={2} id="agents">
              {text.agents}
            </Heading>
            {model.status === null ? (
              <p className={s.quiet}>{text.connecting}</p>
            ) : (
              <Runtimes label={text.agents} runtimes={runtimesOf(model)} />
            )}
          </section>
          <section aria-labelledby="connections" className={s.section}>
            <Heading level={2} id="connections">
              {connectionsText.label}
            </Heading>
            <ConnectionsView model={connections} />
          </section>
        </div>
      </main>
    </div>
  )
}
