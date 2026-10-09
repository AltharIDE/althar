import { useEffect } from 'react'

import { BackCrumb, Choices, Heading, Runtimes, TitleBar } from '@althar/ui'

import { ConnectionsView, text as connectionsText } from '../connections/ConnectionsView'
import type { ConnectionsModel } from '../connections/useConnections'
import { appIcons } from '../../shared/appIcons'
import { edgePlaces } from '../../shared/edge'
import { runtimesOf, StartError } from '../start/StartView'
import type { StartModel } from '../start/useStart'
import s from './Settings.module.css'
import type { AppIconModel } from './useAppIcon'
import type { EdgePlaceModel } from './useEdgePlace'

/*
 * Settings: the agents on this Mac, each with its accounts, the code hosts
 * and trackers Althar is connected to, the app's icon, and, on a Mac with a
 * notch, where Althar shows while you're in another app. The home's bar
 * shows the agents' marks and says when one needs something; this is where
 * it gets it.
 */

export const text = {
  title: 'Settings',
  back: 'Home',
  agents: 'Agents on this Mac',
  connecting: 'Looking at the agents on this Mac…',
  icon: 'App icon',
  iconNote: 'Shown in the Dock while Althar is open.',
  iconFailed: 'That icon couldn’t be kept. Try again.',
  edge: 'While you’re in another app',
  edgeNote: 'Where Althar shows what needs you and what runs.',
  edgeFailed: 'That couldn’t be kept. Try again.',
}

export function SettingsView({
  model,
  connections,
  appIcon,
  edge,
  onBack,
}: {
  model: StartModel
  connections: ConnectionsModel
  appIcon: AppIconModel
  edge: EdgePlaceModel
  onBack: () => void
}) {
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
      <TitleBar lights="none">
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
          {appIcon.icon !== null && (
            <section aria-labelledby="icon" className={s.section}>
              <div className={s.titled}>
                <Heading level={2} id="icon">
                  {text.icon}
                </Heading>
                <p className={s.quiet}>{text.iconNote}</p>
              </div>
              <Choices
                label={text.icon}
                layout="tiles"
                options={appIcons.map((icon) => ({ value: icon.value, title: icon.title, picture: <img src={icon.picture} alt="" /> }))}
                value={appIcon.icon}
                onChange={appIcon.choose}
              />
              {appIcon.failed && (
                <p role="alert" className={s.failed}>
                  {text.iconFailed}
                </p>
              )}
            </section>
          )}
          {edge.place !== null && (
            <section aria-labelledby="edge" className={s.section}>
              <div className={s.titled}>
                <Heading level={2} id="edge">
                  {text.edge}
                </Heading>
                <p className={s.quiet}>{text.edgeNote}</p>
              </div>
              <Choices
                label={text.edge}
                options={edgePlaces.map((place) => ({ value: place.value, title: place.title, note: place.note }))}
                value={edge.place}
                onChange={edge.choose}
              />
              {edge.failed && (
                <p role="alert" className={s.failed}>
                  {text.edgeFailed}
                </p>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
