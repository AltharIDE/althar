// Scrappy, the second round: the quick panel's parts. What is changed often, one press away; the rest on a page behind All settings.
import { type ReactNode, useEffect, useState } from 'react'

import {
  AppVersion,
  Button,
  ControlAgents,
  ControlGrid,
  ControlLine,
  ControlMarks,
  ControlModule,
  ControlSheet,
  ControlToggle,
  ControlFoot,
  Icon,
  type IconName,
  SettingList,
} from '../../index'
import { SettingsPage } from './b'
import type { Models } from './models'
import { notifyAll, ROWS, type SectionId } from './sections'

import { notesOf } from '../../../../../apps/desktop/src/main/updates'
import { SYSTEM_SOUND } from '../../../../../apps/desktop/src/main/notify'
import { text as connectionsText } from '../../../../../apps/desktop/src/renderer/features/connections/ConnectionsView'
import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import { agentGlanceOf, hostsLineOf, marksOf, text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

/* ——— The round switches: whichever the panel holds, two to a row ——— */

export type ToggleId = 'keepAwake' | 'notify' | 'postTeam' | 'load' | 'coAuthor'

interface Toggle {
  readonly title: string
  readonly line: string
  readonly on: boolean
  readonly set: (on: boolean) => void
  readonly glyph: IconName
  /** The section its name opens on the page. */
  readonly section: SectionId
}

const toggleOf = (m: Models, id: ToggleId): Toggle | null => {
  const { preferences, set } = m.preferences
  switch (id) {
    case 'keepAwake':
      return {
        title: text.awake,
        line: preferences.keepAwake ? text.awakeOn : text.off,
        on: preferences.keepAwake,
        set: (on) => set('keepAwake', on),
        glyph: 'cup',
        section: 'mac',
      }
    case 'notify': {
      const on = preferences.notifyCalls || preferences.notifyReady || preferences.notifyStopped
      return {
        title: text.notify,
        line: !on
          ? text.off
          : preferences.sound === null
            ? text.silent
            : preferences.sound === SYSTEM_SOUND
              ? text.withSound
              : preferences.sound,
        on,
        set: (next) => notifyAll(m, next),
        glyph: 'bell',
        section: 'notify',
      }
    }
    case 'postTeam':
      return m.postTeamReviews === null
        ? null
        : {
            title: 'Post team reviews',
            line: m.postTeamReviews.on ? 'Without asking' : 'You post them',
            on: m.postTeamReviews.on,
            set: m.postTeamReviews.set,
            glyph: 'pr',
            section: 'reviews',
          }
    case 'load':
      return {
        title: 'CPU and memory',
        line: preferences.showLoad ? 'In the bar' : text.off,
        on: preferences.showLoad,
        set: (on) => set('showLoad', on),
        glyph: 'load',
        section: 'mac',
      }
    case 'coAuthor':
      return m.coAuthor === null
        ? null
        : {
            title: text.coAuthor,
            line: m.coAuthor.on ? 'On commits' : text.off,
            on: m.coAuthor.on,
            set: m.coAuthor.set,
            glyph: 'branch',
            section: 'reviews',
          }
  }
}

export function Toggles({ m, ids, onOpen }: { m: Models; ids: ReadonlyArray<ToggleId>; onOpen: (id: SectionId) => void }) {
  const toggles = ids.flatMap((id) => {
    const one = toggleOf(m, id)
    return one === null ? [] : [{ id, ...one }]
  })
  if (toggles.length === 0) return null
  return (
    <ControlGrid row={28}>
      {toggles.map((one, i) => {
        const row = 1 + Math.floor(i / 2) * 2
        return (
          <ControlToggle
            key={one.id}
            title={one.title}
            line={one.line}
            on={one.on}
            onChange={one.set}
            glyph={<Icon name={one.glyph} size={16} />}
            onOpen={() => onOpen(one.section)}
            place={{ column: i % 2 === 0 ? [1, 3] : [3, 5], row: [row, row + 2] }}
          />
        )
      })}
    </ControlGrid>
  )
}

/* ——— What else is quick ——— */

/** How many agents work at once, its slider, on a sheet of its own. */
export function AtOnceSheet({ m }: { m: Models }) {
  return (
    <ControlSheet>
      <SettingList>{ROWS.atOnce(m)}</SettingList>
    </ControlSheet>
  )
}

/** The agents and the code hosts at a glance: what needs you in violet. Each opens its section on the page. */
export function Glances({
  m,
  onOpen,
  agents: showAgents = true,
  hosts: showHosts = true,
}: {
  m: Models
  onOpen: (id: SectionId) => void
  agents?: boolean
  hosts?: boolean
}) {
  const agents = m.start.status?.agents ?? []
  const list = m.connections.list
  const hosts = list === null ? null : hostsLineOf(list)
  const both = showAgents && showHosts
  return (
    <ControlGrid row={28}>
      {showAgents && (
        <ControlModule
          title={text.agents}
          {...(m.start.status === null ? {} : { aside: text.accounts(agents.reduce((n, agent) => n + agent.accounts.length, 0)) })}
          onClick={() => onOpen('agents')}
          place={{ column: both ? [1, 4] : [1, 5], row: [1, 7] }}
        >
          {m.start.status === null ? (
            <span className={s.waiting}>{text.connecting}</span>
          ) : (
            <ControlAgents agents={agents.map((agent) => agentGlanceOf(agent))} />
          )}
        </ControlModule>
      )}
      {showHosts && (
        <ControlModule
          title={connectionsText.label}
          onClick={() => onOpen('hosts')}
          place={{ column: both ? [4, 5] : [1, 5], row: both ? [1, 7] : [1, 5] }}
        >
          {list !== null && <ControlMarks marks={marksOf(list)} />}
          {hosts !== null && <ControlLine tone={hosts.tone}>{hosts.line}</ControlLine>}
        </ControlModule>
      )}
    </ControlGrid>
  )
}

/** The foot: which Althar this is, a newer one ready, and the way to everything else. */
export function QuickFoot({ m, onAll, children }: { m: Models; onAll: () => void; children?: ReactNode }) {
  const version = m.start.status?.appVersion
  return (
    <ControlFoot>
      {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
      {children}
      <Button size="small" icon="gear" kbd="⌘⇧," onClick={onAll}>
        All settings
      </Button>
    </ControlFoot>
  )
}

/** The page behind All settings, opened on a section, over the screen the panel was opened on. */
export function usePage(onOpenChange: (open: boolean) => void) {
  const [page, setPage] = useState<SectionId | null>(null)
  // ⌘⇧, goes straight to the page, from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.code !== 'Comma') return
      event.preventDefault()
      onOpenChange(false)
      setPage((now) => (now === null ? 'agents' : null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])
  return {
    open: page !== null,
    show: (id: SectionId) => {
      onOpenChange(false)
      setPage(id)
    },
    draw: (m: Models, where: string | undefined) =>
      page !== null && <SettingsPage key={page} m={m} first={page} back={where} quick={false} onClose={() => setPage(null)} />,
  }
}
