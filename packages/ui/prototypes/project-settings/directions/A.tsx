// Scrappy: A, as the app's Settings tab: down the side, its sections and Remove, no quick switches (General says them in full); beside them, the section open on a sheet that takes the room the window has.
import { Icon, Panel, SettingsNav } from '../../../src/index'
import { overlay, type Things } from '../parts'
import { Body, sectionText } from '../sections'
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
          {/* Taking it out of Althar: not a section, the last thing down the side, in red, its dialog says what goes. */}
          <button type="button" className={c.remove} onClick={() => overlay.set({ removing: true })}>
            <Icon name="close" size={14} />
            Remove from Althar…
          </button>
        </aside>
        <main className={c.main}>
          <Panel
            key={section}
            title={open.title}
            // Remove is down the side, so General here is its name and colour, and how its tasks work.
            lede={section === 'general' ? 'Its name and colour, and how its tasks work.' : open.lede}
            headingLevel={1}
          >
            <div className={c.body}>
              <Body section={section} things={things} remove={false} />
            </div>
          </Panel>
        </main>
      </div>
    </div>
  )
}
