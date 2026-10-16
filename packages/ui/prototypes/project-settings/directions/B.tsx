// B · A settings view beside the board: Conversation · Board · Both · Settings in the bar; the view is laid out as the app's Settings tab is, the project's switches down its side.
import { useState } from 'react'

import { ControlGrid, type ControlPlace, ControlToggle, Icon, Panel, SettingsNav } from '../../../src/index'
import type { Things } from '../parts'
import { useProto } from '../state'
import { GROUPS, type Section, SectionBody, sectionText, yoursIn } from './sections'

import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'

/** The project's switches, as the Settings tab's cards: one under another down the side, or two to a row. */
export function ProjectCards({ things, side = true, onOpen }: { things: Things; side?: boolean; onOpen?: (section: Section) => void }) {
  const rules = things.rules
  if (rules === null) return null
  const cards = [
    ...(things.tracker === null
      ? []
      : [
          {
            key: 'move',
            title: 'Move issues',
            line: rules.moveIssues ? 'To In Progress as a task starts' : 'Off',
            on: rules.moveIssues,
            set: things.model.setMoveIssues,
            glyph: 'play' as const,
            section: 'connections' as const,
          },
        ]),
    {
      key: 'conflicts',
      title: 'Resolve conflicts',
      line: rules.resolveConflicts ? 'The lead fixes them itself' : 'Off',
      on: rules.resolveConflicts,
      set: things.model.setResolveConflicts,
      glyph: 'branch' as const,
      section: 'rules' as const,
    },
    {
      key: 'allow',
      title: 'Allow everything',
      line: rules.allowEverything ? 'Nothing waits for you' : 'Off',
      on: rules.allowEverything,
      set: things.setAllowEverything,
      glyph: 'lock' as const,
      section: 'rules' as const,
    },
  ]
  // Down the side one under another; across a sheet, all in a row.
  const placeOf = (i: number): ControlPlace =>
    side ? { column: [1, 3], row: [1 + i * 2, 3 + i * 2] } : { column: [1 + i * 2, 3 + i * 2], row: [1, 3] }
  return (
    <ControlGrid row={28} columns={side ? 2 : 6}>
      {cards.map((card, i) => (
        <ControlToggle
          key={card.key}
          title={card.title}
          line={card.line}
          on={card.on}
          onChange={card.set}
          glyph={<Icon name={card.glyph} size={16} />}
          {...(onOpen === undefined ? {} : { onOpen: () => onOpen(card.section) })}
          place={placeOf(i)}
        />
      ))}
    </ControlGrid>
  )
}

export function B({ things }: { things: Things }) {
  const p = useProto()
  // At its notes as the picker says: the page keys it by that, so it starts again when it changes.
  const [section, setSection] = useState<Section>(p.showing === 'notes' ? 'notes' : 'general')
  const open = sectionText[section]
  return (
    <div className={s.page}>
      <div className={s.columns}>
        <aside className={s.side}>
          <ProjectCards things={things} onOpen={setSection} />
          <SettingsNav
            label={`${things.name}’s settings`}
            groups={GROUPS.map((group) =>
              group.map((id) => ({
                id,
                title: sectionText[id].title,
                icon: sectionText[id].icon,
                ...(yoursIn(id, things) ? { yours: true } : {}),
              })),
            )}
            value={section}
            onChange={setSection}
          />
        </aside>
        <main className={s.main}>
          <Panel key={section} title={open.title} lede={open.lede} headingLevel={1}>
            <div className={s.body}>
              <SectionBody section={section} things={things} />
            </div>
          </Panel>
        </main>
      </div>
    </div>
  )
}
