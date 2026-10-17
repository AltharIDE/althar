// E · One gear: the project has no settings button of its own. The gear at the bar's end, on a project's screen, leads with that project's switches over the app's; its foot opens the project's section of the Settings tab, where every project sits beside the app's own sections.
import { useEffect } from 'react'

import { MOST_AT_ONCE } from '../../../../contracts/src/index'
import {
  AgentsAtOnce,
  AppVersion,
  Button,
  ControlCenter,
  ControlFoot,
  ControlGrid,
  ControlLine,
  ControlModule,
  ControlSheet,
  ControlToggle,
  Icon,
  IconButton,
  ProjectMark,
} from '../../../src/index'
import { useRouterState } from '../deps'
import { type Things, useThings } from '../parts'
import css from '../parts.module.css'
import { proto, useProto } from '../state'
import { SECTIONS, SectionBody, sectionText } from './sections'

import { notesOf } from '../../../../../apps/desktop/src/main/updates'
import { useServices } from '../../../../../apps/desktop/src/renderer/data/services'
import { reads } from '../../../../../apps/desktop/src/renderer/data/reads'
import { QuickCards } from '../../../../../apps/desktop/src/renderer/features/settings/QuickCards'
import type { Section as AppSection } from '../../../../../apps/desktop/src/renderer/features/settings/sections'
import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/text'
import { useAgentsAtOnce } from '../../../../../apps/desktop/src/renderer/features/settings/useAgentsAtOnce'
import { usePreferences } from '../../../../../apps/desktop/src/renderer/shared/usePreferences'
import { useSounds } from '../../../../../apps/desktop/src/renderer/shared/useSounds'
import { useQuery } from '../deps'

export interface QuickProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettings: (section: AppSection | null) => void
}

/** The project's switches, two to a row, as the app's cards are; a connection that needs you across them. */
function ProjectBlock({ things, onOpen }: { things: Things; onOpen: () => void }) {
  const rules = things.rules
  const trouble = [things.host, ...things.trackers].find((one) => one?.trouble != null) ?? null
  const cards =
    rules === null
      ? []
      : [
          ...(things.trackers.length === 0
            ? []
            : [
                {
                  key: 'move',
                  title: 'Move issues',
                  line: rules.moveIssues ? 'As a task starts' : 'Off',
                  on: rules.moveIssues,
                  set: things.model.setMoveIssues,
                  glyph: 'play' as const,
                },
              ]),
          {
            key: 'conflicts',
            title: 'Resolve conflicts',
            line: rules.resolveConflicts ? 'The lead fixes them' : 'Off',
            on: rules.resolveConflicts,
            set: things.model.setResolveConflicts,
            glyph: 'branch' as const,
          },
          {
            key: 'allow',
            title: 'Allow everything',
            line: rules.allowEverything ? 'Nothing waits for you' : 'Off',
            on: rules.allowEverything,
            set: things.setAllowEverything,
            glyph: 'lock' as const,
          },
        ]
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>
        <ProjectMark seed={things.seed} ink={things.ink} size={14} /> {things.name}
      </h3>
      <ControlGrid row={28}>
        {cards.map((card, i) => (
          <ControlToggle
            key={card.key}
            title={card.title}
            line={card.line}
            on={card.on}
            onChange={card.set}
            glyph={<Icon name={card.glyph} size={16} />}
            onOpen={onOpen}
            place={{ column: i % 2 === 0 ? [1, 3] : [3, 5], row: [1 + Math.floor(i / 2) * 2, 3 + Math.floor(i / 2) * 2] }}
          />
        ))}
        {trouble !== null && trouble !== undefined && (
          <ControlModule title={`${trouble.name} · ${trouble.what}`} onClick={() => things.connect(trouble)} place={{ column: [1, 5] }}>
            <ControlLine tone="yours">
              {trouble.trouble === 'signed-out' ? 'Signed out: sign in again, for every project' : 'Not connected: connect it'}
            </ControlLine>
          </ControlModule>
        )}
      </ControlGrid>
    </section>
  )
}

/** The gear at the bar's end, on a project's screen: that project first, then the app's quick settings, as they are. */
export function EQuick({ open, onOpenChange, onSettings }: QuickProps) {
  const things = useThings()
  const p = useProto()
  const { client } = useServices()
  const preferences = usePreferences()
  const sounds = useSounds()
  const atOnce = useAgentsAtOnce()
  const version = useQuery(reads(client).status()).data?.appVersion
  const project = () => {
    onOpenChange(false)
    proto.set({ inSettings: true })
    onSettings(null)
  }
  // What the picker opens: the panel, or the project's section of the Settings tab; once each time it changes.
  useEffect(() => {
    if (p.showing === 'open') onOpenChange(true)
    if (p.showing === 'notes') project()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.showing])
  const settings = (section: AppSection | null) => {
    onOpenChange(false)
    proto.set({ inSettings: false })
    onSettings(section)
  }
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.gear} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      text={{ label: text.quick }}
    >
      <div className={css.panel}>
        <ProjectBlock things={things} onOpen={project} />
        <section className={css.group}>
          <h3 className={css.groupTitle}>Althar</h3>
          <QuickCards preferences={preferences} sounds={sounds.list} onSection={settings} />
        </section>
        {atOnce !== null && (
          <ControlSheet>
            <AgentsAtOnce
              compact
              count={atOnce.atOnce.count}
              own={atOnce.atOnce.own !== null}
              machine={atOnce.atOnce.machine}
              most={MOST_AT_ONCE}
              onChange={atOnce.set}
              text={{ value: text.atOnceValue }}
            />
          </ControlSheet>
        )}
      </div>
      <ControlFoot>
        {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
        <span className={css.grow} />
        <Button size="small" onClick={project}>
          {things.name} settings
        </Button>
        <Button size="small" icon="gear" kbd={text.allKbd} onClick={() => settings(null)}>
          {text.all}
        </Button>
      </ControlFoot>
    </ControlCenter>
  )
}

/** Whether the window shows a project: its screen, or one of its tasks'. */
export function useOnProject() {
  return useRouterState({ select: (state: { location: { pathname: string } }) => /^\/(projects|threads)\//.test(state.location.pathname) })
}

/** The project's section of the Settings tab: every part of it one under another, on the tab's own sheet. */
export function EProjectSection() {
  const things = useThings()
  return (
    <div className={s.body}>
      {SECTIONS.map((id) => (
        <section key={id} className={css.sheetSection}>
          <h2 className={css.sheetTitle}>{sectionText[id].title}</h2>
          <p className={css.quiet}>{sectionText[id].lede}</p>
          <SectionBody section={id} things={things} full={false} />
        </section>
      ))}
    </div>
  )
}
