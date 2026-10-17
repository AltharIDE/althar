// Scrappy: A, as the app's Settings tab: down the side, the project, its quick switches and its sections; beside them, the section open on a sheet of its own.
import { Panel, ProjectMark, SettingsNav } from '../../../src/index'
import type { Things } from '../parts'
import { Body, QuickCards, sectionText } from '../sections'
import { proto, type Section, useProto } from '../state'
import c from './pages.module.css'

const GROUPS: ReadonlyArray<ReadonlyArray<Section>> = [['general', 'code'], ['rules', 'running'], ['notes']]

export function A({ things }: { things: Things }) {
  const section = useProto().section ?? 'general'
  const go = (next: Section) => proto.set({ section: next })
  const open = sectionText[section]
  return (
    <div className={c.page}>
      <div className={c.columns}>
        <aside className={c.side}>
          <div className={c.who}>
            <ProjectMark seed={things.seed} ink={things.ink} size={22} />
            <span>
              <b>{things.name}</b> settings
            </span>
          </div>
          <QuickCards things={things} columns={1} onSection={go} />
          <SettingsNav
            label="Project settings"
            groups={GROUPS.map((group) =>
              group.map((id) => ({
                id,
                title: sectionText[id].title,
                icon: sectionText[id].icon,
                ...(id === 'code' && things.troubles > 0 ? { yours: true } : {}),
              })),
            )}
            value={section}
            onChange={go}
          />
        </aside>
        <main className={c.main}>
          <Panel key={section} title={open.title} lede={open.lede} headingLevel={1}>
            <div className={c.body}>
              <Body section={section} things={things} switches={false} />
            </div>
          </Panel>
        </main>
      </div>
    </div>
  )
}
