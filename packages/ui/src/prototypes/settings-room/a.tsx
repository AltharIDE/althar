// Scrappy, A: the Control Center stays for the quick switches and a glance; everything else is in a Settings window of sections.
import { useState } from 'react'

import {
  AppVersion,
  Button,
  ControlAgents,
  ControlCenter,
  ControlFoot,
  ControlGrid,
  ControlLine,
  ControlMarks,
  ControlModule,
  ControlPicture,
  Dialog,
  EdgeMini,
  IconButton,
  UpdateReady,
} from '../../index'
import { SectionNav, SectionPanel } from './frame'
import { type Models, useModels } from './models'
import { QuickToggles, type SectionId } from './sections'

import { notesOf } from '../../../../../apps/desktop/src/main/updates'
import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import {
  agentGlanceOf,
  hostsLineOf,
  marksOf,
  type SettingsPanelProps,
  text,
} from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'
import { text as connectionsText } from '../../../../../apps/desktop/src/renderer/features/connections/ConnectionsView'
import { appIcons } from '../../../../../apps/desktop/src/renderer/shared/appIcons'
import { edgeWords } from '../../../../../apps/desktop/src/renderer/shared/edge'

export function DirectionA({ start, open, onOpenChange, glance }: SettingsPanelProps) {
  const [at, setAt] = useState<SectionId | null>(null)
  const m = useModels(start, open || at !== null, glance)
  // From the panel, the window opens on the section pressed, over the window, and the panel goes.
  const show = (id: SectionId) => {
    onOpenChange(false)
    setAt(id)
  }
  return (
    <>
      <ControlCenter
        trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
        open={open}
        onOpenChange={onOpenChange}
        text={{ label: text.title }}
      >
        <Front m={m} onShow={show} />
      </ControlCenter>
      {at !== null && <SettingsWindow m={m} at={at} onAt={setAt} onClose={() => setAt(null)} />}
    </>
  )
}

/** The panel as it is today, less what moved: two switches, a glance at the agents, the code hosts, how Althar looks; then the version and All settings. */
function Front({ m, onShow }: { m: Models; onShow: (id: SectionId) => void }) {
  const agents = m.start.status?.agents ?? []
  const list = m.connections.list
  const hosts = list === null ? null : hostsLineOf(list)
  const icon = appIcons.find((one) => one.value === m.appIcon.icon)
  const { spot } = m.edge
  const words = spot === null ? null : edgeWords(spot)
  const version = m.start.status?.appVersion
  return (
    <>
      <div style={{ display: 'grid', gap: 10 }}>
        <QuickToggles m={m} onOpen={onShow} />
        <ControlGrid row={28}>
          <ControlModule
            title={text.agents}
            {...(m.start.status === null ? {} : { aside: text.accounts(agents.reduce((n, agent) => n + agent.accounts.length, 0)) })}
            onClick={() => onShow('agents')}
            place={{ column: [1, 3], row: [1, 7] }}
          >
            {m.start.status === null ? (
              <span className={s.waiting}>{text.connecting}</span>
            ) : (
              <ControlAgents agents={agents.map((agent) => agentGlanceOf(agent))} />
            )}
          </ControlModule>
          <ControlModule title={connectionsText.label} onClick={() => onShow('hosts')} place={{ column: [3, 4], row: [1, 7] }}>
            {list !== null && <ControlMarks marks={marksOf(list)} />}
            {hosts !== null && <ControlLine tone={hosts.tone}>{hosts.line}</ControlLine>}
          </ControlModule>
          {spot !== null && words !== null && (
            <ControlPicture
              title={text.edge}
              name={words.word}
              picture={<EdgeMini spot={spot} />}
              onClick={() => onShow('look')}
              place={{ column: [4, 5], row: icon === undefined ? [1, 7] : [1, 4] }}
            />
          )}
          {icon !== undefined && (
            <ControlPicture
              title={text.icon}
              name={icon.title}
              picture={<img src={icon.picture} alt="" />}
              onClick={() => onShow('look')}
              place={{ column: [4, 5], row: spot === null ? [1, 7] : [4, 7] }}
            />
          )}
        </ControlGrid>
      </div>
      <ControlFoot>
        {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
        {m.update.ready !== null && <UpdateReady {...m.update.ready} />}
        <Button size="small" variant="quiet" trailingIcon="chevron" onClick={() => onShow('agents')}>
          All settings
        </Button>
      </ControlFoot>
    </>
  )
}

/** Settings as a window over the app, a sheet: the sections down the side, the one open beside them, scrolling on its own. */
export function SettingsWindow({ m, at, onAt, onClose }: { m: Models; at: SectionId; onAt: (id: SectionId) => void; onClose: () => void }) {
  return (
    <Dialog title="Settings" onClose={onClose} width={1000} holding={m.accounts.signingIn !== null}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 20, height: 'min(600px, calc(70vh - 90px))' }}>
        <div style={{ overflowY: 'auto' }}>
          <SectionNav current={at} onPick={onAt} />
        </div>
        <div style={{ overflowY: 'auto', paddingRight: 4 }}>
          <SectionPanel key={at} id={at} m={m} headingLevel={3} />
        </div>
      </div>
    </Dialog>
  )
}
